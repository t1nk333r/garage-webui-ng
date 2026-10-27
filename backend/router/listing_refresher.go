package router

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/d7eeem/garage-webui-ng/schema"
	"github.com/d7eeem/garage-webui-ng/utils"
)

// The refresher keeps generated directory listings current. Two triggers:
//
//   - a debounced refresh of one bucket, listingDebounce after this UI last
//     uploaded or deleted something in it (notifyListing, called by the
//     Browse write handlers);
//   - a periodic sweep of every website bucket, every
//     LISTING_REFRESH_INTERVAL_MINUTES, which catches changes made by other
//     S3 clients.
//
// Both run in listingUpdate mode, so they only refresh buckets whose listing
// is already on and never switch one on.

const listingDebounce = 5 * time.Second

const defaultListingRefreshMinutes = 10

// listingRefresh is nil until main starts the refresher, so tests and code
// paths that never start one simply skip the notifications.
var listingRefresh atomic.Pointer[listingRefresher]

// notifyListing asks for a refresh of bucket's listing pages soon. It never
// blocks and does nothing when no refresher is running.
func notifyListing(bucket string) {
	if lr := listingRefresh.Load(); lr != nil {
		lr.Notify(bucket)
	}
}

// listingPending reports whether a debounced refresh of bucket is queued or
// running.
func listingPending(bucket string) bool {
	if lr := listingRefresh.Load(); lr != nil {
		return lr.Pending(bucket)
	}
	return false
}

// listingRefreshInterval reads LISTING_REFRESH_INTERVAL_MINUTES. 0 turns the
// periodic sweep off; a missing, unparseable or negative value keeps the
// default rather than silently disabling it.
func listingRefreshInterval() time.Duration {
	raw := utils.GetEnv("LISTING_REFRESH_INTERVAL_MINUTES", "")
	if raw == "" {
		return defaultListingRefreshMinutes * time.Minute
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		log.Printf("LISTING_REFRESH_INTERVAL_MINUTES=%q is not a whole number of minutes; using %d", raw, defaultListingRefreshMinutes)
		return defaultListingRefreshMinutes * time.Minute
	}
	return time.Duration(n) * time.Minute
}

// StartListingRefresher starts the process-wide refresher. ctx ends it; the
// returned stop function also ends it and waits for running refreshes to
// return.
func StartListingRefresher(ctx context.Context) (stop func()) {
	lr := newListingRefresher(listingDebounce, listingRefreshInterval())
	lr.Start(ctx)
	listingRefresh.Store(lr)
	return func() {
		listingRefresh.CompareAndSwap(lr, nil)
		lr.Stop()
	}
}

type listingRefresher struct {
	debounce time.Duration
	interval time.Duration

	mu      sync.Mutex
	started bool
	due     map[string]time.Time // bucket alias -> when its refresh runs
	running map[string]bool
	lastErr map[string]string // last logged problem per bucket alias

	wake     chan struct{}
	sweeping atomic.Bool
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

func newListingRefresher(debounce, interval time.Duration) *listingRefresher {
	return &listingRefresher{
		debounce: debounce,
		interval: interval,
		due:      map[string]time.Time{},
		running:  map[string]bool{},
		lastErr:  map[string]string{},
		wake:     make(chan struct{}, 1),
	}
}

func (lr *listingRefresher) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	lr.mu.Lock()
	lr.started = true
	lr.cancel = cancel
	lr.mu.Unlock()
	lr.wg.Add(1)
	go lr.loop(ctx)
}

// Stop cancels every timer and running refresh and waits for them to return.
func (lr *listingRefresher) Stop() {
	lr.mu.Lock()
	lr.started = false
	cancel := lr.cancel
	lr.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	lr.wg.Wait()
}

// Notify schedules a refresh of bucket listingDebounce from now; another
// notification before then pushes it back, so a burst of uploads costs one
// refresh.
func (lr *listingRefresher) Notify(bucket string) {
	lr.mu.Lock()
	if !lr.started {
		lr.mu.Unlock()
		return
	}
	lr.due[bucket] = time.Now().Add(lr.debounce)
	lr.mu.Unlock()
	select {
	case lr.wake <- struct{}{}:
	default:
	}
}

func (lr *listingRefresher) Pending(bucket string) bool {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	_, queued := lr.due[bucket]
	return queued || lr.running[bucket]
}

func (lr *listingRefresher) loop(ctx context.Context) {
	defer lr.wg.Done()

	var sweep <-chan time.Time
	if lr.interval > 0 {
		ticker := time.NewTicker(lr.interval)
		defer ticker.Stop()
		sweep = ticker.C
	}

	for {
		var timer *time.Timer
		var fire <-chan time.Time
		if next, ok := lr.nextDue(); ok {
			timer = time.NewTimer(time.Until(next))
			fire = timer.C
		}

		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return
		case <-lr.wake:
		case <-fire:
			lr.fireDue(ctx)
		case <-sweep:
			lr.startSweep(ctx)
		}
		if timer != nil {
			timer.Stop()
		}
	}
}

func (lr *listingRefresher) nextDue() (time.Time, bool) {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	var next time.Time
	for _, at := range lr.due {
		if next.IsZero() || at.Before(next) {
			next = at
		}
	}
	return next, !next.IsZero()
}

func (lr *listingRefresher) fireDue(ctx context.Context) {
	now := time.Now()
	var ready []string
	lr.mu.Lock()
	for bucket, at := range lr.due {
		if !at.After(now) {
			delete(lr.due, bucket)
			lr.running[bucket] = true
			ready = append(ready, bucket)
		}
	}
	lr.mu.Unlock()

	for _, bucket := range ready {
		lr.wg.Add(1)
		go func(bucket string) {
			defer lr.wg.Done()
			defer func() {
				lr.mu.Lock()
				delete(lr.running, bucket)
				lr.mu.Unlock()
			}()
			lr.refreshAlias(ctx, bucket)
		}(bucket)
	}
}

func (lr *listingRefresher) refreshAlias(ctx context.Context, bucket string) {
	info, err := fetchBucketByAlias(bucket)
	if err != nil {
		lr.report(bucket, err)
		return
	}
	lr.refreshBucket(ctx, info, bucket, true)
}

// refreshBucket refreshes one bucket's pages if its listing is on. A refresh
// that finds another run holding the lock is re-queued when requeue is set
// (the change that triggered it may not be in the running pass), and
// dropped otherwise (the sweep comes round again anyway).
func (lr *listingRefresher) refreshBucket(ctx context.Context, info schema.Bucket, bucket string, requeue bool) {
	if !info.WebsiteAccess {
		return
	}
	indexDoc, err := listingIndexDocument(info)
	if err != nil {
		return
	}
	// A bucket without a read+write key cannot have a listing at all; that is
	// not worth a log line on every sweep.
	client, err := getS3Client(bucket)
	if err != nil {
		return
	}

	unlock, ok := tryLockListing(info.ID)
	if !ok {
		if requeue {
			lr.Notify(bucket)
		}
		return
	}
	defer unlock()

	syncCtx, cancel := context.WithTimeout(ctx, listingSyncTimeout)
	defer cancel()
	res, err := syncListing(syncCtx, client, bucket, indexDoc, listingUpdate, nil)
	if errors.Is(err, errListingNotEnabled) || errors.Is(err, errListingConflict) {
		lr.report(bucket, nil)
		return
	}
	if ctx.Err() != nil {
		// Shutting down: not this bucket's fault, and not worth recording.
		return
	}
	recordListingSync(info.ID, res.record(err))
	lr.report(bucket, err)
}

func (lr *listingRefresher) startSweep(ctx context.Context) {
	if !lr.sweeping.CompareAndSwap(false, true) {
		return // the previous sweep is still going
	}
	lr.wg.Add(1)
	go func() {
		defer lr.wg.Done()
		defer lr.sweeping.Store(false)
		lr.sweep(ctx)
	}()
}

// sweep refreshes every bucket that has website access and a global alias.
func (lr *listingRefresher) sweep(ctx context.Context) {
	body, err := utils.Garage.Fetch("/v2/ListBuckets", &utils.FetchOptions{})
	if err != nil {
		lr.report("", fmt.Errorf("cannot list buckets: %w", err))
		return
	}
	var buckets []schema.GetBucketsRes
	if err := json.Unmarshal(body, &buckets); err != nil {
		lr.report("", fmt.Errorf("cannot list buckets: %w", err))
		return
	}
	lr.report("", nil)

	infos := make([]*schema.Bucket, len(buckets))
	sem := make(chan struct{}, maxBucketInfoConcurrency)
	var wg sync.WaitGroup
	for i, b := range buckets {
		if len(b.GlobalAliases) == 0 {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, id string) {
			defer wg.Done()
			defer func() { <-sem }()
			body, err := utils.Garage.Fetch("/v2/GetBucketInfo?id="+id, &utils.FetchOptions{})
			if err != nil {
				return
			}
			var info schema.Bucket
			if json.Unmarshal(body, &info) == nil {
				infos[i] = &info
			}
		}(i, b.ID)
	}
	wg.Wait()

	for i, info := range infos {
		if ctx.Err() != nil {
			return
		}
		if info == nil || !info.WebsiteAccess {
			continue
		}
		lr.refreshBucket(ctx, *info, buckets[i].GlobalAliases[0], false)
	}
}

// report logs a bucket's refresh problem when it first appears, changes or
// clears — not on every sweep while it persists.
func (lr *listingRefresher) report(bucket string, err error) {
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	lr.mu.Lock()
	prev := lr.lastErr[bucket]
	if msg == "" {
		delete(lr.lastErr, bucket)
	} else {
		lr.lastErr[bucket] = msg
	}
	lr.mu.Unlock()

	if msg == prev {
		return
	}
	name := "directory listing refresh"
	if bucket != "" {
		name = fmt.Sprintf("directory listing for bucket %q", bucket)
	}
	if msg == "" {
		log.Printf("%s: working again", name)
		return
	}
	log.Printf("%s: %s", name, msg)
}

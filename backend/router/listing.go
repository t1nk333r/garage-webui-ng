package router

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/d7eeem/garage-webui-ng/schema"
	"github.com/d7eeem/garage-webui-ng/utils"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Directory listings for website buckets.
//
// Garage's website endpoint serves only the configured index document; it
// never produces a folder listing, and anonymous visitors cannot call
// ListObjectsV2. So a listing has to exist as real objects: this file writes
// one static index page into every folder of a bucket, and the refresher in
// listing_refresher.go keeps them current.
//
// Safety rule, carried over from plans/063: never overwrite or delete an
// index object this tool did not write. Every generated page carries the
// listingMarkerKey user-metadata entry; every write HEADs its target first and
// every delete re-HEADs it immediately before deleting, and a missing marker
// always means "leave it alone".
//
// Whether listing is enabled is read from the bucket, not stored locally: it
// is on exactly when the root index document exists and carries the marker.

// listingMarkerKey is the S3 user-metadata key (sent as
// x-amz-meta-garage-webui-ng-generated) that marks a page as ours.
const (
	listingMarkerKey     = "garage-webui-ng-generated"
	listingMarkerValue   = "1"
	defaultIndexDocument = "index.html"
)

// Caps on a single sync. They are vars, not consts, only so tests can shrink
// them; production code never assigns to them.
var (
	// The walk reads at most listingWalkMaxPages pages of
	// listingWalkPageSize keys (100,000 keys) before refusing the bucket as
	// too large to list.
	listingWalkPageSize int32 = maxListKeys
	listingWalkMaxPages       = 100

	// At most this many pages are written per run; a later run continues,
	// because unchanged pages do not count against it.
	listingMaxWrites = 5000

	// A page lists at most this many entries and says how many it left out.
	listingMaxRows = 10000

	// HEADs, PUTs and DELETEs run at most this many at a time.
	listingConcurrency = 8

	// listingSyncTimeout bounds one generate, refresh or removal run.
	listingSyncTimeout = 10 * time.Minute

	// listingLockWait is how long a removal waits for a running refresh.
	listingLockWait = 30 * time.Second
)

var (
	errListingConflict = errors.New(
		"this bucket already has an index document that Garage WebUI-NG did not create; " +
			"it will not be replaced or deleted")
	errListingTooLarge = errors.New(
		"this bucket has too many objects for a generated listing")
	errListingNotEnabled = errors.New("directory listing is not enabled for this bucket")
	errListingBusy       = errors.New(
		"a directory listing update is already running for this bucket; try again in a moment")
)

type listingMode int

const (
	// listingCreate writes the root page if it is absent: enabling, or
	// "refresh now".
	listingCreate listingMode = iota
	// listingUpdate only refreshes a bucket whose root page is already ours.
	// Background runs use it, so they can never re-enable a listing that was
	// switched off while they waited.
	listingUpdate
)

// --- per-bucket lock -----------------------------------------------------

// Every generate, refresh and removal for a bucket runs under one lock, keyed
// by bucket ID rather than alias so two aliases of one bucket share it. A
// buffered channel rather than a sync.Mutex because a removal needs to wait
// with a deadline and a handler needs a non-blocking try.
var listingLocks = struct {
	sync.Mutex
	m map[string]chan struct{}
}{m: map[string]chan struct{}{}}

func listingLockFor(bucketID string) chan struct{} {
	listingLocks.Lock()
	defer listingLocks.Unlock()
	l, ok := listingLocks.m[bucketID]
	if !ok {
		l = make(chan struct{}, 1)
		listingLocks.m[bucketID] = l
	}
	return l
}

func tryLockListing(bucketID string) (unlock func(), ok bool) {
	l := listingLockFor(bucketID)
	select {
	case l <- struct{}{}:
		return func() { <-l }, true
	default:
		return nil, false
	}
}

func lockListing(ctx context.Context, bucketID string) (unlock func(), err error) {
	l := listingLockFor(bucketID)
	select {
	case l <- struct{}{}:
		return func() { <-l }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func listingLocked(bucketID string) bool {
	return len(listingLockFor(bucketID)) > 0
}

// --- last-run record ------------------------------------------------------

// listingRecords keeps the outcome of the most recent run per bucket ID, for
// the status line. It is in memory only: after a restart the status simply
// has no last run until the next one.
var listingRecords = struct {
	sync.Mutex
	m map[string]schema.DirectoryListingSync
}{m: map[string]schema.DirectoryListingSync{}}

func recordListingSync(bucketID string, rec schema.DirectoryListingSync) {
	listingRecords.Lock()
	defer listingRecords.Unlock()
	listingRecords.m[bucketID] = rec
}

func forgetListingSync(bucketID string) {
	listingRecords.Lock()
	defer listingRecords.Unlock()
	delete(listingRecords.m, bucketID)
}

func lastListingSync(bucketID string) *schema.DirectoryListingSync {
	listingRecords.Lock()
	defer listingRecords.Unlock()
	rec, ok := listingRecords.m[bucketID]
	if !ok {
		return nil
	}
	return &rec
}

// --- bucket config --------------------------------------------------------

func fetchBucketByAlias(bucket string) (schema.Bucket, error) {
	var info schema.Bucket
	body, err := utils.Garage.Fetch("/v2/GetBucketInfo?globalAlias="+url.QueryEscape(bucket), &utils.FetchOptions{})
	if err != nil {
		return info, fmt.Errorf("cannot read bucket %q: %w", bucket, err)
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return info, fmt.Errorf("cannot read bucket %q: %w", bucket, err)
	}
	return info, nil
}

// listingIndexDocument returns the index document pages are written as.
// Garage treats an empty indexDocument as "index.html". A name containing a
// slash is refused: a page is written as <folder>/<indexDocument>, and a
// nested name would put it somewhere the website endpoint never looks.
func listingIndexDocument(info schema.Bucket) (string, error) {
	doc := info.WebsiteConfig.IndexDocument
	if doc == "" {
		doc = defaultIndexDocument
	}
	if !validListingSegment(doc) {
		return doc, fmt.Errorf("index document %q must be a plain file name for a directory listing", doc)
	}
	return doc, nil
}

func validListingSegment(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.Contains(s, "/")
}

// --- S3 primitives --------------------------------------------------------

type indexState int

const (
	indexAbsent indexState = iota
	indexGenerated
	indexForeign
)

func isGeneratedListing(meta map[string]string) bool {
	for k, v := range meta {
		if strings.EqualFold(k, listingMarkerKey) && strings.TrimSpace(v) == listingMarkerValue {
			return true
		}
	}
	return false
}

// headIndex reports who owns key. It is the only thing a write or delete
// trusts, and it is re-run immediately before each one.
func headIndex(ctx context.Context, client *s3.Client, bucket, key string) (indexState, error) {
	out, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFoundErr(err) {
			return indexAbsent, nil
		}
		return indexAbsent, fmt.Errorf("cannot read %q: %w", key, err)
	}
	if isGeneratedListing(out.Metadata) {
		return indexGenerated, nil
	}
	return indexForeign, nil
}

func putListingPage(ctx context.Context, client *s3.Client, bucket, key string, body []byte) error {
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(body),
		ContentLength: aws.Int64(int64(len(body))),
		ContentType:   aws.String("text/html; charset=utf-8"),
		// Garage stores this and serves it back from the website endpoint,
		// so browsers revalidate instead of showing a stale listing.
		CacheControl: aws.String("no-cache"),
		Metadata:     map[string]string{listingMarkerKey: listingMarkerValue},
	})
	if err != nil {
		return fmt.Errorf("cannot write %q: %w", key, err)
	}
	return nil
}

// deleteListingPage deletes key only if it is still one of ours, judged by a
// HEAD made immediately before the delete.
func deleteListingPage(ctx context.Context, client *s3.Client, bucket, key string) (bool, error) {
	state, err := headIndex(ctx, client, bucket, key)
	if err != nil || state != indexGenerated {
		return false, err
	}
	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}); err != nil {
		return false, fmt.Errorf("cannot delete %q: %w", key, err)
	}
	return true, nil
}

type listingObject struct {
	key      string
	size     int64
	modified time.Time
	etag     string // unquoted, lowercase
}

// walkListingObjects lists every key in the bucket, keeping those keep
// accepts (nil keeps all). maxPages <= 0 means no cap; complete is false when
// the cap stopped the walk before the end of the listing.
func walkListingObjects(ctx context.Context, client *s3.Client, bucket string, maxPages int, keep func(string) bool) (objs []listingObject, complete bool, err error) {
	var token *string
	for pages := 0; maxPages <= 0 || pages < maxPages; pages++ {
		out, err := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(bucket),
			MaxKeys:           aws.Int32(listingWalkPageSize),
			ContinuationToken: token,
		})
		if err != nil {
			return nil, false, fmt.Errorf("cannot list bucket: %w", err)
		}
		for _, o := range out.Contents {
			key := aws.ToString(o.Key)
			if keep != nil && !keep(key) {
				continue
			}
			obj := listingObject{
				key:  key,
				size: aws.ToInt64(o.Size),
				etag: strings.ToLower(strings.Trim(aws.ToString(o.ETag), `"`)),
			}
			if o.LastModified != nil {
				obj.modified = *o.LastModified
			}
			objs = append(objs, obj)
		}
		if !aws.ToBool(out.IsTruncated) || out.NextContinuationToken == nil {
			return objs, true, nil
		}
		token = out.NextContinuationToken
	}
	return objs, false, nil
}

// runBounded calls fn for each item with at most listingConcurrency running
// at once, and returns when all have finished.
func runBounded[T any](items []T, fn func(T)) {
	sem := make(chan struct{}, listingConcurrency)
	var wg sync.WaitGroup
	for _, item := range items {
		wg.Add(1)
		sem <- struct{}{}
		go func(item T) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(item)
		}(item)
	}
	wg.Wait()
}

// --- folder tree ----------------------------------------------------------

type listingFile struct {
	name     string
	size     int64
	modified time.Time
}

type listingFolder struct {
	prefix  string // "" for the root, otherwise ends in "/"
	folders map[string]bool
	files   []listingFile
	// index is the existing index document object in this folder, if any.
	index *listingObject
	// foreign is set once a HEAD has shown the index is someone else's.
	foreign bool
}

type listingTree struct {
	folders  map[string]*listingFolder
	objects  int
	unlisted int
}

func newListingTree() *listingTree {
	return &listingTree{folders: map[string]*listingFolder{
		"": {prefix: "", folders: map[string]bool{}},
	}}
}

// ensure creates the folder at segs and every folder above it.
func (t *listingTree) ensure(segs []string) *listingFolder {
	cur := t.folders[""]
	prefix := ""
	for _, s := range segs {
		cur.folders[s] = true
		prefix += s + "/"
		next, ok := t.folders[prefix]
		if !ok {
			next = &listingFolder{prefix: prefix, folders: map[string]bool{}}
			t.folders[prefix] = next
		}
		cur = next
	}
	return cur
}

func validListingSegments(segs []string) bool {
	for _, s := range segs {
		if s == "" || s == "." || s == ".." {
			return false
		}
	}
	return true
}

// buildListingTree sorts every key into folders. Keys named indexDoc are not
// listed: they are the pages themselves (ours, or a folder's own page). An
// index document in a folder that holds nothing else is returned in
// indexOnly for the caller to classify, because whether that folder exists
// depends on who wrote the page.
func buildListingTree(objs []listingObject, indexDoc string) (*listingTree, map[string]listingObject) {
	t := newListingTree()
	indexes := map[string]listingObject{}

	for _, o := range objs {
		// The trailing slash is checked before the base name is compared, so a
		// folder marker named "index.html/" is a folder, not an index page.
		marker := strings.HasSuffix(o.key, "/")
		segs := strings.Split(strings.TrimSuffix(o.key, "/"), "/")
		if !validListingSegments(segs) {
			t.unlisted++
			continue
		}
		if marker {
			t.ensure(segs)
			continue
		}
		dir, base := segs[:len(segs)-1], segs[len(segs)-1]
		if base == indexDoc {
			indexes[listingPrefix(dir)] = o
			continue
		}
		f := t.ensure(dir)
		f.files = append(f.files, listingFile{name: base, size: o.size, modified: o.modified})
		t.objects++
	}

	indexOnly := map[string]listingObject{}
	for prefix, o := range indexes {
		if f, ok := t.folders[prefix]; ok {
			o := o
			f.index = &o
		} else {
			indexOnly[prefix] = o
		}
	}
	return t, indexOnly
}

func listingPrefix(segs []string) string {
	if len(segs) == 0 {
		return ""
	}
	return strings.Join(segs, "/") + "/"
}

func listingSegments(prefix string) []string {
	if prefix == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(prefix, "/"), "/")
}

// --- rendering ------------------------------------------------------------

type listingCrumb struct {
	Name string
	Href string
}

type listingRow struct {
	Name     string
	Href     string
	Dir      bool
	Size     string
	Bytes    int64
	Modified string
}

type listingPageData struct {
	Path    string
	Crumbs  []listingCrumb
	Parent  bool
	Rows    []listingRow
	Hidden  int
	Summary string
}

// listingPageTemplate is self-contained: inline CSS, no script, no external
// fetch, and a meta CSP that forbids anything else. Every link is relative,
// so the page works whatever host or path the site is served under.
var listingPageTemplate = template.Must(template.New("listing").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Garage WebUI-NG">
<title>Index of {{.Path}}</title>
<style>
:root{color-scheme:light dark;--fg:#1f2328;--muted:#59636e;--bg:#fff;--line:#d1d9e0;--link:#0969da;--hover:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#9198a1;--bg:#0d1117;--line:#30363d;--link:#4493f8;--hover:#151b23}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:2rem 1rem}
h1{font-size:1.25rem;font-weight:600;margin:0 0 1rem;overflow-wrap:anywhere}
h1 a{color:inherit}
a{color:var(--link);text-decoration:none}
a:hover{text-decoration:underline}
table{width:100%;border-collapse:collapse}
th,td{padding:.4rem .6rem;text-align:left;border-bottom:1px solid var(--line)}
th{font-size:.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
td.n{overflow-wrap:anywhere}
.s,.d{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
.s{text-align:right}
tbody tr:hover{background:var(--hover)}
p.note,footer{font-size:.8rem;color:var(--muted)}
footer{margin-top:1.5rem}
</style>
</head>
<body>
<main>
<h1>Index of {{range .Crumbs}}<a href="{{.Href}}">{{.Name}}</a>{{end}}</h1>
<table>
<thead><tr><th>Name</th><th class="s">Size</th><th class="d">Last modified (UTC)</th></tr></thead>
<tbody>
{{- if .Parent}}
<tr><td class="n"><a href="../">../</a></td><td class="s">-</td><td class="d">-</td></tr>
{{- end}}
{{- range .Rows}}
<tr><td class="n"><a href="{{.Href}}">{{.Name}}</a></td>{{if .Dir}}<td class="s">-</td><td class="d">-</td>{{else}}<td class="s" title="{{.Bytes}} bytes">{{.Size}}</td><td class="d">{{.Modified}}</td>{{end}}</tr>
{{- end}}
</tbody>
</table>
{{- if not .Rows}}
<p class="note">This folder is empty.</p>
{{- end}}
{{- if .Hidden}}
<p class="note">{{.Hidden}} more entries are not shown.</p>
{{- end}}
<footer>{{.Summary}}<br>Generated by Garage WebUI-NG</footer>
</main>
</body>
</html>
`))

// renderListingPage renders a folder's page. It is deterministic: the same
// folder contents always give the same bytes, which is what lets a sync skip
// a page whose stored ETag (Garage uses the body's MD5) already matches. So
// nothing here may depend on the current time; the footer quotes the newest
// file's own timestamp instead.
func renderListingPage(f *listingFolder, unlisted int) ([]byte, error) {
	segs := listingSegments(f.prefix)
	depth := len(segs)

	data := listingPageData{
		Path:   "/" + f.prefix,
		Parent: depth > 0,
		Crumbs: []listingCrumb{{Name: "/", Href: listingUp(depth)}},
	}
	for i, s := range segs {
		data.Crumbs = append(data.Crumbs, listingCrumb{Name: s + "/", Href: listingUp(depth - i - 1)})
	}

	folders := make([]string, 0, len(f.folders))
	for name := range f.folders {
		folders = append(folders, name)
	}
	sort.Strings(folders)
	files := append([]listingFile(nil), f.files...)
	sort.Slice(files, func(i, j int) bool { return files[i].name < files[j].name })

	var newest time.Time
	for _, name := range folders {
		// "./" keeps a name such as "note:1" from being read as a URL scheme.
		data.Rows = append(data.Rows, listingRow{Name: name + "/", Href: "./" + url.PathEscape(name) + "/", Dir: true})
	}
	for _, file := range files {
		data.Rows = append(data.Rows, listingRow{
			Name:     file.name,
			Href:     "./" + url.PathEscape(file.name),
			Size:     humanListingSize(file.size),
			Bytes:    file.size,
			Modified: file.modified.UTC().Format("2006-01-02 15:04"),
		})
		if file.modified.After(newest) {
			newest = file.modified
		}
	}
	if len(data.Rows) > listingMaxRows {
		data.Hidden = len(data.Rows) - listingMaxRows
		data.Rows = data.Rows[:listingMaxRows]
	}

	summary := []string{plural(len(folders), "folder") + ", " + plural(len(files), "file")}
	if !newest.IsZero() {
		summary = append(summary, "newest file "+newest.UTC().Format("2006-01-02 15:04")+" UTC")
	}
	if unlisted > 0 {
		summary = append(summary, plural(unlisted, "object")+" not listed because the name cannot be linked")
	}
	data.Summary = strings.Join(summary, " · ")

	var buf bytes.Buffer
	if err := listingPageTemplate.Execute(&buf, data); err != nil {
		return nil, fmt.Errorf("cannot render listing page: %w", err)
	}
	return buf.Bytes(), nil
}

func listingUp(levels int) string {
	if levels <= 0 {
		return "./"
	}
	return strings.Repeat("../", levels)
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func humanListingSize(n int64) string {
	if n < 1024 {
		return fmt.Sprintf("%d B", n)
	}
	units := []string{"KiB", "MiB", "GiB", "TiB", "PiB", "EiB"}
	v := float64(n)
	i := -1
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	return fmt.Sprintf("%.1f %s", v, units[i])
}

func md5Hex(b []byte) string {
	sum := md5.Sum(b)
	return hex.EncodeToString(sum[:])
}

// --- sync -----------------------------------------------------------------

type listingResult struct {
	folders, objects, written, unchanged, deleted, userPages, unlisted int
	partial                                                            bool
}

func (r listingResult) record(err error) schema.DirectoryListingSync {
	rec := schema.DirectoryListingSync{
		At:        time.Now().UTC(),
		Folders:   r.folders,
		Objects:   r.objects,
		Written:   r.written,
		Unchanged: r.unchanged,
		Deleted:   r.deleted,
		UserPages: r.userPages,
		Unlisted:  r.unlisted,
		Partial:   r.partial,
	}
	if err != nil {
		rec.Error = err.Error()
	}
	return rec
}

// firstError keeps the first error reported by any of a run's workers.
type firstError struct {
	mu  sync.Mutex
	err error
	n   int
}

func (e *firstError) add(err error) {
	if err == nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.err == nil {
		e.err = err
	}
	e.n++
}

func (e *firstError) get() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.n > 1 {
		return fmt.Errorf("%w (and %d more errors)", e.err, e.n-1)
	}
	return e.err
}

// syncListing brings every folder page of bucket up to date. The caller must
// hold the bucket's listing lock.
//
// The root is checked first, under that lock: in listingUpdate mode an absent
// or foreign root means listing is off and nothing is written, and in
// listingCreate mode a foreign root is a conflict. The root page is then
// written before any other, so a run that fails halfway still leaves the
// listing enabled and the next refresh finishes it.
func syncListing(ctx context.Context, client *s3.Client, bucket, indexDoc string, mode listingMode) (listingResult, error) {
	var res listingResult

	rootState, err := headIndex(ctx, client, bucket, indexDoc)
	if err != nil {
		return res, err
	}
	switch {
	case rootState == indexForeign && mode == listingCreate:
		return res, errListingConflict
	case rootState != indexGenerated && mode == listingUpdate:
		return res, errListingNotEnabled
	}

	objs, complete, err := walkListingObjects(ctx, client, bucket, listingWalkMaxPages, nil)
	if err != nil {
		return res, err
	}
	if !complete {
		return res, fmt.Errorf("%w (more than %d)", errListingTooLarge, int(listingWalkPageSize)*listingWalkMaxPages)
	}

	tree, indexOnly := buildListingTree(objs, indexDoc)
	res.objects, res.unlisted = tree.objects, tree.unlisted
	errs := &firstError{}

	// A folder that holds nothing but an index page exists only if that page
	// is someone else's; one of ours there is stale, left behind when the
	// folder emptied. Apply every foreign page before judging the stale ones,
	// because a foreign page deeper down keeps its parent folders alive.
	type classified struct {
		prefix string
		obj    listingObject
		state  indexState
	}
	results := make([]*classified, 0, len(indexOnly))
	for p, o := range indexOnly {
		results = append(results, &classified{prefix: p, obj: o})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].prefix < results[j].prefix })
	// A HEAD that fails leaves the page absent from both sets below: it is
	// neither listed nor deleted this run.
	runBounded(results, func(c *classified) {
		var err error
		c.state, err = headIndex(ctx, client, bucket, c.prefix+indexDoc)
		errs.add(err)
	})
	for _, c := range results {
		if c.state == indexForeign {
			f := tree.ensure(listingSegments(c.prefix))
			o := c.obj
			f.index, f.foreign = &o, true
		}
	}
	var stale []string
	for _, c := range results {
		if c.state != indexGenerated {
			continue
		}
		if f, ok := tree.folders[c.prefix]; ok {
			o := c.obj
			f.index = &o
		} else {
			stale = append(stale, c.prefix+indexDoc)
		}
	}
	res.folders = len(tree.folders)

	var written, unchanged, userPages, deleted atomic.Int64
	var partial atomic.Bool
	writePage := func(f *listingFolder) (wrote bool, err error) {
		if f.foreign {
			userPages.Add(1)
			return false, nil
		}
		unlisted := 0
		if f.prefix == "" {
			unlisted = tree.unlisted
		}
		body, err := renderListingPage(f, unlisted)
		if err != nil {
			return false, err
		}
		if f.index != nil && f.index.etag == md5Hex(body) {
			unchanged.Add(1)
			return false, nil
		}
		if written.Add(1) > int64(listingMaxWrites) {
			written.Add(-1)
			partial.Store(true)
			return false, nil
		}
		key := f.prefix + indexDoc
		state, err := headIndex(ctx, client, bucket, key)
		if err != nil {
			written.Add(-1)
			return false, err
		}
		if state == indexForeign {
			written.Add(-1)
			userPages.Add(1)
			return false, nil
		}
		if err := putListingPage(ctx, client, bucket, key, body); err != nil {
			written.Add(-1)
			return false, err
		}
		return true, nil
	}

	// The root first, alone.
	root := tree.folders[""]
	if _, err := writePage(root); err != nil {
		return res, err
	}
	if root.foreign || userPages.Load() > 0 {
		// Someone put their own root page in place while this run was
		// walking the bucket. Leave every other folder alone too.
		return res, errListingConflict
	}

	rest := make([]*listingFolder, 0, len(tree.folders)-1)
	for prefix, f := range tree.folders {
		if prefix != "" {
			rest = append(rest, f)
		}
	}
	sort.Slice(rest, func(i, j int) bool { return rest[i].prefix < rest[j].prefix })
	runBounded(rest, func(f *listingFolder) {
		if ctx.Err() != nil {
			errs.add(ctx.Err())
			return
		}
		_, err := writePage(f)
		errs.add(err)
	})

	runBounded(stale, func(key string) {
		ok, err := deleteListingPage(ctx, client, bucket, key)
		errs.add(err)
		if ok {
			deleted.Add(1)
		}
	})

	res.written = int(written.Load())
	res.unchanged = int(unchanged.Load())
	res.userPages = int(userPages.Load())
	res.deleted = int(deleted.Load())
	res.partial = partial.Load()
	return res, errs.get()
}

// removeListing deletes every generated page in the bucket, root first, so a
// removal interrupted halfway already reads as disabled and the background
// refresher (which never creates a root page) cannot bring it back. Pages
// someone else wrote are left alone. It works whatever state the root is in,
// which is how stray pages are cleaned up after a conflict, and it never
// touches the bucket's website configuration. The caller must hold the
// bucket's listing lock.
func removeListing(ctx context.Context, client *s3.Client, bucket, indexDoc string) (int, error) {
	deleted := 0
	ok, err := deleteListingPage(ctx, client, bucket, indexDoc)
	if err != nil {
		return 0, err
	}
	if ok {
		deleted++
	}

	suffix := "/" + indexDoc
	objs, _, err := walkListingObjects(ctx, client, bucket, 0, func(key string) bool {
		return strings.HasSuffix(key, suffix)
	})
	if err != nil {
		return deleted, err
	}

	var n atomic.Int64
	errs := &firstError{}
	runBounded(objs, func(o listingObject) {
		ok, err := deleteListingPage(ctx, client, bucket, o.key)
		errs.add(err)
		if ok {
			n.Add(1)
		}
	})
	return deleted + int(n.Load()), errs.get()
}

// --- handlers -------------------------------------------------------------

type Listing struct{}

// GET /listing/{bucket} — whether directory listing is on, and how the last
// run went. A read: it HEADs one object and changes nothing, so a viewer may
// call it.
func (l *Listing) GetStatus(w http.ResponseWriter, r *http.Request) {
	bucket := r.PathValue("bucket")
	info, err := fetchBucketByAlias(bucket)
	if err != nil {
		utils.ResponseError(w, err)
		return
	}

	status := schema.DirectoryListingStatus{
		WebsiteAccess: info.WebsiteAccess,
		IndexDocument: info.WebsiteConfig.IndexDocument,
		Pending:       listingLocked(info.ID) || listingPending(bucket),
		LastSync:      lastListingSync(info.ID),
	}
	if status.IndexDocument == "" {
		status.IndexDocument = defaultIndexDocument
	}

	indexDoc, err := listingIndexDocument(info)
	if err != nil {
		status.Reason = err.Error()
		utils.ResponseSuccess(w, status)
		return
	}
	client, err := getS3Client(bucket)
	if err != nil {
		status.Reason = err.Error()
		utils.ResponseSuccess(w, status)
		return
	}
	state, err := headIndex(r.Context(), client, bucket, indexDoc)
	if err != nil {
		utils.ResponseError(w, err)
		return
	}

	status.Available = true
	status.Enabled = state == indexGenerated
	status.Conflict = state == indexForeign
	utils.ResponseSuccess(w, status)
}

// PUT /listing/{bucket} — generate the pages now: enables listing, or
// refreshes it if it is already on.
func (l *Listing) Enable(w http.ResponseWriter, r *http.Request) {
	bucket := r.PathValue("bucket")
	info, err := fetchBucketByAlias(bucket)
	if err != nil {
		utils.ResponseError(w, err)
		return
	}
	if !info.WebsiteAccess {
		utils.ResponseErrorStatus(w, errors.New("turn on website access for this bucket first"), http.StatusBadRequest)
		return
	}
	indexDoc, err := listingIndexDocument(info)
	if err != nil {
		utils.ResponseErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	client, err := getS3Client(bucket)
	if err != nil {
		utils.ResponseError(w, err)
		return
	}

	unlock, ok := tryLockListing(info.ID)
	if !ok {
		utils.ResponseErrorStatus(w, errListingBusy, http.StatusConflict)
		return
	}
	defer unlock()

	// Detached from the request: a browser navigating away must not leave the
	// bucket half-generated.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), listingSyncTimeout)
	defer cancel()

	res, err := syncListing(ctx, client, bucket, indexDoc, listingCreate)
	if errors.Is(err, errListingConflict) {
		utils.ResponseErrorStatus(w, err, http.StatusConflict)
		return
	}
	rec := res.record(err)
	recordListingSync(info.ID, rec)
	if errors.Is(err, errListingTooLarge) {
		utils.ResponseErrorStatus(w, err, http.StatusUnprocessableEntity)
		return
	}
	if err != nil {
		utils.ResponseError(w, err)
		return
	}
	utils.ResponseSuccess(w, rec)
}

// DELETE /listing/{bucket} — remove every generated page. Website access and
// the bucket's website configuration are left exactly as they are, so every
// direct object URL keeps working; only folder URLs stop resolving.
func (l *Listing) Disable(w http.ResponseWriter, r *http.Request) {
	bucket := r.PathValue("bucket")
	info, err := fetchBucketByAlias(bucket)
	if err != nil {
		utils.ResponseError(w, err)
		return
	}
	indexDoc, err := listingIndexDocument(info)
	if err != nil {
		utils.ResponseErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	client, err := getS3Client(bucket)
	if err != nil {
		utils.ResponseError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), listingSyncTimeout)
	defer cancel()

	lockCtx, cancelLock := context.WithTimeout(ctx, listingLockWait)
	unlock, err := lockListing(lockCtx, info.ID)
	cancelLock()
	if err != nil {
		utils.ResponseErrorStatus(w, errListingBusy, http.StatusConflict)
		return
	}
	defer unlock()

	deleted, err := removeListing(ctx, client, bucket, indexDoc)
	forgetListingSync(info.ID)
	if err != nil {
		utils.ResponseError(w, fmt.Errorf("removed %d pages, then: %w", deleted, err))
		return
	}
	utils.ResponseSuccess(w, schema.DirectoryListingRemoval{Deleted: deleted})
}

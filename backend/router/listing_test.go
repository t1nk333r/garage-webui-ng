package router

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/d7eeem/garage-webui-ng/schema"
)

var generatedMeta = map[string]string{listingMarkerKey: listingMarkerValue}

// newListingFixture is newS3Fixture for a bucket with website access on and
// the default index document.
func newListingFixture(t *testing.T, bucket string) *s3Fixture {
	t.Helper()
	f := newS3Fixture(t, bucket)
	f.SetWebsite(true, "index.html")
	return f
}

// serveListing sends one request through the three listing routes exactly as
// router.go registers them, without the auth middleware (covered in
// middleware/auth_test.go).
func serveListing(t *testing.T, method, bucket string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	l := &Listing{}
	mux.HandleFunc("GET /listing/{bucket}", l.GetStatus)
	mux.HandleFunc("PUT /listing/{bucket}", l.Enable)
	mux.HandleFunc("DELETE /listing/{bucket}", l.Disable)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(method, "/listing/"+bucket, nil))
	return rec
}

func mustListing(t *testing.T, method, bucket string, want int) *httptest.ResponseRecorder {
	t.Helper()
	rec := serveListing(t, method, bucket)
	if rec.Code != want {
		t.Fatalf("%s /listing/%s = %d, want %d; body: %s", method, bucket, rec.Code, want, rec.Body.String())
	}
	return rec
}

func listingStatus(t *testing.T, bucket string) schema.DirectoryListingStatus {
	t.Helper()
	rec := mustListing(t, http.MethodGet, bucket, http.StatusOK)
	var status schema.DirectoryListingStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("cannot decode status: %v", err)
	}
	return status
}

// countS3 counts recorded S3 requests with method whose path is under the
// fixture's bucket and satisfies match (nil matches all).
func countS3(f *s3Fixture, method string, match func(fixtureRequest) bool) int {
	n := 0
	for _, r := range f.Requests() {
		if r.Method == method && (match == nil || match(r)) {
			n++
		}
	}
	return n
}

func isWalk(r fixtureRequest) bool { return r.Query.Get("list-type") == "2" }

func objectKeyOf(f *s3Fixture, r fixtureRequest) string {
	return strings.TrimPrefix(r.Path, "/"+f.bucket+"/")
}

// assertGenerated checks that key holds a page this tool wrote.
func assertGenerated(t *testing.T, f *s3Fixture, key string) string {
	t.Helper()
	obj, ok := f.Object(key)
	if !ok {
		t.Fatalf("%s was not written", key)
	}
	if !isGeneratedListing(obj.metadata) {
		t.Errorf("%s has no generated-page marker; metadata %v", key, obj.metadata)
	}
	if obj.cacheControl != "no-cache" {
		t.Errorf("%s Cache-Control = %q, want no-cache", key, obj.cacheControl)
	}
	if obj.contentType != "text/html; charset=utf-8" {
		t.Errorf("%s Content-Type = %q", key, obj.contentType)
	}
	return string(obj.body)
}

func TestListingEnableEmptyBucket(t *testing.T) {
	const bucket = "listing-empty"
	f := newListingFixture(t, bucket)

	mustListing(t, http.MethodPut, bucket, http.StatusOK)

	body := assertGenerated(t, f, "index.html")
	for _, want := range []string{"<title>Index of /</title>", "This folder is empty.", "Content-Security-Policy"} {
		if !strings.Contains(body, want) {
			t.Errorf("root page lacks %q", want)
		}
	}
	if strings.Contains(body, `href="../"`) {
		t.Error("the root page links to a parent folder")
	}
	if got := f.Keys(); len(got) != 1 {
		t.Errorf("keys after enabling an empty bucket = %v, want only index.html", got)
	}

	status := listingStatus(t, bucket)
	if !status.Enabled || status.Conflict || !status.Available || !status.WebsiteAccess {
		t.Errorf("status = %+v, want enabled and available", status)
	}
	if status.LastSync == nil || status.LastSync.Written != 1 {
		t.Errorf("last sync = %+v, want one page written", status.LastSync)
	}
}

func TestListingWritesAPagePerFolder(t *testing.T) {
	const bucket = "listing-folders"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.mp3", "aaa", "audio/mpeg")
	f.PutTestObject("hp/x.png", "x", "image/png")
	f.PutTestObject("hp/deep/y.png", "y", "image/png")
	f.PutTestObject("hp/", "", "")
	f.PutTestObject("only-marker/", "", "")
	f.PutTestObject("odd/note:1.txt", "1", "text/plain")
	f.PutTestObject("odd/with space@x.txt", "2", "text/plain")
	f.PutTestObject("odd/ünï.txt", "3", "text/plain")
	f.PutTestObject("odd/<script>.txt", "4", "text/plain")

	rec := mustListing(t, http.MethodPut, bucket, http.StatusOK)
	var sync schema.DirectoryListingSync
	if err := json.Unmarshal(rec.Body.Bytes(), &sync); err != nil {
		t.Fatal(err)
	}
	if sync.Folders != 5 || sync.Objects != 7 || sync.Written != 5 {
		t.Errorf("sync = %+v, want 5 folders, 7 objects, 5 written", sync)
	}

	root := assertGenerated(t, f, "index.html")
	for _, want := range []string{`href="./hp/"`, `href="./odd/"`, `href="./only-marker/"`, `href="./a.mp3"`} {
		if !strings.Contains(root, want) {
			t.Errorf("root page lacks %s", want)
		}
	}
	// Folders before files.
	if strings.Index(root, `href="./only-marker/"`) > strings.Index(root, `href="./a.mp3"`) {
		t.Error("root page lists files before folders")
	}

	deep := assertGenerated(t, f, "hp/deep/index.html")
	for _, want := range []string{
		`<title>Index of /hp/deep/</title>`,
		`<a href="../../">/</a><a href="../">hp/</a><a href="./">deep/</a>`,
		`<a href="../">../</a>`,
		`href="./y.png"`,
	} {
		if !strings.Contains(deep, want) {
			t.Errorf("hp/deep page lacks %s", want)
		}
	}

	assertGenerated(t, f, "only-marker/index.html")

	odd := assertGenerated(t, f, "odd/index.html")
	for _, want := range []string{
		`href="./note:1.txt"`,
		`href="./with%20space@x.txt"`,
		`href="./%C3%BCn%C3%AF.txt"`,
		`href="./%3Cscript%3E.txt"`,
		`&lt;script&gt;.txt`,
	} {
		if !strings.Contains(odd, want) {
			t.Errorf("odd page lacks %s", want)
		}
	}
	// The page's own sort script is the one <script> allowed.
	if n := strings.Count(odd, "<script"); n != 1 {
		t.Errorf("odd page has %d <script> tags, want only the sort script: an object name reached the page unescaped", n)
	}

	for _, key := range f.Keys() {
		if !strings.HasSuffix(key, "index.html") {
			continue
		}
		if page := f.ObjectBody(key); strings.Contains(page, `href="./index.html"`) {
			t.Errorf("%s lists itself", key)
		}
	}
}

// renderSampleListingPage renders hp/ holding a folder and one file.
func renderSampleListingPage(t *testing.T) string {
	t.Helper()
	page, err := renderListingPage(&listingFolder{
		prefix:  "hp/",
		folders: map[string]bool{"deep": true},
		files:   []listingFile{{name: "x.png", size: 2048, modified: time.Unix(1700000000, 0)}},
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	return string(page)
}

// The sort script runs only because the CSP names its hash. A change to the
// script without the hash, or html/template rewriting it (it strips JS
// comments), would leave every table silently unsortable.
func TestListingPageScriptMatchesItsHash(t *testing.T) {
	body := renderSampleListingPage(t)

	if !strings.Contains(body, "<script>"+listingScript+"</script>") {
		t.Fatal("the rendered page does not carry listingScript byte for byte")
	}
	sum := sha256.Sum256([]byte(listingScript))
	want := "script-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "';"
	if !strings.Contains(body, want) {
		t.Errorf("CSP lacks %s", want)
	}
}

// The script sorts the rows of tbody#entries by their data attributes: files
// carry size and time, folders carry neither, and the parent link sits
// outside so it stays on top.
func TestListingPageRowsCarrySortKeys(t *testing.T) {
	body := renderSampleListingPage(t)

	entries := strings.Index(body, `<tbody id="entries">`)
	parent := strings.Index(body, `<a href="../">../</a>`)
	if entries < 0 || parent < 0 || parent > entries {
		t.Errorf("parent row at %d, entries body at %d: the parent link must come before the sortable rows", parent, entries)
	}
	for _, want := range []string{
		`<tr><td class="n"><a href="./deep/">deep/</a>`,
		`<tr data-size="2048" data-time="1700000000"><td class="n"><a href="./x.png">x.png</a>`,
		`<th scope="col" data-sort="name" aria-sort="ascending">Name</th>`,
		`data-sort="size"`,
		`data-sort="time"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %s", want)
		}
	}
}

func TestListingLeavesUnlinkableKeysOut(t *testing.T) {
	const bucket = "listing-unlinkable"
	f := newListingFixture(t, bucket)
	f.PutTestObject("ok.txt", "1", "text/plain")
	f.PutTestObject("a//b.txt", "1", "text/plain")
	f.PutTestObject("z/./w.txt", "1", "text/plain")
	f.PutTestObject("y/../v.txt", "1", "text/plain")

	rec := mustListing(t, http.MethodPut, bucket, http.StatusOK)
	var sync schema.DirectoryListingSync
	_ = json.Unmarshal(rec.Body.Bytes(), &sync)
	if sync.Unlisted != 3 || sync.Objects != 1 || sync.Folders != 1 {
		t.Errorf("sync = %+v, want 3 unlisted, 1 object, only the root folder", sync)
	}
	root := assertGenerated(t, f, "index.html")
	if !strings.Contains(root, "3 objects not listed") {
		t.Error("root page does not say how many objects it left out")
	}
}

func TestListingRefusesAForeignRootIndex(t *testing.T) {
	const bucket = "listing-foreign-root"
	f := newListingFixture(t, bucket)
	f.PutTestObject("index.html", "<h1>my site</h1>", "text/html")
	f.PutTestObject("hp/x.png", "x", "image/png")

	mustListing(t, http.MethodPut, bucket, http.StatusConflict)

	if got := f.ObjectBody("index.html"); got != "<h1>my site</h1>" {
		t.Errorf("foreign index changed to %q", got)
	}
	if n := countS3(f, http.MethodPut, nil); n != 0 {
		t.Errorf("%d objects written despite the conflict", n)
	}
	status := listingStatus(t, bucket)
	if status.Enabled || !status.Conflict {
		t.Errorf("status = %+v, want a conflict", status)
	}
}

func TestListingSkipsAFolderWithItsOwnIndex(t *testing.T) {
	const bucket = "listing-foreign-folder"
	f := newListingFixture(t, bucket)
	f.PutTestObject("site/index.html", "<h1>mine</h1>", "text/html")
	f.PutTestObject("site/page.html", "p", "text/html")
	f.PutTestObject("blog/index.html", "<h1>blog</h1>", "text/html") // nothing else in blog/
	f.PutTestObject("other/f.txt", "f", "text/plain")

	rec := mustListing(t, http.MethodPut, bucket, http.StatusOK)
	var sync schema.DirectoryListingSync
	_ = json.Unmarshal(rec.Body.Bytes(), &sync)
	if sync.UserPages != 2 || sync.Written != 2 {
		t.Errorf("sync = %+v, want 2 user pages skipped and 2 written", sync)
	}

	if got := f.ObjectBody("site/index.html"); got != "<h1>mine</h1>" {
		t.Errorf("site/index.html changed to %q", got)
	}
	if got := f.ObjectBody("blog/index.html"); got != "<h1>blog</h1>" {
		t.Errorf("blog/index.html changed to %q", got)
	}
	assertGenerated(t, f, "other/index.html")
	root := assertGenerated(t, f, "index.html")
	for _, want := range []string{`href="./site/"`, `href="./blog/"`, `href="./other/"`} {
		if !strings.Contains(root, want) {
			t.Errorf("root page lacks %s", want)
		}
	}
}

func TestListingSecondRunWithNoChangesWritesNothing(t *testing.T) {
	const bucket = "listing-quiet"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")
	f.PutTestObject("hp/x.png", "x", "image/png")
	f.PutTestObject("hp/deep/y.png", "y", "image/png")
	mustListing(t, http.MethodPut, bucket, http.StatusOK)

	heads, puts := countS3(f, http.MethodHead, nil), countS3(f, http.MethodPut, nil)
	rec := mustListing(t, http.MethodPut, bucket, http.StatusOK)

	// One HEAD of the root decides whether listing is on; nothing else.
	if n := countS3(f, http.MethodHead, nil) - heads; n != 1 {
		t.Errorf("second run made %d HEAD requests, want 1", n)
	}
	if n := countS3(f, http.MethodPut, nil) - puts; n != 0 {
		t.Errorf("second run wrote %d pages, want 0", n)
	}
	var sync schema.DirectoryListingSync
	_ = json.Unmarshal(rec.Body.Bytes(), &sync)
	if sync.Unchanged != 3 || sync.Written != 0 {
		t.Errorf("sync = %+v, want 3 unchanged", sync)
	}
}

func TestListingDeletesPagesOfEmptiedFolders(t *testing.T) {
	const bucket = "listing-stale"
	f := newListingFixture(t, bucket)
	f.PutTestObject("keep.txt", "k", "text/plain")
	f.PutTestObject("a/b/c.txt", "c", "text/plain")
	mustListing(t, http.MethodPut, bucket, http.StatusOK)
	assertGenerated(t, f, "a/index.html")
	assertGenerated(t, f, "a/b/index.html")

	f.mu.Lock()
	delete(f.objects, "a/b/c.txt")
	f.mu.Unlock()

	rec := mustListing(t, http.MethodPut, bucket, http.StatusOK)
	var sync schema.DirectoryListingSync
	_ = json.Unmarshal(rec.Body.Bytes(), &sync)
	if sync.Deleted != 2 {
		t.Errorf("sync = %+v, want 2 stale pages deleted", sync)
	}
	for _, key := range []string{"a/index.html", "a/b/index.html"} {
		if f.HasObject(key) {
			t.Errorf("stale page %s survived", key)
		}
	}
	if root := f.ObjectBody("index.html"); strings.Contains(root, `href="./a/"`) {
		t.Error("root page still lists the emptied folder")
	}
}

func TestListingBackgroundRunNeverEnables(t *testing.T) {
	const bucket = "listing-update-mode"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")
	client, err := getS3Client(bucket)
	if err != nil {
		t.Fatal(err)
	}

	// Absent root: listing was never on, or was switched off while the
	// refresh waited for the lock.
	if _, err := syncListing(context.Background(), client, bucket, "index.html", listingUpdate); !errors.Is(err, errListingNotEnabled) {
		t.Errorf("update with no root page: err = %v, want errListingNotEnabled", err)
	}
	// Foreign root.
	f.PutTestObject("index.html", "<h1>mine</h1>", "text/html")
	if _, err := syncListing(context.Background(), client, bucket, "index.html", listingUpdate); !errors.Is(err, errListingNotEnabled) {
		t.Errorf("update with a foreign root: err = %v, want errListingNotEnabled", err)
	}
	if n := countS3(f, http.MethodPut, nil); n != 0 {
		t.Errorf("background runs wrote %d objects", n)
	}
	if n := countS3(f, http.MethodGet, isWalk); n != 0 {
		t.Errorf("background runs walked the bucket %d times before checking the root", n)
	}
}

func TestListingDisableRemovesOnlyGeneratedPages(t *testing.T) {
	const bucket = "listing-disable"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")
	f.PutTestObject("hp/x.png", "x", "image/png")
	f.PutTestObject("hp/deep/y.png", "y", "image/png")
	f.PutTestObject("site/index.html", "<h1>mine</h1>", "text/html")
	f.PutTestObject("site/p.html", "p", "text/html")
	mustListing(t, http.MethodPut, bucket, http.StatusOK)
	deletesBefore := len(f.Requests())

	rec := mustListing(t, http.MethodDelete, bucket, http.StatusOK)
	var removal schema.DirectoryListingRemoval
	_ = json.Unmarshal(rec.Body.Bytes(), &removal)
	if removal.Deleted != 3 {
		t.Errorf("deleted %d pages, want 3", removal.Deleted)
	}

	for _, key := range []string{"index.html", "hp/index.html", "hp/deep/index.html"} {
		if f.HasObject(key) {
			t.Errorf("%s survived", key)
		}
	}
	if got := f.ObjectBody("site/index.html"); got != "<h1>mine</h1>" {
		t.Errorf("a page this tool did not write was changed or removed: %q", got)
	}
	for _, key := range []string{"a.txt", "hp/x.png", "hp/deep/y.png", "site/p.html"} {
		if !f.HasObject(key) {
			t.Errorf("content object %s was removed", key)
		}
	}

	// The root goes first, so an interrupted removal already reads as off.
	for _, r := range f.Requests()[deletesBefore:] {
		if r.Method == http.MethodDelete {
			if got := objectKeyOf(f, r); got != "index.html" {
				t.Errorf("first DELETE was %q, want the root page", got)
			}
			break
		}
	}
	for _, p := range f.AdminPaths() {
		if strings.Contains(p, "UpdateBucket") {
			t.Errorf("disabling the listing called %s", p)
		}
	}
	if status := listingStatus(t, bucket); status.Enabled || !status.WebsiteAccess {
		t.Errorf("status after disable = %+v", status)
	}
}

func TestListingRefusesABucketTooLargeToList(t *testing.T) {
	const bucket = "listing-too-large"
	f := newListingFixture(t, bucket)
	prevSize, prevPages := listingWalkPageSize, listingWalkMaxPages
	listingWalkPageSize, listingWalkMaxPages = 2, 2
	t.Cleanup(func() { listingWalkPageSize, listingWalkMaxPages = prevSize, prevPages })
	for _, k := range []string{"a", "b", "c", "d", "e"} {
		f.PutTestObject(k, k, "text/plain")
	}

	mustListing(t, http.MethodPut, bucket, http.StatusUnprocessableEntity)
	if n := countS3(f, http.MethodPut, nil); n != 0 {
		t.Errorf("%d pages written for a bucket too large to list", n)
	}
}

func TestListingEnableWhileBusy(t *testing.T) {
	const bucket = "listing-busy"
	f := newListingFixture(t, bucket)
	unlock, ok := tryLockListing(f.BucketID())
	if !ok {
		t.Fatal("lock already held")
	}
	defer unlock()

	mustListing(t, http.MethodPut, bucket, http.StatusConflict)
	if status := listingStatus(t, bucket); !status.Pending {
		t.Error("status does not report the running update as pending")
	}
}

func TestListingNeedsWebsiteAccess(t *testing.T) {
	const bucket = "listing-no-website"
	f := newS3Fixture(t, bucket)
	f.SetWebsite(false, "")

	mustListing(t, http.MethodPut, bucket, http.StatusBadRequest)
	status := listingStatus(t, bucket)
	if status.WebsiteAccess || status.Enabled || status.IndexDocument != "index.html" {
		t.Errorf("status = %+v", status)
	}
}

// --- ownership re-checks ---------------------------------------------------
//
// These answer HEAD differently from what is stored, so they fail if the
// re-check before a write or a delete is removed.

// headAs answers a HEAD for key as a generated page (marked=true) or as
// someone else's object.
func headAs(w http.ResponseWriter, marked bool) {
	if marked {
		w.Header().Set("X-Amz-Meta-"+listingMarkerKey, listingMarkerValue)
	}
	w.Header().Set("Content-Length", "1")
	w.WriteHeader(http.StatusOK)
}

func TestListingWriteRechecksOwnership(t *testing.T) {
	const bucket = "listing-recheck-write"
	f := newListingFixture(t, bucket)
	f.PutTestObject("hp/x.png", "x", "image/png")
	// Stored as ours, with an ETag that does not match the render, so the
	// write path must decide by HEAD alone.
	f.PutTestObjectMeta("hp/index.html", "old page", "text/html", generatedMeta)
	f.onHeadObject = func(w http.ResponseWriter, r *http.Request, key string) bool {
		if key != "hp/index.html" {
			return false
		}
		headAs(w, false)
		return true
	}

	mustListing(t, http.MethodPut, bucket, http.StatusOK)
	if got := f.ObjectBody("hp/index.html"); got != "old page" {
		t.Errorf("a page the HEAD said was not ours was overwritten: %q", got)
	}
}

func TestListingStaleDeleteRechecksOwnership(t *testing.T) {
	const bucket = "listing-recheck-stale"
	f := newListingFixture(t, bucket)
	f.PutTestObject("keep.txt", "k", "text/plain")
	f.PutTestObjectMeta("gone/index.html", "old page", "text/html", generatedMeta)
	var heads atomic.Int32
	f.onHeadObject = func(w http.ResponseWriter, r *http.Request, key string) bool {
		if key != "gone/index.html" {
			return false
		}
		// Ours when the run classifies it, someone else's by the time it
		// would be deleted.
		headAs(w, heads.Add(1) == 1)
		return true
	}

	mustListing(t, http.MethodPut, bucket, http.StatusOK)
	if heads.Load() < 2 {
		t.Fatalf("gone/index.html was HEADed %d times, want a classification and a re-check", heads.Load())
	}
	if !f.HasObject("gone/index.html") {
		t.Error("a page that stopped being ours was deleted")
	}
}

func TestListingDisableRechecksOwnership(t *testing.T) {
	const bucket = "listing-recheck-disable"
	f := newListingFixture(t, bucket)
	f.PutTestObjectMeta("index.html", "root", "text/html", generatedMeta)
	f.PutTestObjectMeta("hp/index.html", "page", "text/html", generatedMeta)
	f.onHeadObject = func(w http.ResponseWriter, r *http.Request, key string) bool {
		if key != "hp/index.html" {
			return false
		}
		headAs(w, false)
		return true
	}

	mustListing(t, http.MethodDelete, bucket, http.StatusOK)
	if !f.HasObject("hp/index.html") {
		t.Error("removal deleted a page the HEAD said was not ours")
	}
	if f.HasObject("index.html") {
		t.Error("removal kept the generated root page")
	}
}

// --- refresher ---------------------------------------------------------------

func startTestRefresher(t *testing.T, debounce time.Duration) *listingRefresher {
	t.Helper()
	lr := newListingRefresher(debounce, 0)
	lr.Start(context.Background())
	listingRefresh.Store(lr)
	t.Cleanup(func() {
		listingRefresh.CompareAndSwap(lr, nil)
		lr.Stop()
	})
	return lr
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestListingNotificationsCoalesce(t *testing.T) {
	const bucket = "listing-notify"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")
	mustListing(t, http.MethodPut, bucket, http.StatusOK)
	lr := startTestRefresher(t, 50*time.Millisecond)

	walks := countS3(f, http.MethodGet, isWalk)
	f.PutTestObject("hp/new.png", "n", "image/png")
	for i := 0; i < 5; i++ {
		notifyListing(bucket)
	}
	if !listingPending(bucket) {
		t.Error("a queued refresh is not reported as pending")
	}

	waitFor(t, "the refresh", func() bool { return !lr.Pending(bucket) && f.HasObject("hp/index.html") })
	assertGenerated(t, f, "hp/index.html")
	if n := countS3(f, http.MethodGet, isWalk) - walks; n != 1 {
		t.Errorf("five notifications caused %d walks, want 1", n)
	}
}

func TestListingNotifyWithoutListingWritesNothing(t *testing.T) {
	const bucket = "listing-notify-off"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")
	lr := startTestRefresher(t, 10*time.Millisecond)

	notifyListing(bucket)
	waitFor(t, "the refresh", func() bool { return !lr.Pending(bucket) })
	if n := countS3(f, http.MethodPut, nil); n != 0 {
		t.Errorf("a refresh of a bucket without listing wrote %d objects", n)
	}
}

func TestListingSweepRefreshesWebsiteBuckets(t *testing.T) {
	const bucket = "listing-sweep"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")
	mustListing(t, http.MethodPut, bucket, http.StatusOK)
	f.PutTestObject("hp/new.png", "n", "image/png")

	lr := newListingRefresher(time.Hour, 0)
	lr.sweep(context.Background())
	assertGenerated(t, f, "hp/index.html")

	// With website access off the sweep leaves the bucket alone.
	f.SetWebsite(false, "index.html")
	f.PutTestObject("later/z.png", "z", "image/png")
	lr.sweep(context.Background())
	if f.HasObject("later/index.html") {
		t.Error("the sweep refreshed a bucket without website access")
	}
}

func TestStopEndsTheRefresher(t *testing.T) {
	lr := newListingRefresher(time.Hour, time.Hour)
	lr.Start(context.Background())
	lr.Notify("never-runs")
	done := make(chan struct{})
	go func() {
		lr.Stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not return")
	}
	lr.Notify("after-stop")
	if lr.Pending("after-stop") {
		t.Error("a stopped refresher accepted a notification")
	}
}

func TestListingRefreshInterval(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want time.Duration
	}{
		{"", 10 * time.Minute},
		{"0", 0},
		{"3", 3 * time.Minute},
		{"-1", 10 * time.Minute},
		{"ten", 10 * time.Minute},
	} {
		t.Setenv("LISTING_REFRESH_INTERVAL_MINUTES", tc.raw)
		if got := listingRefreshInterval(); got != tc.want {
			t.Errorf("LISTING_REFRESH_INTERVAL_MINUTES=%q: %v, want %v", tc.raw, got, tc.want)
		}
	}
}

func TestHumanListingSize(t *testing.T) {
	for _, tc := range []struct {
		n    int64
		want string
	}{
		{0, "0 B"},
		{1023, "1023 B"},
		{1024, "1.0 KiB"},
		{1536, "1.5 KiB"},
		{5 << 20, "5.0 MiB"},
	} {
		if got := humanListingSize(tc.n); got != tc.want {
			t.Errorf("humanListingSize(%d) = %q, want %q", tc.n, got, tc.want)
		}
	}
}

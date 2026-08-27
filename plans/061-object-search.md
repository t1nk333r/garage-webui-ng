# Plan 061: Search a bucket for objects by name — recursive substring search with a hard scan cap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8e062cb..HEAD -- backend/router/browse.go backend/router/browse_test.go backend/router/router.go backend/schema/browse.go backend/middleware/auth.go src/pages/buckets/manage/browse/ docs/authentication.md README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `8e062cb`, 2026-08-26
- **Release track**: v4

## Why this matters

The object browser is folder-by-folder only: to find `invoice-2024-03.pdf`
somewhere under `customers/` you click into every sub-prefix. S3 has no
server-side search; the only primitive is `ListObjectsV2` **without** a
delimiter, which walks every key under a prefix in lexical order, 1000 per
page. A bounded client of that primitive gives a useful "find by name" for
the bucket sizes this UI is realistically used on, as long as it is honest
about when it stopped looking.

Design decisions, fixed here so the executor does not re-decide them:

- **Server-side walk, one endpoint** — `GET /api/search/{bucket}?q=&prefix=`.
  The backend pages through `ListObjectsV2` (no delimiter) under `prefix`,
  keeps keys whose **basename or full key** contains `q` case-insensitively,
  and stops at the first of: **200 matches**, **20 pages scanned (20 000
  keys)**, or end of listing. The response says which.
- **Own route, not under `/browse/{bucket}/…`** — `GET /browse/{bucket}/{key...}`
  serves objects; a literal `search` segment would shadow an object named
  `search`. (`/browse/{bucket}/archive` already made that trade; do not add a
  second one.)
- **Read-only** → a `GET`, so the viewer role gets it for free via
  `isViewerAllowed` (every non-`/admin/` GET is allowed). No middleware change.
- **UI**: a search box in the browse tab. ≥ 2 characters, debounced 300 ms,
  replaces the folder list with a flat result list showing the key relative
  to the current prefix; clicking a result navigates to its parent folder.
  A banner says "Showing first 200 matches" / "Stopped after scanning 20 000
  objects — narrow the search or start from a deeper folder" when truncated.

## Current state

- `backend/router/browse.go:31-88` — `GetObjects`: the folder listing.
  Builds `ListObjectsV2Input{Prefix, Delimiter:"/", MaxKeys, ContinuationToken}`,
  strips the prefix from keys, returns `schema.BrowseObjectResult`. **Reuse
  its shape and helpers (`getS3Client`, `browseObjectURL`, `normalizeListLimit`).**
- `backend/router/browse.go:873` — `const maxListKeys = 1000`.
- `backend/schema/browse.go:12-17` — `BrowserObject{ObjectKey, LastModified, Size, Url}`.
- `backend/router/router.go:52-66` — route registration; browse routes are
  `router.HandleFunc("GET /browse/{bucket}", browse.GetObjects)` etc.
- `backend/router/browse_test.go:890` — `newS3Fixture(t, bucket)`: fake admin +
  fake S3 servers wired via `t.Setenv`; `f.PutTestObject(key, body, ct)`,
  `f.Requests()` records what the handler sent (Method/Path/Query). Its
  `defaultListObjectsV2` (line 1087) honours `prefix`, `delimiter`,
  `max-keys` and `continuation-token`; `writeListObjectsV2` (line 1152) emits
  `IsTruncated`/`NextContinuationToken`. `TestGetObjects` (line 1609) is the
  pattern: `newGetObjectsRequest(bucket, url.Values{...})`, call the handler
  on an `httptest.NewRecorder()`, decode into the schema type, assert.
  **Bucket names must be unique per test** (credential cache).
- `src/pages/buckets/manage/browse/hooks.ts:17-30` — `useBrowseObjects`:
  `useInfiniteQuery`, key `["browse", bucket, options]`, `api.get`.
- `src/pages/buckets/manage/browse/types.ts` — `GetObjectsResult`, `Object`.
- `src/pages/buckets/manage/browse/browse-tab.tsx` — owns `prefixHistory` /
  `curPrefix`, `gotoPrefix(prefix)` (line 43), renders `ObjectListNavigator`
  (with an `actions` slot) then `ObjectList`.
- `src/pages/buckets/manage/browse/object-list.tsx:25-30` — `Props {prefix,
  onPrefixChange, selected, setSelected}`; line 47 calls
  `useBrowseObjects(bucketName, { prefix, limit: 1000 })`.
- `src/hooks/useDebounce` exists (used by `overview-quota.tsx`).
- Test pattern for hooks: `src/pages/buckets/manage/browse/hooks.test.ts`
  (pure-function tests, no rendering). For components:
  `object-list.test.tsx` (mocks `../context`, `./hooks`, renders inside a
  real `QueryClientProvider`).

`browse.go:49-55` — the call to mirror (drop `Delimiter`, loop on the token):

```go
	objects, err := client.ListObjectsV2(r.Context(), &s3.ListObjectsV2Input{
		Bucket:            aws.String(bucket),
		Prefix:            aws.String(prefix),
		Delimiter:         aws.String("/"),
		MaxKeys:           aws.Int32(limit),
		ContinuationToken: continuationToken,
	})
```

`browse.go:73-85` — how results are built (mirror; keep `Url` via `browseObjectURL`):

```go
	for _, object := range objects.Contents {
		key := strings.TrimPrefix(*object.Key, prefix)
		if key == "" {
			continue
		}
		result.Objects = append(result.Objects, schema.BrowserObject{
			ObjectKey:    &key,
			LastModified: object.LastModified,
			Size:         object.Size,
			Url:          browseObjectURL(bucket, *object.Key),
		})
	}
```

Conventions: handlers are methods on `Browse`, end in `utils.ResponseSuccess` /
`utils.ResponseErrorStatus` + `return`; validation errors are 400 with a plain
message; frontend hooks one-per-endpoint in `hooks.ts`, array query keys; UI is
daisyUI via `src/components/ui/*` wrappers (`Input`, `Button`); icons from
`lucide-react`. Docs: `README.md` API table (~line 339-345) lists every
`/api/*` route — add the new one.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Go tests | `cd backend && go test -race ./router/ -run 'TestSearchObjects'` | `ok` |
| Go all | `cd backend && go build ./... && go vet ./... && test -z "$(gofmt -l .)" && go test -race ./...` | exit 0 |
| FE install | `pnpm install --frozen-lockfile` | exit 0 |
| FE | `pnpm run typecheck && pnpm run test && pnpm run build` | exit 0 |
| FE lint (new files) | `pnpm exec eslint src/pages/buckets/manage/browse` | no errors in files you touched |

## Scope

**In scope**:
- `backend/router/browse.go` — new `SearchObjects` handler + constants
- `backend/schema/browse.go` — new `SearchObjectsResult`
- `backend/router/router.go` — one route line
- `backend/router/browse_test.go` — `TestSearchObjects`
- `src/pages/buckets/manage/browse/hooks.ts`, `types.ts` — hook + types
- `src/pages/buckets/manage/browse/search-results.tsx` (create) + `search-results.test.tsx` (create)
- `src/pages/buckets/manage/browse/browse-tab.tsx` — search box + swap list
- `README.md` — API table row

**Out of scope — do NOT touch**:
- `backend/middleware/auth.go` — GET is already viewer-allowed; do not add a
  carve-out.
- `object-list.tsx` — the folder list is untouched; search is a sibling view.
- Any server-side index, cache of listings, or background crawl.
- Content search (inside objects). Name search only.
- Selection/bulk actions on search results — out of v1.

## Git workflow

- Branch: `advisor/061-object-search`
- Conventional commits: `feat(browse): search a bucket by object name` (backend), `feat(browse): search box in the object browser` (frontend)
- Do NOT push or open a PR.

## Steps

### Step 1: Schema

In `backend/schema/browse.go` add:

```go
// SearchObjectsResult is the answer to GET /search/{bucket}. Truncated is true
// when the walk stopped before the end of the listing — either the match cap
// or the scan cap was hit — so the UI can say "there may be more".
type SearchObjectsResult struct {
	Objects   []BrowserObject `json:"objects"`
	Prefix    string          `json:"prefix"`
	Query     string          `json:"query"`
	Scanned   int             `json:"scanned"`
	Truncated bool            `json:"truncated"`
	Reason    string          `json:"reason,omitempty"` // "matches" | "scan" when truncated
}
```

**Verify**: `cd backend && go build ./...` → exit 0.

### Step 2: Handler

In `backend/router/browse.go`, near `maxListKeys`, add:

```go
// Search caps. S3 has no search primitive; a search is a bounded walk of
// ListObjectsV2 without a delimiter. Both caps are hard: the response says
// which one stopped the walk so the UI can tell the user to narrow it.
const (
	maxSearchMatches = 200
	maxSearchPages   = 20 // × maxListKeys = 20 000 keys scanned at most
	minSearchQuery   = 2
)
```

Add `func (b *Browse) SearchObjects(w http.ResponseWriter, r *http.Request)`:

1. `bucket := r.PathValue("bucket")`, `q := query.Get("q")`, `prefix := query.Get("prefix")`.
2. If `utf8.RuneCountInString(q) < minSearchQuery` → `ResponseErrorStatus(w, fmt.Errorf("q must be at least %d characters", minSearchQuery), http.StatusBadRequest); return`.
3. `client, err := getS3Client(bucket)` as in `GetObjects`.
4. `needle := strings.ToLower(q)`; loop:
   ```go
   var token *string
   for pages := 0; pages < maxSearchPages; pages++ {
       out, err := client.ListObjectsV2(r.Context(), &s3.ListObjectsV2Input{
           Bucket: aws.String(bucket), Prefix: aws.String(prefix),
           MaxKeys: aws.Int32(maxListKeys), ContinuationToken: token,
       })
       if err != nil { utils.ResponseError(w, err); return }
       for _, obj := range out.Contents {
           result.Scanned++
           full := *obj.Key
           rel := strings.TrimPrefix(full, prefix)
           if rel == "" || strings.HasSuffix(rel, "/") { continue } // folder markers
           if !strings.Contains(strings.ToLower(rel), needle) { continue }
           result.Objects = append(result.Objects, schema.BrowserObject{ObjectKey: &rel, LastModified: obj.LastModified, Size: obj.Size, Url: browseObjectURL(bucket, full)})
           if len(result.Objects) >= maxSearchMatches { result.Truncated, result.Reason = true, "matches"; utils.ResponseSuccess(w, result); return }
       }
       if out.NextContinuationToken == nil { utils.ResponseSuccess(w, result); return }
       token = out.NextContinuationToken
   }
   result.Truncated, result.Reason = true, "scan"
   utils.ResponseSuccess(w, result)
   ```
   Note `rel` must be a fresh variable per iteration (it is, via `:=` inside
   the loop) because its address is stored.
5. Initialise `result := schema.SearchObjectsResult{Objects: []schema.BrowserObject{}, Prefix: prefix, Query: q}` so an empty result serialises as `[]`, not `null`.

Register in `router.go` next to the browse routes:
`router.HandleFunc("GET /search/{bucket}", browse.SearchObjects)`.

**Verify**: `cd backend && go build ./... && go vet ./router/` → exit 0; `grep -n 'GET /search/{bucket}' backend/router/router.go` → 1 match.

### Step 3: Handler tests (`browse_test.go`)

Add `TestSearchObjects` with subtests, each with its own unique bucket name,
using `newS3Fixture` + `f.PutTestObject`. Build requests with
`httptest.NewRequest("GET", "/search/"+bucket+"?q=…&prefix=…", nil)` and
`req.SetPathValue("bucket", bucket)` (mirror how `newGetObjectsRequest` does it
— read it first).

1. **case-insensitive substring, recursive**: objects `a/Report.pdf`,
   `a/b/report-2.pdf`, `c/notes.txt`; `q=report` → exactly the two pdfs, keys
   relative to `prefix=""` i.e. `a/Report.pdf` and `a/b/report-2.pdf`;
   `Truncated=false`, `Scanned=3`.
2. **prefix scoping**: same objects, `prefix=a/b/`, `q=report` → only
   `report-2.pdf` (relative), and `f.Requests()` shows the S3 request carried
   `prefix=a/b/` and **no** `delimiter`.
3. **query too short**: `q=r` → 400.
4. **match cap**: put 205 objects `m/file-000.txt` … `m/file-204.txt`, `q=file`
   → 200 objects, `Truncated=true`, `Reason="matches"`.
5. **scan cap**: this needs the fixture to page. Check whether
   `defaultListObjectsV2` honours `max-keys` and emits a continuation token
   when there are more (line 1087-1196). If it does: put 25 objects with
   `q=zzz` (matches nothing) and — since `MaxKeys` is fixed at 1000 in the
   handler — you cannot hit 20 pages with 25 objects. **Therefore**: make
   `maxSearchPages` and the per-page size overridable in tests by turning the
   constants into package-level `var`s (`var searchPageSize int32 = maxListKeys`,
   `var searchMaxPages = 20`) and set `searchPageSize = 2; searchMaxPages = 3`
   inside the subtest with `t.Cleanup` restoring them. With 25 objects and
   `q=zzz`: `Scanned=6`, `Truncated=true`, `Reason="scan"`, 0 objects, and
   `len(f.Requests())` shows exactly 3 list calls.
   If the fixture does **not** paginate, STOP and report — do not modify the
   fixture beyond the test file.
6. **folder markers skipped**: object `d/` (zero-length, key ends in `/`) and
   `d/x.txt`; `q=d` → only `d/x.txt`.

**Verify**: `cd backend && go test -race ./router/ -run TestSearchObjects -v` → 6 subtests PASS.

### Step 4: Frontend hook + types

`types.ts`: add
```ts
export type SearchObjectsResult = {
  objects: Object[];
  prefix: string;
  query: string;
  scanned: number;
  truncated: boolean;
  reason?: "matches" | "scan";
};
```
`hooks.ts`: add
```ts
export const useSearchObjects = (bucket: string, q: string, prefix: string) =>
  useQuery({
    queryKey: ["search", bucket, prefix, q],
    queryFn: () => api.get<SearchObjectsResult>(`/search/${bucket}`, { params: { q, prefix } }),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
```
(import `useQuery` from `@tanstack/react-query`).

**Verify**: `pnpm run typecheck` → exit 0.

### Step 5: `search-results.tsx` + test

Create `SearchResults({ bucket, prefix, query, onNavigate })`:
- calls `useSearchObjects`; states: loading (`Loading…` text), error
  (`handleError`-style message inline, not a toast), empty (`No objects match
  "<q>"`), results.
- results: a daisyUI `Table` with columns Name (the relative key, full — no
  truncation of the middle), Size (`humanize`-style helper already used by
  `object-list.tsx` — reuse the same import), Last Modified. Row click →
  `onNavigate(parentPrefix)` where `parentPrefix = prefix + rel.slice(0,
  rel.lastIndexOf("/") + 1)`. The name cell is a `<button>` for
  accessibility.
- banner above the table when `truncated`: `reason === "matches"` →
  "Showing the first 200 matches — narrow the search to see the rest.";
  `reason === "scan"` → "Stopped after scanning {scanned} objects — narrow the
  search or start from a deeper folder."
- footer line: "Scanned {scanned} objects".

`search-results.test.tsx` (mock `./hooks` `useSearchObjects` with hoisted
state, like `object-list.test.tsx` mocks its hooks):
1. renders rows for results and calls `onNavigate("a/b/")` when
   `a/b/report-2.pdf` is clicked (with `prefix=""`).
2. with `prefix="a/"` and rel `b/report-2.pdf`, click → `onNavigate("a/b/")`.
3. truncated `reason:"matches"` shows the "first 200" banner; `"scan"` shows
   the scanning banner with the number; not truncated shows neither.
4. empty results → "No objects match".

**Verify**: `pnpm exec vitest run src/pages/buckets/manage/browse/search-results` → 4 pass.

### Step 6: Wire into `browse-tab.tsx`

- `const [search, setSearch] = useState("")`; debounced value via
  `useDebounce` (300 ms) — read `src/hooks/useDebounce.ts` first for its
  actual signature (it is callback-based in `overview-quota.tsx`; if it does
  not fit a value-debounce, implement a 6-line `useDebouncedValue` in the
  same file **only if** no such hook exists — grep `src/hooks/` first).
- Render an `Input` (search icon from lucide, placeholder "Search this
  folder and below…", `aria-label="Search objects"`, clear button) inside the
  `ObjectListNavigator` `actions` slot alongside the existing `<Actions>`.
- When the debounced value has ≥ 2 chars: render `<SearchResults bucket
  prefix={prefix} query onNavigate={(p) => { setSearch(""); gotoPrefix(p); }}
  />` instead of `<ObjectList …>`. Otherwise unchanged.
- Navigating with the breadcrumb/back/forward clears the search.

**Verify**: `pnpm run typecheck && pnpm run test && pnpm run build` → exit 0; `pnpm exec eslint src/pages/buckets/manage/browse` → no errors in touched files.

### Step 7: Docs + gates

README API table: `| GET | /api/search/{bucket} | Name search under a prefix (`q`, `prefix`); capped at 200 matches / 20 000 keys scanned, reports `truncated`. |`

```
cd backend && go build ./... && go vet ./... && test -z "$(gofmt -l .)" && go test -race ./...
pnpm run typecheck && pnpm run test && pnpm run build
git diff --stat 8e062cb..HEAD
```

## Done criteria

- [ ] `go test -race ./...` all `ok`; `TestSearchObjects` has 6 passing subtests
- [ ] `grep -n 'GET /search/{bucket}' backend/router/router.go` → 1; `grep -rn "search" backend/middleware/auth.go` → 0
- [ ] `grep -n "Delimiter" backend/router/browse.go` → appears only in `GetObjects` (not in `SearchObjects`)
- [ ] Frontend: typecheck/test/build exit 0; `search-results.test.tsx` 4 passing
- [ ] `grep -n "/api/search/{bucket}" README.md` → 1
- [ ] `git diff 8e062cb..HEAD -- src/pages/buckets/manage/browse/object-list.tsx backend/middleware/` is empty
- [ ] `git diff --stat 8e062cb..HEAD` lists only in-scope files
- [ ] `plans/README.md` row updated

## STOP conditions

- The excerpts above do not match the live code.
- The S3 fixture does not paginate (`IsTruncated` never true) and the scan-cap
  test cannot be written without editing the fixture's production-facing
  behaviour — report; the fixture may only gain a *new* opt-in method.
- Making the search box fit requires restructuring `ObjectListNavigator`'s
  layout beyond adding a child to `actions`.
- A 1000-key page takes > 2 s against the fixture (would indicate an
  accidental O(n²)).

## Maintenance notes

- Caps are the safety property. Raising `maxSearchPages` multiplies worst-case
  S3 calls per keystroke; the 300 ms debounce and ≥ 2 chars are the other half
  of that budget. Keep all three together in review.
- Results are keys relative to `prefix` (like `GetObjects`); `Url` is absolute.
  If `GetObjects` ever changes its key-stripping, mirror it here.
- Deferred: selecting/bulk-deleting from results; opening the media viewer
  directly from a result (today: navigate to the folder, then click); a
  server-side index for large buckets (would be a new persisted table — a
  bigger design than this UI has taken on).

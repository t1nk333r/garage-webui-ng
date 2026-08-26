# Plan 058: Make "Allow Key" fail loudly instead of reporting success for an empty submit

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6a36683..HEAD -- src/pages/buckets/manage/permissions/ src/pages/buckets/manage/schema.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6a36683`, 2026-08-26

## Why this matters

Reported by the maintainer 2026-08-26: "giving a bucket permissions will not
succeed" — after using the **Allow Key** dialog the bucket still shows
`"keys": []`. The request the dialog sends (`POST /v2/AllowBucketKey` with
`{bucketId, accessKeyId, permissions:{read,write,owner}}`) was checked against
the Garage v2 admin spec and is correct, and nothing in the backend touches it
(the catch-all proxy forwards it verbatim). The defect is in the dialog itself:

1. **Silent no-op submit.** Only rows whose left-most **Key** checkbox is
   ticked are sent. Ticking Read/Write/Owner on a row without ticking Key
   yields an empty payload; `Promise.all([])` resolves; the user sees a green
   **"Key allowed!"** toast and nothing happened. There is no validation and no
   hint that the Key box is the selector.
2. **Selections are wiped by any parent re-render.** `PermissionsTab` passes
   `currentKeys={keys?.map(...)}` — a fresh array every render — and the
   dialog's `useEffect([keys, currentKeys])` resets every row to unchecked
   whenever that prop identity changes (e.g. the bucket query refetches on
   window focus while the dialog is open). Combined with (1), alt-tabbing to
   copy a key name and coming back to press Submit produces a false success.

After this plan: submitting with no key selected shows an error and sends
nothing; ticking any permission on a row selects that row automatically; and
the form is only (re)seeded when the *set* of key ids actually changes.

## Current state

- `src/pages/buckets/manage/permissions/allow-key-dialog.tsx` — the dialog
  (form, `useAllowKey` mutation, submit handler).
- `src/pages/buckets/manage/permissions/permissions-tab.tsx` — renders the
  dialog and computes `currentKeys`.
- `src/pages/buckets/manage/schema.ts` — `allowKeysSchema` (zod).
- `src/pages/buckets/manage/hooks.ts:134-160` — `useAllowKey`; **correct, do
  not change**.

`allow-key-dialog.tsx:45-58` — the seeding effect (resets on every prop identity change):

```tsx
  useEffect(() => {
    const _keys = keys
      ?.filter((key) => !currentKeys?.includes(key.id))
      ?.map((key) => ({
        checked: false,
        keyId: key.id,
        name: key.name,
        read: false,
        write: false,
        owner: false,
      }));

    form.setValue("keys", _keys || []);
  }, [keys, currentKeys]);
```

`allow-key-dialog.tsx:72-80` — the submit handler (no empty check):

```tsx
  const onSubmit = form.handleSubmit((values) => {
    const data = values.keys
      .filter((key) => key.checked)
      .map((key) => ({
        keyId: key.keyId,
        permissions: { read: key.read, write: key.write, owner: key.owner },
      }));
    allowKey.mutate(data);
  });
```

`allow-key-dialog.tsx:145-152` — the per-row checkboxes:

```tsx
                      <CheckboxField form={form} name={`keys.${index}.read`} />
                      <CheckboxField form={form} name={`keys.${index}.write`} />
                      <CheckboxField form={form} name={`keys.${index}.owner`} />
```

`permissions-tab.tsx:46` — the unstable prop:

```tsx
          <AllowKeyDialog currentKeys={keys?.map((key) => key.accessKeyId)} />
```

`schema.ts:26-37`:

```ts
export const allowKeysSchema = z.object({
  keys: z
    .object({
      checked: z.boolean(),
      keyId: z.string(),
      name: z.string(),
      read: z.boolean(),
      write: z.boolean(),
      owner: z.boolean(),
    })
    .array(),
});
```

Conventions to match:
- Errors surface via `toast.error(...)` from `sonner` (see `handleError` in
  `src/lib/utils.ts:28`). Success via `toast.success`.
- Frontend tests: Vitest + Testing Library in jsdom, colocated `*.test.tsx`,
  mocking `../context`, `../hooks` and `@/hooks/useAuth` with `vi.hoisted`
  state — model after
  `src/pages/buckets/manage/overview/website-access.test.tsx` (its header is
  the pattern: hoisted mock mutation object with `mutate: vi.fn()`, `vi.mock`
  of the sibling `../hooks` and `../context`).
- `CheckboxField` (`src/components/ui/checkbox.tsx`) wraps a react-hook-form
  `Controller`; its `onChange` calls `field.onChange(e.target.checked)`. It
  accepts and spreads extra checkbox props, so an `onChange` passed in would be
  **overridden** by the inner one — use `form.watch`/`form.setValue` instead
  of trying to hook the checkbox's `onChange`.
- New code must be lint-clean (`pnpm run lint` has a pre-existing backlog;
  do not touch it).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Tests (this area) | `pnpm exec vitest run src/pages/buckets/manage/permissions` | all pass |
| Full tests | `pnpm run test` | all pass (1 pre-existing skip is normal) |
| Build | `pnpm run build` | exit 0 |
| Lint (new files only) | `pnpm exec eslint src/pages/buckets/manage/permissions` | 0 errors in the files you touched |

## Scope

**In scope** (the only files you may modify):
- `src/pages/buckets/manage/permissions/allow-key-dialog.tsx`
- `src/pages/buckets/manage/permissions/permissions-tab.tsx`
- `src/pages/buckets/manage/permissions/allow-key-dialog.test.tsx` (create)
- `src/pages/buckets/manage/schema.ts` (only if Step 2's schema refinement is used)

**Out of scope** (do NOT touch):
- `src/pages/buckets/manage/hooks.ts` — `useAllowKey` is correct; the request
  shape matches the Garage v2 spec.
- `backend/` — nothing server-side is involved.
- `src/components/ui/checkbox.tsx` / `form-control.tsx` — shared widgets.
- Any redesign of the dialog (columns, layout, Deny flow).

## Git workflow

- Branch: `advisor/058-allow-key-dialog-silent-submit`
- Conventional commits, e.g. `fix(buckets): reject an empty Allow Key submit and stop wiping selections`
- Do NOT push or open a PR.

## Steps

### Step 1: Stabilise `currentKeys` and seed the form only when the id set changes

In `permissions-tab.tsx`, memoise the prop:

```tsx
  const currentKeyIds = useMemo(
    () => keys?.map((key) => key.accessKeyId) ?? [],
    [keys]
  );
  …
          <AllowKeyDialog currentKeys={currentKeyIds} />
```

In `allow-key-dialog.tsx`, make the effect depend on a stable string of the
candidate key ids rather than array identity, so a refetch that yields the
same keys does not reset the user's ticks:

```tsx
  const candidateKeys = useMemo(
    () => keys?.filter((key) => !currentKeys?.includes(key.id)) ?? [],
    [keys, currentKeys]
  );
  const candidateIds = candidateKeys.map((k) => k.id).join(",");

  useEffect(() => {
    form.setValue(
      "keys",
      candidateKeys.map((key) => ({
        checked: false, keyId: key.id, name: key.name,
        read: false, write: false, owner: false,
      }))
    );
    // Reseed only when the set of candidate keys changes, not on every
    // parent render — otherwise an in-flight selection is silently wiped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateIds]);
```

**Verify**: `pnpm run typecheck` → exit 0.

### Step 2: Refuse an empty submit and auto-select a row when a permission is ticked

In `onSubmit`, before `allowKey.mutate(data)`:

```tsx
    if (data.length === 0) {
      toast.error("Select at least one key to allow.");
      return;
    }
```

Also guard the case where a row is selected but has **no** permission ticked —
Garage accepts it but it is a no-op that would again show "Key allowed!":

```tsx
    if (data.some((k) => !k.permissions.read && !k.permissions.write && !k.permissions.owner)) {
      toast.error("Each selected key needs at least one permission.");
      return;
    }
```

Then make ticking Read/Write/Owner select the row. Since `CheckboxField`
overrides `onChange`, watch the form instead. Add inside the component:

```tsx
  const watchedKeys = form.watch("keys");
  useEffect(() => {
    watchedKeys?.forEach((row, i) => {
      if (!row.checked && (row.read || row.write || row.owner)) {
        form.setValue(`keys.${i}.checked`, true);
      }
    });
  }, [watchedKeys, form]);
```

(Alternative, equally acceptable: keep `onSubmit` as the only gate and drop
auto-select. If you choose this, the toast text must still make the Key
checkbox's role obvious: "Tick the Key box for each key you want to allow.")

**Verify**: `pnpm run typecheck` → exit 0; `pnpm exec eslint src/pages/buckets/manage/permissions` → no errors in the two touched files.

### Step 3: Tests

Create `src/pages/buckets/manage/permissions/allow-key-dialog.test.tsx`,
modelled on `website-access.test.tsx`. Mock:
- `../context` → `useBucketContext: () => ({ bucket: { id: "b1", keys: [] } })`
- `@/hooks/useAuth` → `{ canWrite: true }`
- `@/pages/keys/hooks` → `useKeys: () => ({ data: [{ id: "GK1", name: "alpha" }, { id: "GK2", name: "beta" }] })`
- `../hooks` → `useAllowKey: (_id, opts) => mockMutation` where
  `mockMutation.mutate = vi.fn()`; `useDenyKey` if imported.
- `sonner` → `{ toast: { success: vi.fn(), error: vi.fn() } }`.

jsdom does not implement `<dialog>.showModal`; if the `Modal` throws, stub
`HTMLDialogElement.prototype.showModal = vi.fn()` and `.close = vi.fn()` in
`beforeEach` (see `src/test/setup.ts` first — it may already do this).

Cases (open the dialog via the "Allow Key" button in each):
1. **Submit with nothing ticked** → `toast.error` called, `mutate` **not** called.
2. **Tick Read on row "alpha" only, submit** → `mutate` called once with
   `[{ keyId: "GK1", permissions: { read: true, write: false, owner: false } }]`
   (auto-select), **or** if the alternative in Step 2 was chosen, `toast.error`
   called and `mutate` not called.
3. **Tick Key on "alpha" with no permission, submit** → `toast.error`, no `mutate`.
4. **Tick Key + Write on "beta", submit** → `mutate` called with exactly one
   entry for `GK2` with `write: true`.
5. **Re-render the parent with an equal-but-new `currentKeys` array after
   ticking a row** → the tick survives (use `rerender` with a fresh `[]`).

**Verify**: `pnpm exec vitest run src/pages/buckets/manage/permissions` → 5 new tests pass.

### Step 4: Gates

```
pnpm run typecheck && pnpm run test && pnpm run build
git diff --stat 6a36683..HEAD
```

## Done criteria

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm run test` exits 0; `allow-key-dialog.test.tsx` exists with ≥5 passing tests
- [ ] `pnpm run build` exits 0
- [ ] `grep -n "Select at least one key" src/pages/buckets/manage/permissions/allow-key-dialog.tsx` → 1 match
- [ ] `grep -n "currentKeys={keys?.map" src/pages/buckets/manage/permissions/permissions-tab.tsx` → no match
- [ ] `git diff --stat 6a36683..HEAD` lists only the in-scope files
- [ ] `git diff 6a36683..HEAD -- src/pages/buckets/manage/hooks.ts backend/` is empty
- [ ] `plans/README.md` row updated

## STOP conditions

- The excerpts above do not match the live code.
- `useAllowKey` in `hooks.ts` does not send `{bucketId, accessKeyId, permissions}` — the diagnosis changes; report.
- Making the tests pass appears to require changing `checkbox.tsx` or `form-control.tsx`.
- The `Modal` cannot be opened in jsdom even with the `showModal` stub after two attempts — report with the error rather than testing the component's internals directly.

## Maintenance notes

- The diagnosis was static (request shape verified against the Garage v2 admin
  spec, backend proxy read); **the maintainer should confirm in a browser** that
  after this lands, ticking Read on a key and pressing Submit produces a
  `POST /api/v2/AllowBucketKey` in DevTools and the key appears in the bucket.
  If Garage returns a 4xx instead, the response body is the real cause and
  this plan only removed the false-success masking it.
- Reviewer: check that the `react-hooks/exhaustive-deps` disable in Step 1 is
  the only one added, and that the comment above it explains why.
- Deferred: the Deny path (`permissions-tab.tsx:onRemove`) uses `window.confirm`;
  a consistent modal is a separate UX plan.

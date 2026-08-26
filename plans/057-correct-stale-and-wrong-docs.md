# Plan 057: Correct the docs that are actively wrong

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the files listed as in scope. If any STOP condition occurs, stop and
> report. Do **not** edit `plans/README.md` beyond what Step 2 explicitly says.
>
> **Drift check (run first)**:
> ```
> git diff --stat 6a36683..HEAD -- CLAUDE.md README.md docs/ .env.example
> ```
> On a mismatch with the "Current state" excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — documentation only
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `947879d`, 2026-08-13 — **refreshed `6a36683`, 2026-08-26** (reconcile: CI moved from GitHub Actions to Jenkins in `fabb2db`; defect 3 and Step 3 rewritten; defects 1–2 re-verified still present)

## Why this matters

Three documentation defects, all of the "actively wrong is worse than missing"
kind — a reader who trusts them makes a worse decision than one who had nothing.

1. **`docs/authentication.md` understates the viewer write surface.** It states
   as an absolute that viewers may write to exactly two routes. There are three.
   Anyone sizing a proxy rule, writing a WAF policy, or reasoning about the
   read-only role's blast radius gets an incomplete answer from the security doc.

2. **`CLAUDE.md` is six minor releases stale.** It announces the current release
   as 3.1.0 with plans 001–033, when `package.json` is 3.8.0 and there are 57 plans.
   This is the file every dispatched agent reads first, so a wrong claim here
   propagates into work: an executor told a shipped plan is "in review" may redo
   or conflict with merged work.

3. **`CLAUDE.md` describes a CI setup that no longer exists.** It says the pin
   is `1.25.12` in four places including `.github/workflows/ci.yml` ×2, and that
   "CI is `.github/workflows/ci.yml`". Since `fabb2db` (2026-08-19) CI runs on
   Jenkins from the root `Jenkinsfile`; `ci.yml` is deleted; the pin is `1.25.13`
   in **three** in-repo sites (`Dockerfile`, `release.yml` ×2) plus the Jenkins
   agent image, which lives outside this repo. `README.md` still carries a CI
   badge pointing at the deleted workflow. The doc is the checklist someone
   follows when renewing the pin, so it must list the real sites.

## Current state

### `docs/authentication.md:154-155` — the wrong claim

```
- **The only writes permitted are `POST /api/auth/logout` and
  `POST /api/auth/change-password`** — both act solely on the caller's own
```

But `backend/middleware/auth.go` permits a **third**, with its rationale in the
code:

```go
	// Downloading is a read. The archive endpoint is a GET (already allowed);
	// the token that authorises it is minted with a POST purely because the key
	// list is too large for a URL. It mutates nothing, so a read-only viewer
	// may call it. Exact match only — this must never become a prefix.
	if r.Method == http.MethodPost {
		return r.URL.Path == "/auth/logout" ||
			r.URL.Path == "/auth/change-password" ||
			r.URL.Path == "/browse/download-token"
	}
```

### `CLAUDE.md` — the stale release block

```
**Current release (3.1.0, commit f9cd2c6):** Plans 001–032 completed and shipped.
Plan 033 (header account redesign) written, unexecuted. Plan 031
(download-selected ZIP) executed, in review (one fix needed for pre-flight
validation). Plan 029 (offline admin-recovery CLI, …) shipped.
```

Reality: `package.json` reads `3.8.0`, and plans 031, 033 and everything through
055 have merged to `main` (056 and 057 are the only open plans).

The same file also describes the backlog as "`001-*.md` through `033-*.md`".

### `CLAUDE.md` — the pin-count claim

```
CI and the Docker builder pin an **exact** patch, currently `1.25.12` /
`golang:1.25.12-alpine`, in four places that must stay in lockstep —
`.github/workflows/ci.yml` ×2, `.github/workflows/release.yml`, and the
`Dockerfile`.
```

Measured at `6a36683` — `ci.yml` no longer exists; three in-repo sites, all
`1.25.13`:

```
.github/workflows/release.yml  (×2, lines 56 and 86 — the doc names only one)
Dockerfile                     (×1, line 35: golang:1.25.13-alpine)
```

Plus one out-of-repo site: the Jenkins agent image (`Dockerfile.agent`, kept
with the Jenkins setup, not in this repo) bakes Go 1.25.13 — `Jenkinsfile:3`
documents this. `govulncheck` in the `Jenkinsfile` runs under that toolchain,
so it must match the `Dockerfile` pin or advisories are reported against the
wrong stdlib.

`CLAUDE.md:35` also says "CI is `.github/workflows/ci.yml`" — the file is gone;
CI is the root `Jenkinsfile`. `README.md:9` links a CI badge to
`actions/workflows/ci.yml`, which now 404s.

### Also missing, and worth fixing in the same pass

- `README.md`'s API table omits `POST /api/browse/download-token` and
  `GET /api/browse/{bucket}/archive`, both registered in
  `backend/router/router.go`.
- `README.md` states its env reference is complete and points at `.env.example`,
  but neither documents `API_ADMIN_KEY` — read in `backend/utils/garage.go` as
  the override for the Garage admin bearer token. `CLAUDE.md` *does* document it,
  so the operator-facing docs are the ones that are wrong. **Reference it by name
  and purpose only — never include a value.**

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Version truth | `git describe --tags --abbrev=0` and `node -p "require('./package.json').version"` | agree |
| Pin sites | `grep -rn 'go-version: "1.25' .github/workflows/ ; grep -n 'golang:1.25' Dockerfile ; grep -n 'Go 1.25' Jenkinsfile` | four lines total, all `1.25.13` |
| Frontend gates | `pnpm run typecheck && pnpm run build` | exit 0 (proves nothing was broken) |

`pnpm` is at `/home/t1nk33r/.local/share/mise/installs/node/26.3.1/bin/pnpm`.

## Scope

**In scope:**
- `docs/authentication.md`
- `CLAUDE.md`
- `README.md`
- `.env.example`

**Out of scope — do NOT touch:**
- **Any code.** This plan changes documentation only. If a doc and the code
  disagree, the **code is right** and the doc gets corrected — with one exception
  called out in the STOP conditions.
- `plans/*.md` other than the index line Step 2 permits. The plan files are a
  historical record; do not retro-edit them.
- The architecture sections of `CLAUDE.md` beyond what Step 2 names. They were
  verified as still accurate; rewriting them risks introducing a new wrong claim.
- `.github/workflows/*`, `Jenkinsfile` and `Dockerfile` — the pins **agree**;
  only the docs are wrong. Changing CI config here is out of scope.

## Git workflow

- Branch: `advisor/057-correct-stale-and-wrong-docs` from your given base.
- Conventional commit, e.g. `docs: correct the viewer write surface and the stale release block`.
- Do NOT push, open a PR, or merge.

---

## Steps

### Step 1: Correct the viewer write surface

In `docs/authentication.md`, amend the passage at ~line 154 to name **three**
permitted viewer writes, with the one-line rationale already present in
`backend/middleware/auth.go`: the download-token endpoint mutates nothing and is
a POST only because a selected-key list is too large for a URL.

Check the rest of that document for any other place that enumerates viewer
permissions or claims viewers cannot write, and correct those too — search for
`logout`, `change-password`, `read-only` and `viewer`.

**Verify**: `grep -n "download-token" docs/authentication.md` → at least one match in the viewer section.

### Step 2: Replace the stale release block with something that cannot go stale

In `CLAUDE.md`, replace the "Current release" paragraph. Do **not** write a new
hardcoded version — that is how the current text became wrong. Instead:

- State that the released version is whatever `git describe --tags` reports, and
  that the authoritative status of the plan backlog is `plans/README.md`.
- Keep any genuinely durable statement (e.g. that the backlog is maintained via
  the improve skill and the executor/review workflow).
- Change the backlog range "`001-*.md` through `033-*.md`" to "`001-*.md` onward".

Then add **one short paragraph each** for the subsystems shipped since 3.1.0 that
`CLAUDE.md` does not mention at all, because agents will touch them blind:

- the upload queue (`src/pages/buckets/manage/browse/upload-queue.ts`) and
  `MAX_UPLOAD_SIZE_MB` / the 413 pre-check
- the download-token + streamed ZIP archive path in `backend/router/browse.go`
- the object-serving header policy (inline-safe allowlist, `nosniff`, sandbox
  CSP, `SAMEORIGIN` on the view path)
- release signing (`backend/cmd/relsign`, `backend/release_key.go`,
  `SHA256SUMS` + `SHA256SUMS.sig`, and that the release job **fails** when the
  signing secret is absent)

Keep each to two or three sentences — this is orientation, not documentation.

**Verify**:
```
grep -n "3.1.0\|001-\*.md through 033" CLAUDE.md
```
→ **no matches**.

### Step 3: Correct the CI and Go-pin description

Confirm the in-repo sites agree before writing anything:

```
grep -rn 'go-version: "1.25' .github/workflows/ ; grep -n 'golang:1.25' Dockerfile ; grep -n 'Go 1.25' Jenkinsfile
```

Expected: `release.yml` ×2 and `Dockerfile` ×1 all read `1.25.13`, and the
`Jenkinsfile` comment names `1.25.13`. If they do **not** agree, STOP (see STOP
conditions).

Then in `CLAUDE.md`:

1. Rewrite the pin sentence (currently lines 14–18) to: the pin is `1.25.13` /
   `golang:1.25.13-alpine`, in **three places in this repo** — `Dockerfile` and
   `.github/workflows/release.yml` **×2** (the second is the checksum/signing
   job, which also runs `go`) — **plus the Jenkins agent image** (out of repo;
   the `Jenkinsfile` header comment records its version). Keep the existing
   rationale sentence about the floating minor and blocking `govulncheck`.
2. Replace "CI is `.github/workflows/ci.yml`" (line 35) with: CI is the root
   `Jenkinsfile` (lint non-blocking, typecheck/test/build, Go build/vet/gofmt/
   test, blocking `govulncheck`, advisory `pnpm audit`; on `main` it also builds
   and pushes the multi-arch image to GHCR). `.github/workflows/release.yml`
   (signed binaries on `v*` tags) is the only GitHub Actions workflow left.

In `README.md`, remove the CI badge on line 9 (there is no public Jenkins URL to
point it at) — do not replace it with a Jenkins badge.

**Verify**:
- `grep -n "four places\|ci.yml" CLAUDE.md` → no matches
- `grep -n "three places" CLAUDE.md` → one match
- `grep -n "Jenkinsfile" CLAUDE.md` → at least one match
- `grep -n "workflows/ci.yml" README.md` → no matches

### Step 4: Fill the two README gaps

- Add `POST /api/browse/download-token` and `GET /api/browse/{bucket}/archive` to
  the API table, noting that the token endpoint is one of the three writes a
  viewer may perform.
- Add `API_ADMIN_KEY` to the README env table and a commented entry in
  `.env.example`, next to `API_BASE_URL`. Describe it as the override for the
  Garage admin bearer token that otherwise comes from `garage.toml`, and note it
  must be supplied as a secret (env file or secret store), never inline in a
  compose file. **Do not include any value, real or example-looking.**

**Verify**:
```
grep -n "download-token\|/archive" README.md
grep -n "API_ADMIN_KEY" README.md .env.example
```
→ matches in each.

### Step 5: Gates

```
pnpm run typecheck && pnpm run build
git diff --stat 6a36683..HEAD
```

Typecheck and build must still pass (proving no code was touched), and the diff
must list only the four in-scope files.

## Done criteria

- [ ] `grep -n "3.1.0" CLAUDE.md` → no matches
- [ ] `grep -n "four places\|ci.yml" CLAUDE.md` → no matches; "three places" and "Jenkinsfile" present
- [ ] `grep -n "workflows/ci.yml" README.md` → no matches
- [ ] `grep -n "download-token" docs/authentication.md README.md` → matches in both
- [ ] `grep -n "API_ADMIN_KEY" README.md .env.example` → matches in both
- [ ] `grep -rniE "[0-9a-f]{32,}" .env.example` → no matches (no value was pasted)
- [ ] `git diff --stat 6a36683..HEAD` lists **only** `CLAUDE.md`, `README.md`, `docs/authentication.md`, `.env.example`
- [ ] `pnpm run typecheck && pnpm run build` exit 0

## STOP conditions

- The three in-repo Go pin sites (`Dockerfile`, `release.yml` ×2) do **not** all
  read the same patch version, or the `Jenkinsfile` header names a different
  one — that is code drift, not a doc defect; report it and stop.
- The code and a doc disagree about something **other** than the three defects
  named here, and you cannot tell which is right. Report it rather than guessing;
  a confidently wrong doc is exactly what this plan exists to remove.
- You are about to edit any file under `backend/`, `src/`, `.github/`, or
  `Dockerfile`.
- You are about to write a version number into `CLAUDE.md` — Step 2 exists
  specifically to avoid that.
- You are about to paste any credential value into `.env.example`.

## Maintenance notes

- **The release block is now derived, not stated.** That is the point: the
  previous text was accurate the day it was written and wrong six releases later.
  If someone re-adds a hardcoded version here, it will rot the same way.
- **`plans/README.md` is the maintained backlog record**; `CLAUDE.md` should
  point at it rather than summarise it.
- **The pin lockstep is doc-enforced, which is why the count matters.** A
  worthwhile follow-up (deliberately not in this plan) is a `Jenkinsfile` stage
  that greps the in-repo sites plus the `go` directive in `backend/go.mod`, and
  compares against `go version` on the agent, failing on disagreement — that
  would make the doc's count non-load-bearing and catch agent-image drift.
- The viewer write surface is enumerated in three places now: the middleware
  code, its comment, and `docs/authentication.md`. If a fourth permitted write is
  ever added, all three need updating — the code comment says "exact match only,
  this must never become a prefix", which is the constraint to preserve.

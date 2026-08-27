# Plan 059: Build the multi-arch image without QEMU — cross-compile both stages on the build host

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8e062cb..HEAD -- Dockerfile Jenkinsfile docs/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `8e062cb`, 2026-08-26

## Why this matters

The Jenkins `main` build pushes a `linux/amd64,linux/arm64` image. Today the
`Dockerfile` runs the **frontend and backend build stages inside a container of
the target architecture**, so on the amd64 agent the arm64 half executes under
QEMU user-mode emulation. Measured on build #4 of 2026-08-26: the arm64 Vite
build took **121.7 s vs 10.8 s** natively, and the arm64 `go build` was still
running (and got aborted) after the amd64 image was fully assembled. Both
toolchains cross-compile natively — Vite output is architecture-independent and
Go targets any `GOARCH` from any host — so the emulation is pure waste, roughly
10× on the slow half and the reason the build window is long enough for a
second trigger to abort it (`disableConcurrentBuilds(abortPrevious: true)`).

After this plan the two build stages run once on the build host's own
architecture, the Go stage cross-compiles per target via `GOARCH=$TARGETARCH`,
and only the tiny runtime stage is per-platform. Expected: multi-arch build
time ≈ single-arch build time, no `tonistiigi/binfmt` dependency for the
build itself.

## Current state

- `Dockerfile` — three stages: `frontend` (node:20-slim), `backend`
  (golang:1.25.13-alpine), `runtime` (distroless static). Lines 6, 35, 52-55.
- `Jenkinsfile:88-105` — the `main`-only publish stage: installs binfmt, creates
  a `docker-container` builder, runs `docker buildx build --platform
  linux/amd64,linux/arm64 … --push`.
- `.github/workflows/release.yml:63` — the tag-driven binary release already
  cross-compiles with `GOARCH=${{ matrix.goarch }}`; that is the precedent.

`Dockerfile:6` and `Dockerfile:35` — the stages that currently run per target platform:

```dockerfile
FROM node:20-slim AS frontend
…
FROM golang:1.25.13-alpine AS backend
```

`Dockerfile:52-55` — the Go build, no `GOARCH`:

```dockerfile
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux \
    go build -tags=prod -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /main .
```

`Dockerfile:64` — the runtime stage; **stays per-platform, do not add `--platform` here**:

```dockerfile
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
```

`Jenkinsfile:89` — binfmt install (keep; harmless and still needed if anyone
later adds a per-platform `RUN` to the runtime stage):

```groovy
          docker run --privileged --rm tonistiigi/binfmt --install arm64
```

Conventions: the `Dockerfile` is heavily commented with the *reason* for each
non-obvious line (see lines 25-34, 49-51, 76-80). Match that — every line you
add gets a one-line "why".

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Builder (once) | `docker buildx create --name p059 --driver docker-container --use` | builder created |
| Native build | `docker buildx build --platform linux/amd64 -o type=local,dest=out-amd64 .` | exit 0 |
| Cross build | `docker buildx build --platform linux/arm64 -o type=local,dest=out-arm64 .` | exit 0 |
| Arch check | `file out-arm64/main` | contains `ARM aarch64` |
| Arch check | `file out-amd64/main` | contains `x86-64` |
| Multi-arch | `docker buildx build --platform linux/amd64,linux/arm64 -o type=oci,dest=/dev/null . 2>&1 \| tee build.log` | exit 0 |
| No emulation | `grep -cE "^\#[0-9]+ \[linux/arm64 (frontend\|backend)" build.log` | `0` |
| Cleanup | `docker buildx rm p059; rm -rf out-* build.log` | — |

Run these from the repo root. `file` is in the `file` package on most distros.
`out-*` and `build.log` must not be committed (they are not in `.gitignore`;
delete them).

## Scope

**In scope**:
- `Dockerfile`
- `Jenkinsfile` — comment update only (see Step 3)
- `docs/` — only if a doc describes the image build; grep first (Step 3)

**Out of scope — do NOT touch**:
- `.github/workflows/release.yml` — separate pipeline, already cross-compiles.
- The runtime stage's contents, labels, `USER`, `VOLUME`, `HEALTHCHECK`.
- Go/Node versions or pins.
- The Jenkins org-folder trigger configuration — that lives in Jenkins, not
  the repo; see Maintenance notes.

## Git workflow

- Branch: `advisor/059-cross-compile-multiarch-image`
- Conventional commits, e.g. `build(docker): cross-compile the multi-arch image instead of emulating arm64`
- Do NOT push or open a PR.

## Steps

### Step 1: Pin the build stages to the host platform

Change line 6 to:

```dockerfile
# Runs on the build host's own architecture: Vite output is arch-independent,
# so building it once (natively) instead of once per target under QEMU cuts
# the arm64 half of the multi-arch build from minutes to seconds.
FROM --platform=$BUILDPLATFORM node:20-slim AS frontend
```

Change line 35 to:

```dockerfile
FROM --platform=$BUILDPLATFORM golang:1.25.13-alpine AS backend
```

and add, directly under the existing `ARG VERSION=dev` (line 40):

```dockerfile
# Target architecture for the Go cross-compile below (amd64 / arm64), set by
# buildx per --platform. Building natively and cross-compiling is what lets the
# multi-arch image avoid QEMU emulation of the whole toolchain.
ARG TARGETARCH
```

`$BUILDPLATFORM` and `TARGETARCH` are BuildKit automatic args — no `--build-arg`
needed. `TARGETARCH` must be declared with `ARG` **inside** the stage that uses
it (after `FROM`), which is why it goes next to `VERSION`, not at the top.

**Verify**: `docker buildx build --platform linux/amd64 -o type=local,dest=out-amd64 .` → exit 0.

### Step 2: Cross-compile the Go binary

Change lines 52-55 to:

```dockerfile
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -tags=prod -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /main .
```

Update the comment at lines 49-51 to also say the binary is cross-compiled for
`TARGETARCH` (the `CGO_ENABLED=0` sentence already explains why cross-compiling
is possible).

**Verify**:
- `docker buildx build --platform linux/arm64 -o type=local,dest=out-arm64 .` → exit 0
- `file out-arm64/main` → contains `ELF 64-bit LSB executable, ARM aarch64`
- `file out-amd64/main` (from Step 1) → contains `x86-64`
- Multi-arch: `docker buildx build --platform linux/amd64,linux/arm64 -o type=oci,dest=/dev/null . 2>&1 | tee build.log` → exit 0
- `grep -cE "^#[0-9]+ \[linux/arm64 (frontend|backend)" build.log` → `0`
  (only `[linux/arm64 runtime …]` steps may appear)
- `grep -cE "^#[0-9]+ \[linux/amd64 runtime" build.log` → ≥ 1

### Step 3: Update the comments that describe the old behaviour

- `Jenkinsfile:6` header comment says "binfmt is installed on the host on
  demand". Amend to: binfmt is kept for the per-platform runtime stage only;
  the build stages cross-compile and never run under emulation.
- `Dockerfile:32-34` mentions "govulncheck (blocking, in ci.yml)" and
  "`.github/workflows/ci.yml` (x2)". `ci.yml` no longer exists (CI is the
  `Jenkinsfile`). Since you are editing the surrounding lines anyway, correct
  that comment to name the `Jenkinsfile` and `.github/workflows/release.yml`
  (×2) — **this overlaps plan 057's Step 3, which fixes the same claim in
  `CLAUDE.md`; the `Dockerfile` comment is yours, `CLAUDE.md` is not.**
- `grep -rn "binfmt\|QEMU\|qemu\|multi-arch" docs/ README.md` — if any doc
  states the image is built under emulation, correct it; if nothing matches,
  no doc change.

**Verify**: `grep -n "ci.yml" Dockerfile` → no matches.

### Step 4: Gates

```
docker buildx build --platform linux/amd64,linux/arm64 -o type=oci,dest=/dev/null .
docker buildx rm p059; rm -rf out-amd64 out-arm64 build.log
git status --short   # only Dockerfile, Jenkinsfile (and docs/ if touched)
git diff --stat 8e062cb..HEAD
```

## Test plan

There is no unit-testable code here; the gates above **are** the tests:
the arm64 artifact is genuinely aarch64 (`file`), the amd64 one is x86-64, and
the multi-arch build log contains no emulated `frontend`/`backend` steps.
Record the wall-clock of the multi-arch build before (`git stash`; build; `git
stash pop`) and after in the commit message — that is the measurable claim.

## Done criteria

- [ ] `grep -c 'FROM --platform=\$BUILDPLATFORM' Dockerfile` → `2`
- [ ] `grep -c 'GOARCH=\${TARGETARCH}' Dockerfile` → `1`
- [ ] `grep -n "^FROM.*runtime" Dockerfile` → the line does **not** contain `--platform`
- [ ] `file out-arm64/main` (before cleanup) contained `ARM aarch64`
- [ ] Multi-arch build exits 0 and `grep -cE "^#[0-9]+ \[linux/arm64 (frontend|backend)" build.log` → `0`
- [ ] `grep -n "ci.yml" Dockerfile` → no matches
- [ ] `git diff --stat 8e062cb..HEAD` lists only `Dockerfile`, `Jenkinsfile`, and any `docs/` file from Step 3
- [ ] No `out-*` directory or `build.log` in `git status`
- [ ] `plans/README.md` row updated

## STOP conditions

- The `Dockerfile` excerpts above do not match the live file.
- `file out-arm64/main` reports x86-64 — `TARGETARCH` did not reach the Go
  build; report rather than hardcoding an arch.
- The runtime stage needs a `RUN` instruction to make something work — that
  would reintroduce emulation; report.
- Docker on the executor host has no buildx / cannot create a
  `docker-container` builder. Report the exact error; do not fall back to
  single-arch verification and call it done.

## Maintenance notes

- **The double-trigger that aborted builds #4 → #5 is a Jenkins-side setting,
  not fixed here.** In the `d7eeem` organisation folder → the branch source's
  *Build strategies*, ensure only one of {branch indexing, webhook/poll}
  schedules builds, or drop `abortPrevious: true` from the `Jenkinsfile`
  `options`. With this plan the build window shrinks enough that the race is
  rarer, but not impossible.
- `--cache-to type=registry,ref=…:buildcache` in the `Jenkinsfile` will be
  created by the first build that *completes*; the "buildcache: not found"
  warning on `--cache-from` goes away after that.
- If a future change adds a native dependency to the frontend (a `node-gyp`
  module) or cgo to the backend, `--platform=$BUILDPLATFORM` becomes wrong for
  that stage — the executor of that change must revisit this.
- Reviewer: confirm the `runtime` stage's `FROM` line is untouched and that
  `TARGETARCH` is declared **inside** the `backend` stage.

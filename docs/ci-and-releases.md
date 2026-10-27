# CI and releases

Everything runs on GitHub Actions, in one workflow:
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The repository is
public, so GitHub-hosted runners cost nothing.

| Trigger | Checks | Then |
|---|---|---|
| Pull request | the tests the change reaches | — |
| Push to `main` | the tests the change reaches | image `main`, `latest`, `sha-<commit>` |
| Tag `vX.Y.Z` | every test | image `X.Y.Z`, `X.Y`, `X`; GitHub release with signed binaries |
| Nightly, manual run | every test | — |

The checks are: frontend lint (advisory: `main` carries a lint backlog),
typecheck, tests and build; backend build, `go vet`, `gofmt` and `go test
-race`; `govulncheck` (blocking); `pnpm audit` (advisory). The image and the
release wait for the frontend, backend and `govulncheck` jobs.

Start a full run by hand with `gh workflow run CI -R t1nk333r/garage-webui-ng`.

## Which tests run

The **Scope** job ([`.github/scripts/ci-scope.sh`](../.github/scripts/ci-scope.sh))
compares a pull request with the branch it merges into, and a push with the
commit the branch was at before it. Each changed path is classified by the
first rule that matches:

| Path | Effect |
|---|---|
| `.github/**` | every test |
| `*.md`, `docs/`, `plans/`, `LICENSE`, `.env.example`, `docker-compose.yml`, `.dockerignore`, `.gitignore` | nothing |
| `Dockerfile` (the Go pin), `backend/go.mod`, `backend/go.sum` | every backend test |
| `backend/**`, `contrib/garage-update/**` | the backend tests that reach it |
| `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `vite.config.*`, `src/test/**`, a deleted file under `src/` | every frontend test |
| `src/**` | the frontend tests that reach it |
| `index.html`, `public/`, ESLint, Tailwind and PostCSS config | frontend checks, no test |
| anything else | every test |

"Reaches" means:

- **Frontend**: `vitest related` with the changed files, which runs every
  changed test file and every test file that imports a changed source at any
  depth.
- **Backend**: [`go-affected.sh`](../.github/scripts/go-affected.sh) selects
  each changed package and every package that imports it, directly or not,
  including through its tests. A `_test.go` file selects only its own package.
  A file outside any package, such as testdata, belongs to the nearest package
  above it. The updater script under `contrib/garage-update/` selects the root
  package, whose `release_key_test.go` reads it.

A side the change does not touch is skipped. A side that runs at all still
typechecks, builds, vets, lints and formats in full: only its tests are
narrowed. A push whose previous commit is missing (a new branch, a force
push) tests everything.

The nightly run covers what this cannot see: a newly published advisory, or a
test that starts reading a file outside its package. When you add such a test,
add its path to both scripts.

## Cutting a release

1. Set `version` in `package.json` to `X.Y.Z` and commit.
2. Tag the commit: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
3. Push the branch, then the tag.

The release job refuses to publish when the tag does not match `package.json`,
when the `RELEASE_SIGNING_KEY` secret is empty, or when the signature does not
verify against the public key in `backend/release_key.go`. Users could not
verify such a release, so it is never published. The asset names
(`garage-webui-ng-linux-{amd64,arm64}`, `SHA256SUMS`, `SHA256SUMS.sig`) are
read by the in-app updater and `contrib/garage-update`; do not rename them.

## The release signing key

The private key exists only in the repository secret `RELEASE_SIGNING_KEY`.
The public key is compiled into the app (`releasePublicKey` in
`backend/release_key.go`) and copied into the updater script (`WEBUI_PUBKEY` in
`contrib/garage-update/garage-update`). `TestUpdateScriptPublicKey` fails while
those two differ.

To create a key, for a fork or a rotation:

1. From `backend/`, run
   `go run ./cmd/relsign keygen | gh secret set RELEASE_SIGNING_KEY`.
   stdout carries only the bare private key in hex and goes straight into the
   secret; the public key is printed to stderr, so it stays on your terminal.
   Each run makes a new pair, so take the public key from this same run.
2. Put the public key in `release_key.go` and `WEBUI_PUBKEY`, and commit.
3. Mention the rotation in the release notes.

Never commit the private key, paste it anywhere, or let it reach a log. That
is why `relsign sign` reads it from an environment variable and never from a
flag. Store it exactly as `keygen` prints it, with no label, quotes or
trailing newline: anything else fails to decode, which has broken a release
before.

A binary only trusts the public key it was built with, so after a rotation an
older binary refuses newer releases; there is deliberately no fallback. The
key was rotated for `v3.9.1`, after the original was lost with the project's
previous GitHub account: releases up to `v3.8.x` carry the old key, and
`v3.9.0` was tagged but never published because its build could not sign.

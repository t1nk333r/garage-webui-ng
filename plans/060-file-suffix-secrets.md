# Plan 060: Read secrets from files — `_FILE` suffix for every sensitive environment variable

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8e062cb..HEAD -- backend/utils/utils.go backend/utils/utils_test.go backend/utils/garage.go backend/main.go README.md .env.example docs/authentication.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (soft: 057 documents `API_ADMIN_KEY`; if 057 has not run, this plan adds the README row itself)
- **Category**: dx
- **Planned at**: commit `8e062cb`, 2026-08-26
- **Release track**: v4

## Why this matters

The Garage admin token (`API_ADMIN_KEY`) and the legacy bootstrap credentials
(`AUTH_USER_PASS`, `AUTH_VIEWER_USER_PASS`) can only be supplied as plain
environment variables. Docker Compose `secrets:` and Kubernetes `Secret`
volumes deliver values as **files**, and the established convention for that
(official `postgres`, `mysql`, `grafana` images; also the competing
`Noooste/garage-ui`) is a `<VAR>_FILE` variant naming a file whose contents
are the value. Without it, operators end up inlining the admin token in a
compose file or `docker inspect`-visible environment — exactly what the README
tells them not to do.

After this plan: for each sensitive variable, `<VAR>_FILE=/run/secrets/x` is
read once at startup, trailing `\r\n` stripped, and takes precedence over the
plain `<VAR>` if both are set. Non-sensitive variables are unchanged.

## Current state

- `backend/utils/utils.go:9-15` — `GetEnv(key, default)`, the only env helper.
- `backend/utils/garage.go:127-133` — `GetAdminKey()` reads `API_ADMIN_KEY`
  directly with `os.Getenv`; falls back to `garage.toml`'s `admin_token`.
- `backend/main.go:103-106` — legacy import reads `AUTH_USER_PASS` /
  `AUTH_VIEWER_USER_PASS` via `utils.GetEnv`.
- `backend/utils/utils_test.go` — `TestGetEnv*` (lines 5-30) is the test
  pattern: `t.Setenv`, plain `if got != want { t.Errorf }`.
- `README.md:212-231` — the env-var table; `.env.example` — commented example
  env; `docs/authentication.md` — mentions `AUTH_USER_PASS` in the legacy
  section.

`utils.go:9-15`:

```go
func GetEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return defaultValue
	}
	return value
}
```

`garage.go:127-133`:

```go
func (g *garage) GetAdminKey() string {
	key := os.Getenv("API_ADMIN_KEY")
	if len(key) > 0 {
		return key
	}
	return g.Config.Admin.AdminToken
}
```

`main.go:103-106`:

```go
	imported, err := store.ImportLegacyUsers(
		context.Background(), st,
		utils.GetEnv("AUTH_USER_PASS", ""),
		utils.GetEnv("AUTH_VIEWER_USER_PASS", ""),
	)
```

Conventions: Go handlers/helpers are plain functions in `utils`; errors are
wrapped `fmt.Errorf("...: %w", err)`; logging is stdlib `log`. **Nothing may
log a credential value** — log the *path* that failed, never the contents.
Startup is fail-fast (`log.Fatalf`) for operator errors that make the process
useless — an unreadable secrets file is one of those.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `cd backend && go build ./...` | exit 0 |
| Vet/fmt | `cd backend && go vet ./... && test -z "$(gofmt -l .)"` | exit 0, no output |
| Tests | `cd backend && go test -race ./utils/... ./...` | all `ok` |
| Single | `cd backend && go test -race ./utils/ -run TestGetSecretEnv` | `ok` |

## Scope

**In scope**:
- `backend/utils/utils.go` — add `GetSecretEnv`
- `backend/utils/utils_test.go` — tests
- `backend/utils/garage.go` — `GetAdminKey` uses it
- `backend/main.go` — legacy import uses it
- `README.md` — env table rows; `.env.example` — commented examples;
  `docs/authentication.md` — one sentence in the legacy section

**Out of scope — do NOT touch**:
- Non-secret variables (`API_BASE_URL`, `S3_*`, `BASE_PATH`, `DB_PATH`,
  `SESSION_*`, …) — `_FILE` is for secrets only; do not generalise.
- `backend/store/` — the import logic is unchanged; only its inputs.
- `backend/cmd/relsign/` — has its own key-from-env handling by design.
- `garage.toml` parsing.

## Git workflow

- Branch: `advisor/060-file-suffix-secrets`
- Conventional commits, e.g. `feat(config): read API_ADMIN_KEY and legacy credentials from *_FILE`
- Do NOT push or open a PR.

## Steps

### Step 1: Add `GetSecretEnv` to `backend/utils/utils.go`

```go
// GetSecretEnv resolves a sensitive setting that may be supplied either
// inline (KEY=value) or as a file (KEY_FILE=/run/secrets/name), the
// convention Docker Compose `secrets:` and Kubernetes Secret volumes use.
// The file wins when both are set. Its contents are read once and trailing
// CR/LF stripped, so a secret written with `echo` works. A KEY_FILE that
// cannot be read is fatal: the operator asked for a secret the process
// cannot honour, and running without it would be silently wrong.
//
// The value is never logged; only the path is.
func GetSecretEnv(key string) string {
	if path := os.Getenv(key + "_FILE"); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			log.Fatalf("cannot read %s_FILE=%q: %v", key, path, err)
		}
		return strings.TrimRight(string(data), "\r\n")
	}
	return os.Getenv(key)
}
```

Add `"log"` and `"strings"` to the imports. Keep `GetEnv` unchanged.

**Verify**: `cd backend && go build ./... && go vet ./utils/` → exit 0.

### Step 2: Use it at the two call sites

`garage.go:128` → `key := GetSecretEnv("API_ADMIN_KEY")` (same package, no
prefix). `main.go:104-105` → `utils.GetSecretEnv("AUTH_USER_PASS")` and
`utils.GetSecretEnv("AUTH_VIEWER_USER_PASS")`.

**Verify**: `grep -rn 'Getenv("API_ADMIN_KEY")\|GetEnv("AUTH_USER_PASS"\|GetEnv("AUTH_VIEWER_USER_PASS"' backend/` → no matches.

### Step 3: Tests in `backend/utils/utils_test.go`

Because the failure path calls `log.Fatalf`, test only the non-fatal paths
(the fatal path is a one-liner; do not add an `os.Exit` interception harness).
Use `t.TempDir()` + `os.WriteFile` and `t.Setenv`:

- `TestGetSecretEnvPlainValue` — `KEY=abc`, no `_FILE` → `"abc"`.
- `TestGetSecretEnvFileWins` — `KEY=plain`, `KEY_FILE` → file with `"fromfile\n"` → `"fromfile"`.
- `TestGetSecretEnvStripsTrailingCRLF` — file `"v\r\n"` → `"v"`; file `"v\n\n"` → `"v"`.
- `TestGetSecretEnvPreservesInnerWhitespace` — file `"a b \n"` → `"a b "` (only trailing CR/LF stripped, matching the doc comment).
- `TestGetSecretEnvUnset` — neither set → `""`.

Use a unique key name per test (e.g. `SECRET_TEST_A`) so `t.Setenv` cleanup
cannot bleed between subtests.

**Verify**: `cd backend && go test -race ./utils/ -run TestGetSecretEnv -v` → 5 `--- PASS`.

### Step 4: Docs

README env table (`README.md` ~line 214): add one row directly under
`API_BASE_URL`, and one under each legacy row:

- `API_ADMIN_KEY_FILE` — *(unset)* — Path to a file holding the admin token;
  wins over `API_ADMIN_KEY`. Trailing newline stripped. Use with Compose
  `secrets:` / Kubernetes Secret volumes.
- `AUTH_USER_PASS_FILE`, `AUTH_VIEWER_USER_PASS_FILE` — same sentence, "wins
  over the plain variable".

If `API_ADMIN_KEY` itself has no row yet (plan 057 not executed), add it:
*(from `garage.toml`)* — Overrides the admin bearer token from `garage.toml`.
Supply as a secret, never inline in a compose file. **No example value.**

`.env.example`: under the connection section add commented lines
`# API_ADMIN_KEY_FILE=/run/secrets/garage_admin_token` with a one-line note,
and a compose snippet in a comment is **not** needed — the README row suffices.

`docs/authentication.md` legacy section: add "Both accept a `_FILE` variant
naming a file that holds the value." to the `AUTH_USER_PASS` paragraph.

**Verify**: `grep -c "_FILE" README.md` → ≥ 3; `grep -n "API_ADMIN_KEY_FILE" .env.example` → 1; `grep -c "_FILE" docs/authentication.md` → ≥ 1; `grep -rniE "[0-9a-f]{32,}" README.md .env.example docs/authentication.md` → no matches.

### Step 5: Gates

```
cd backend && go build ./... && go vet ./... && test -z "$(gofmt -l .)" && go test -race ./...
git diff --stat 8e062cb..HEAD
```

## Done criteria

- [ ] `cd backend && go test -race ./...` all `ok`; 5 new `TestGetSecretEnv*` tests pass
- [ ] `gofmt -l backend` empty; `go vet` clean
- [ ] `grep -rn 'Getenv("API_ADMIN_KEY")' backend/` → no matches
- [ ] `grep -n "GetSecretEnv" backend/utils/garage.go backend/main.go` → 3 matches total
- [ ] `grep -n "log.Printf.*data\|log.Print.*string(data)" backend/utils/utils.go` → no matches (value never logged)
- [ ] README has `API_ADMIN_KEY_FILE`, `AUTH_USER_PASS_FILE`, `AUTH_VIEWER_USER_PASS_FILE` rows
- [ ] `git diff --stat 8e062cb..HEAD` lists only the in-scope files
- [ ] `plans/README.md` row updated

## STOP conditions

- The excerpts above do not match the live code.
- `GetAdminKey` is called before `log` output is safe, or from a hot path
  where reading a file per call matters — it is called per admin request
  (`garage.go:173` and `proxy.go`). **This is expected and acceptable** for
  a small file, but if a benchmark or reviewer objects, the fix is to cache
  the resolved value in a package-level `sync.Once`, still inside `utils.go`.
  Do that only if asked; otherwise proceed.
- You find yourself adding `_FILE` handling to a non-secret variable.

## Maintenance notes

- Any **new** secret-bearing env var added later must go through
  `GetSecretEnv`, not `GetEnv`/`os.Getenv`; reviewer should grep for that on
  future auth/config PRs.
- The per-request file read in `GetAdminKey` is the simplest correct thing;
  if the admin proxy ever becomes high-QPS, memoise (see STOP conditions).
- Deferred deliberately: `SESSION_*`, `DB_PATH` etc. are not secrets; the
  Garage `garage.toml` path is already a file.

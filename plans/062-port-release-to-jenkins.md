# Plan 062: Port the signed-binary release from GitHub Actions to Jenkins

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 012066a..HEAD -- Jenkinsfile .github/workflows/release.yml Dockerfile CLAUDE.md README.md backend/cmd/relsign/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (release blocker)
- **Effort**: M
- **Risk**: MED (touches the release path; mitigated by a validator gate and a local dry-run of the build half)
- **Depends on**: none in the repo. **Jenkins-side prerequisites** (maintainer, see below) must exist before the first real tag build succeeds, but not before this plan is executed.
- **Category**: dx
- **Planned at**: commit `012066a`, 2026-08-27
- **Release track**: v4 (and unblocks the already-tagged v3.9.0)

## Why this matters

`v3.9.0` was tagged on 2026-08-27 and its GitHub Actions `Release` run sat
**queued forever**: both jobs in `.github/workflows/release.yml` are
`runs-on: self-hosted` and the repository has **zero** registered runners
(they were retired when CI moved to Jenkins on 2026-08-19). Every future tag
will do the same. CI and the image publish already run on Jenkins from the
root `Jenkinsfile`; the release is the last piece still pointing at
infrastructure that no longer exists.

After this plan, pushing a `v*` tag makes Jenkins: verify `package.json`
matches the tag, build the embedded-UI binaries for linux/amd64 and
linux/arm64, write `SHA256SUMS`, sign it with `relsign`, create the GitHub
release with those four assets, and additionally push the multi-arch image
as `ghcr.io/t1nk333r/garage-webui-ng:<X.Y.Z>` and `:<X.Y>`. `release.yml` is
deleted so a tag no longer also queues a dead GitHub run.

## Jenkins-side prerequisites (maintainer, not the executor)

Recorded here so the executor knows what the pipeline assumes. The executor
does **not** touch Jenkins.

1. **Tag discovery.** The organisation folder `d7eeem` (and therefore the
   generated `garage-webui-ng` multibranch job) has only
   `BranchDiscoveryTrait` + `OriginPullRequestDiscoveryTrait`. Without
   `TagDiscoveryTrait` ("Discover tags") a `when { tag }` stage never runs
   because no tag job is ever created. Enable it on the org folder's GitHub
   navigator and re-scan.
2. **Credential `relsign-key`** — *Secret text*, the ed25519 private key hex
   that GitHub held as the `RELEASE_SIGNING_KEY` secret. Same value; never
   printed anywhere.
3. **Credential `github-release-token`** — *Secret text*, a GitHub token with
   **Contents: read & write** on this repo (the existing `github-pat` is
   read-only for Contents per the CI handoff and cannot create a release).
4. The agent already has Node 20 + pnpm (corepack), Go 1.25.13, Docker
   buildx, `curl`, `sha256sum`. It does **not** necessarily have `gh` or
   `jq`; the pipeline below uses only `curl` + `node -e` for JSON.

## Current state

- `.github/workflows/release.yml` (117 lines) — the workflow being ported.
  Steps that must survive, verbatim in intent: tag↔`package.json` check
  (lines 39-47), frontend build (49), `CGO_ENABLED=0 GOOS=linux
  GOARCH=<arch> go build -tags=prod -trimpath -ldflags="-s -w -X
  main.version=<tag>"` after `cp -r ../dist ui/dist` (59-65), `sha256sum
  garage-webui-ng-linux-* > SHA256SUMS` (92-96), signing (97-109):

```yaml
          cd backend
          go run ./cmd/relsign sign \
            -key-env RELEASE_SIGNING_KEY \
            -in ../dist-artifacts/SHA256SUMS \
            -out ../dist-artifacts/SHA256SUMS.sig
```

  and publishing the four files to a GitHub release with generated notes
  (110-117, `softprops/action-gh-release@v2`).
- `backend/cmd/relsign/main.go` — `relsign sign -key-env NAME -in F -out F`
  reads the key **only** from the named env var (never a flag), and
  `relsign verify` is what the README's "Verifying a release" section tells
  users to run. Do not change it.
- `Jenkinsfile` — declarative; `agent { label 'docker' }`;
  `disableConcurrentBuilds(abortPrevious: true)`; stages: Frontend install →
  lint (non-blocking) → typecheck·test·build → Backend build·vet·fmt·test →
  govulncheck → pnpm audit → `Build & push multi-arch image` guarded by
  `when { branch 'main' }` (lines 74-110). That last stage logs into GHCR
  with `usernamePassword` credential `ghcr-pat`, sets up the
  `jenkins-multiarch` buildx builder, and pushes `:main`, `:latest`,
  `:sha-<short>` with `--build-arg VERSION=main`. Header comment line 2:
  `// release.yml (signed binaries on v* tags) is NOT ported yet.`
- `Dockerfile:25-34` comment names `.github/workflows/release.yml (×2)` as
  Go-pin sites. `CLAUDE.md:14-18` says the same (its whole CI paragraph is
  also the subject of plan 057; touch **only** the release.yml mention here).
- `README.md` "Verifying a release" (~line 152) documents `SHA256SUMS`,
  `SHA256SUMS.sig` and `relsign verify` — asset names must stay identical.

Multibranch facts the executor must rely on: on a tag build Jenkins sets
`env.TAG_NAME` (e.g. `v3.9.0`) and `env.BRANCH_NAME` equals it;
`when { tag pattern: 'v*', comparator: 'GLOB' }` selects tag builds;
`when { branch 'main' }` is false on tag builds, so the existing image stage
does not run for tags.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Validate Jenkinsfile | `curl -sS --netrc-file ~/.jenkins-netrc -X POST --data-urlencode "jenkinsfile=$(cat Jenkinsfile)" https://jenkins.aloqaili.xyz/pipeline-model-converter/validate` | `Jenkinsfile successfully validated.` |
| Shell syntax | `bash -n scripts/release.sh` (if you extract one — optional) | exit 0 |
| Frontend | `pnpm install --frozen-lockfile && pnpm run build` | exit 0 |
| Local dry run of the build half | see Step 4 | two binaries, `file` says aarch64 / x86-64, `SHA256SUMS` has 2 lines |
| Go tests | `cd backend && go test -race ./cmd/relsign/` | `ok` |

`~/.jenkins-netrc` exists on this machine with read access to the validator.
If it does not resolve, STOP (see conditions) — do not skip validation.

## Scope

**In scope**:
- `Jenkinsfile` — new stage(s) + header comment
- `.github/workflows/release.yml` — **delete**
- `Dockerfile` — comment lines 25-34 only (pin-site list)
- `CLAUDE.md` — the pin-site sentence only (lines 14-18): replace the
  `release.yml` mention; do not touch anything else in the file
- `README.md` — only if "Verifying a release" or the roadmap/CI text names
  GitHub Actions for releases; grep first

**Out of scope — do NOT touch**:
- `backend/cmd/relsign/` — asset format and verify path are a compatibility
  contract with existing installs' update checker (plan 050).
- `backend/router/update.go` / `selfupdate.go` — they consume the release
  assets by name; unchanged names ⇒ unchanged code.
- The `main`-branch image stage semantics (`:main`, `:latest`, `:sha-*`).
- Jenkins configuration, credentials, the org folder.

## Git workflow

- Branch: `advisor/062-port-release-to-jenkins`
- Conventional commits, e.g. `ci: build, sign and publish releases from Jenkins on v* tags`
- Do NOT push or open a PR.

## Steps

### Step 1: Add the release stage to `Jenkinsfile`

Insert **after** the existing `Build & push multi-arch image` stage (so a
tag build runs the full CI stages first — install through pnpm audit — then
releases). Shape:

```groovy
    // Signed-binary release on v* tags — the port of the retired GitHub
    // Actions release.yml. Runs only for tag builds (tag discovery must be
    // enabled on the multibranch source). Assets and their names are a
    // contract with `relsign verify` and the in-app updater: do not rename.
    stage('Release: verify tag') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      steps {
        sh '''
          set -eu
          TAG="${TAG_NAME#v}"
          PKG=$(node -p "require('./package.json').version")
          if [ "$TAG" != "$PKG" ]; then
            echo "tag v$TAG but package.json says $PKG" >&2
            exit 1
          fi
        '''
      }
    }

    stage('Release: binaries + checksums + signature') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      steps {
        sh '''
          set -eu
          rm -rf release-artifacts && mkdir release-artifacts
          # dist/ is already built by the "Frontend: typecheck · test · build" stage.
          cd backend
          rm -rf ui/dist && cp -r ../dist ui/dist
          for ARCH in amd64 arm64; do
            CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" \
              go build -tags=prod -trimpath -ldflags="-s -w -X main.version=${TAG_NAME}" \
              -o "../release-artifacts/garage-webui-ng-linux-$ARCH" .
          done
          cd ../release-artifacts
          sha256sum garage-webui-ng-linux-* > SHA256SUMS
          cat SHA256SUMS
        '''
        withCredentials([string(credentialsId: 'relsign-key', variable: 'RELEASE_SIGNING_KEY')]) {
          sh '''
            set -eu
            cd backend
            go run ./cmd/relsign sign \
              -key-env RELEASE_SIGNING_KEY \
              -in ../release-artifacts/SHA256SUMS \
              -out ../release-artifacts/SHA256SUMS.sig
          '''
        }
        archiveArtifacts artifacts: 'release-artifacts/*', fingerprint: true
      }
    }

    stage('Release: publish to GitHub') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      environment {
        GH_REPO = 't1nk333r/garage-webui-ng'
      }
      steps {
        withCredentials([string(credentialsId: 'github-release-token', variable: 'GH_TOKEN')]) {
          sh '''
            set -eu
            API="https://api.github.com/repos/$GH_REPO"
            AUTH="Authorization: Bearer $GH_TOKEN"
            # Create (or reuse) the release. generate_release_notes mirrors the old workflow.
            BODY=$(node -e 'console.log(JSON.stringify({tag_name:process.argv[1],name:process.argv[1],generate_release_notes:true}))' "$TAG_NAME")
            RESP=$(curl -sS -f -H "$AUTH" -H "Accept: application/vnd.github+json" \
                     -X POST "$API/releases" -d "$BODY" 2>/dev/null \
                   || curl -sS -f -H "$AUTH" -H "Accept: application/vnd.github+json" \
                     "$API/releases/tags/$TAG_NAME")
            RELEASE_ID=$(printf '%s' "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
            UPLOAD="https://uploads.github.com/repos/$GH_REPO/releases/$RELEASE_ID/assets"
            cd release-artifacts
            for F in garage-webui-ng-linux-amd64 garage-webui-ng-linux-arm64 SHA256SUMS SHA256SUMS.sig; do
              curl -sS -f -H "$AUTH" -H "Content-Type: application/octet-stream" \
                --data-binary "@$F" "$UPLOAD?name=$F" > /dev/null
              echo "uploaded $F"
            done
          '''
        }
      }
    }

    stage('Release: versioned image tags') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      environment {
        IMAGE = 'ghcr.io/t1nk333r/garage-webui-ng'
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'ghcr-pat',
            usernameVariable: 'REG_USER', passwordVariable: 'REG_TOKEN')]) {
          sh 'echo "$REG_TOKEN" | docker login ghcr.io -u "$REG_USER" --password-stdin'
        }
        sh '''
          set -eu
          VER="${TAG_NAME#v}"            # 3.9.0
          MINOR="${VER%.*}"              # 3.9
          docker run --privileged --rm tonistiigi/binfmt --install arm64
          docker buildx create --name jenkins-multiarch --driver docker-container --use 2>/dev/null \
            || docker buildx use jenkins-multiarch
          docker buildx build \
            --platform linux/amd64,linux/arm64 \
            -t "$IMAGE:$VER" -t "$IMAGE:$MINOR" \
            --build-arg VERSION="${TAG_NAME}" \
            --label org.opencontainers.image.title="Garage WebUI-NG" \
            --label org.opencontainers.image.version="$VER" \
            --label org.opencontainers.image.licenses=MIT \
            --cache-from type=registry,ref="$IMAGE:buildcache" \
            --push .
        '''
      }
      post { always { sh 'docker logout ghcr.io || true' } }
    }
```

Notes for the executor:
- Keep `set -eu` and single-quoted `sh '''…'''` blocks so `$VAR` is
  expanded by the shell, not Groovy. `${TAG_NAME#v}` is shell parameter
  expansion — it must stay inside a shell block.
- The `relsign` env var name `RELEASE_SIGNING_KEY` is the name the tool is
  told to read via `-key-env`; the Jenkins credential ID is `relsign-key`.
  Never echo either.
- Do **not** add `--cache-to` in the tag image stage; `main` owns the cache.
- Update the header comment: replace line 2 with
  `// Release (signed binaries + versioned image tags) runs on v* tags — see the Release: stages.`

**Verify**: validator command from the table → `Jenkinsfile successfully validated.` Also `grep -c "when { tag pattern: 'v\*', comparator: 'GLOB' }" Jenkinsfile` → `4`.

### Step 2: Delete the GitHub workflow

`git rm .github/workflows/release.yml`. `.github/workflows/` then becomes
empty — remove the directory if git leaves it (`rmdir` is fine; git does not
track empty dirs).

**Verify**: `ls .github/workflows 2>&1` → "No such file or directory" (or empty).

### Step 3: Comments and docs

- `Dockerfile:33-34`: the pin-lockstep sentence must now read: keep in
  lockstep with the Go version in the Jenkins agent image (see the
  `Jenkinsfile` header). Remove the `release.yml` reference.
- `CLAUDE.md:14-18`: same edit to the pin-site list — the in-repo sites are
  now **one**: the `Dockerfile`; the other is the Jenkins agent image.
  Leave `ci.yml` wording for plan 057 if it is still present; change only
  the `release.yml` token. (If 057 has already run, the sentence names
  `release.yml ×2`; reduce accordingly.)
- `README.md`: `grep -n "release.yml\|GitHub Actions\|workflows/" README.md`
  — fix only lines that claim releases are built by GitHub Actions. The
  "Verifying a release" instructions stay as they are.

**Verify**: `grep -rn "release.yml" Jenkinsfile Dockerfile CLAUDE.md README.md` → no matches.

### Step 4: Local dry run of the build half (no signing, no publish)

From the repo root, replicate the binaries stage exactly:

```
pnpm install --frozen-lockfile && pnpm run build
rm -rf /tmp/rel && mkdir /tmp/rel && cd backend && rm -rf ui/dist && cp -r ../dist ui/dist
for ARCH in amd64 arm64; do CGO_ENABLED=0 GOOS=linux GOARCH=$ARCH go build -tags=prod -trimpath -ldflags="-s -w -X main.version=v0.0.0-dryrun" -o /tmp/rel/garage-webui-ng-linux-$ARCH .; done
cd /tmp/rel && sha256sum garage-webui-ng-linux-* > SHA256SUMS && cat SHA256SUMS
file garage-webui-ng-linux-arm64 garage-webui-ng-linux-amd64
/tmp/rel/garage-webui-ng-linux-amd64 -version 2>/dev/null || true
```

Then restore the tree: `rm -rf backend/ui/dist` (it is untracked build
output; `git status` must not show it) and `rm -rf /tmp/rel`.

**Verify**: `file` reports `ARM aarch64` and `x86-64`; `SHA256SUMS` has 2 lines; `git status --short` shows only the in-scope files.

### Step 5: Gates

```
curl -sS --netrc-file ~/.jenkins-netrc -X POST --data-urlencode "jenkinsfile=$(cat Jenkinsfile)" https://jenkins.aloqaili.xyz/pipeline-model-converter/validate
cd backend && go build ./... && go vet ./... && go test -race ./cmd/relsign/
git diff --stat 012066a..HEAD
```

## Test plan

There is no unit-testable code; the gates are: the declarative validator
accepts the Jenkinsfile, the local dry run produces correct-arch binaries and
a two-line `SHA256SUMS`, and `relsign`'s own tests still pass untouched. The
**first real proof is the tag build on Jenkins** after the maintainer
completes the prerequisites — recorded as a follow-up in Maintenance notes,
not as a done criterion the executor can satisfy.

## Done criteria

- [ ] Validator → `Jenkinsfile successfully validated.`
- [ ] `grep -c "comparator: 'GLOB'" Jenkinsfile` → `4`
- [ ] `grep -n "relsign-key\|github-release-token" Jenkinsfile` → both present, each once
- [ ] `grep -n "RELEASE_SIGNING_KEY" Jenkinsfile` → appears only in `withCredentials(... variable: 'RELEASE_SIGNING_KEY')` and `-key-env RELEASE_SIGNING_KEY`; never in an `echo`
- [ ] `test ! -f .github/workflows/release.yml`
- [ ] `grep -rn "release.yml" Jenkinsfile Dockerfile CLAUDE.md README.md` → none
- [ ] Local dry run: both binaries built, `file` arch correct, `SHA256SUMS` 2 lines
- [ ] `git diff 012066a..HEAD -- backend/cmd backend/router` is empty
- [ ] `git status --short` after cleanup shows no `backend/ui/dist`, no stray artifacts
- [ ] `plans/README.md` row updated

## STOP conditions

- The validator endpoint is unreachable or returns anything other than the
  success string after you fixed obvious syntax — paste the error; do not
  commit an unvalidated Jenkinsfile.
- `~/.jenkins-netrc` is missing — the validator needs it; report.
- `relsign sign` flags differ from `-key-env/-in/-out` (read
  `backend/cmd/relsign/main.go` usage text first).
- You are tempted to change asset names, `relsign`, or the updater — that
  breaks existing installs' update verification.
- The local cross-compile fails for arm64 — report the error; do not drop
  the arch.

## Maintenance notes

- **Maintainer follow-up to actually ship v3.9.0**: (1) enable "Discover
  tags" on the `d7eeem` org folder and re-scan; (2) create credentials
  `relsign-key` and `github-release-token`; (3) merge this; (4) re-push the
  tag (`git push origin :v3.9.0 && git push origin v3.9.0`) or trigger the
  `v3.9.0` job by hand; (5) confirm the release has 4 assets and
  `relsign verify` passes on a downloaded `SHA256SUMS`; (6) confirm
  `ghcr.io/t1nk333r/garage-webui-ng:3.9.0` exists. The stuck GitHub run was
  already cancelled.
- `disableConcurrentBuilds(abortPrevious: true)` applies per job; tag jobs
  are separate from `main`, so a tag build is not aborted by a `main` push.
- If a tag build fails after the release was created but before all assets
  uploaded, re-running is safe: the publish stage falls back to fetching the
  existing release by tag, and re-uploading an existing asset name returns
  422 — delete the partial asset in the GitHub UI first, then re-run.
- The Go pin now has one in-repo site (`Dockerfile`) and one out-of-repo
  site (agent image). Plan 057's maintenance note about a lockstep check
  stage still applies.

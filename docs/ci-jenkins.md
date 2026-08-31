# CI on Jenkins

CI and releases for this repository run on a self-hosted Jenkins, not GitHub
Actions. This is the operator-facing note for that setup: what exists, the
constraints that shaped it, and the failure modes that have actually bitten.

The pipeline itself is the [`Jenkinsfile`](../Jenkinsfile) at the repo root and
is the source of truth for stage order; this document covers what lives *around*
it and cannot be read off the pipeline.

## Why not GitHub Actions

The project ran out of free GitHub-hosted Actions minutes. Self-hosted runner
minutes are free and unmetered, so the work moved off hosted runners. Two
GitHub-runner approaches were tried and abandoned in favour of Jenkins, which
was already running for other repositories.

## Topology

- **Controller** — Jenkins on a private-network host, auth enabled, anonymous
  gets 403. Reachable on the LAN and through a public hostname.
- **Agent** — label `docker`, an *inbound WebSocket* agent (image ships the
  Docker CLI, buildx, Node 20 + corepack, and the pinned Go toolchain). Outbound
  connection only; the agent exposes no ports.
- **Job layout** — an organization folder scans the owner's repositories and
  auto-creates a multibranch pipeline for any repo containing a `Jenkinsfile`.
  This repo's jobs are `main` plus one job per `v*` tag.

## Constraints worth knowing before changing anything

**The controller is on RFC1918 space, so GitHub cannot reach it.** Everything
Jenkins does towards GitHub — clone, push, commit status, GHCR — is outbound and
works. Inbound webhooks are impossible without a tunnel. Discovery therefore
runs on a **periodic folder trigger** (poll), which is why a push takes a few
minutes to produce a build.

If a tunnel is ever added, expose **only** `^/github-webhook/` and 404 the rest.
Never expose all of Jenkins: `/script` is remote code execution by design.

**Tag jobs are not built automatically.** Tag discovery is enabled, so pushing a
`v*` tag creates the job, but indexing logs `No automatic build triggered` and
stops there. Releases are started deliberately — trigger the tag job from the UI
or `POST /job/<folder>/job/<repo>/job/<tag>/build`.

**A moved tag needs a re-index.** If a tag is deleted and re-created at a
different commit, its job stays pinned to the old revision until the folder is
scanned again. Re-index first, confirm the log shows `Changes detected: <tag>
(<old> → <new>)`, then build.

**`main` builds should not be triggered by hand.** `disableConcurrentBuilds(
abortPrevious: true)` means a manual trigger racing the periodic one leaves the
loser as `NOT_BUILT`, which reads like a failure and is not one.

## Credentials the pipeline expects

| ID | Kind | Used for |
|----|------|----------|
| `github-pat` | username/password | Repository scanning, clone, commit status |
| `ghcr-pat` | username/password | `docker login ghcr.io` for image push |
| `relsign-key` | secret text | ed25519 private key for release signing |
| `github-release-token` | secret text | Creating the GitHub release, `contents:write` |

Hard-won details:

- **GHCR refuses fine-grained PATs entirely.** Image push needs a *classic* PAT
  with `write:packages`. A fine-grained token fails in a way that looks like a
  credential typo.
- **A fine-grained PAT's permissions can differ per repository.** A repo missing
  `Contents` or `Pull requests: read` aborts *that repo's* scan with a 403 while
  the rest of the org imports fine.
- **An empty credential still binds.** `withCredentials` succeeds and the
  failure surfaces deep inside the stage that uses the value — as
  `password is empty`, `parameter not set`, or a decode error. Verify a
  credential by running the stage, not by looking at the credential list.
- **`relsign-key` must be the bare hex private key** — no label, quotes, or
  trailing newline. Anything else fails to decode and the release build dies
  after building every artifact. See the signing section of the [README](../README.md).
- **Changing the scan credential needs two indexing runs.** The GitHub plugin
  caches connections, so the first scan after the change still reports the
  anonymous 60/hr quota and looks like the new token failed. The second run
  shows the real 5000/hr limit.

## API access

REST with a Jenkins API token in a netrc file:

```sh
printf 'machine JENKINS_HOST\nlogin YOUR_LOGIN\npassword YOUR_API_TOKEN\n' \
  > ~/.jenkins-netrc && chmod 600 ~/.jenkins-netrc
curl -sS --netrc-file ~/.jenkins-netrc https://JENKINS_HOST/api/json | head -c 200
```

The login ID is not the display name — read it from the URL of your user page,
`/user/<this-part>/`. Writes need a CSRF crumb from `/crumbIssuer/api/json`,
sent as the `Jenkins-Crumb` header.

Useful endpoints: `/job/<...>/lastBuild/consoleText` for a build log,
`/job/<folder>/job/<repo>/indexing/consoleText` for the last scan, and
`POST /pipeline-model-converter/validate` with `jenkinsfile=@Jenkinsfile` to
lint the declarative pipeline without running it.

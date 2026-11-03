# garage-update

`garage-update` updates Garage and Garage WebUI-NG on a host that runs both as
systemd services from plain binaries, in an LXC container, a VM or on bare
metal. That is the layout of
[Path C in `docs/UPGRADING.md`](../../docs/UPGRADING.md#path-c-binary-under-systemd-lxc-vm-bare-metal).
The scripts call Garage the "core" and WebUI-NG the "gui". Docker deployments
update by pulling a new image instead.

| File | Runs on | What it does |
|---|---|---|
| `garage-update` | the Garage host, as root | Checks for updates, verifies and installs them, and rolls an update back when the new version fails its health checks. |
| `garage-update-remote` | your workstation | Runs `garage-update` on the host over SSH, or inside a Proxmox container through its host. Keeps the host's copy of `garage-update` in step with this checkout, and can build the web UI from this checkout. |

## Quick start

Install the script on the host. It needs `curl` and Python 3.11 or newer, plus
OpenSSL 3 to verify WebUI-NG releases. Debian 12 and 13 package all three.

```sh
install -m 0755 contrib/garage-update/garage-update /usr/local/sbin/garage-update
garage-update          # installed and latest versions, service health
garage-update all      # update both to their latest releases (asks first)
```

To run it from a workstation instead, describe the target once in
`~/.config/garage-update/remote.env`, outside the repository.
`XDG_CONFIG_HOME` replaces `~/.config`, and `GARAGE_UPDATE_REMOTE_CONF` names a
different file.

```sh
GARAGE_UPDATE_HOST=root@pve.example     # SSH destination
GARAGE_UPDATE_CTID=210                  # Proxmox container ID; omit for a plain host
GARAGE_UPDATE_SSH_OPTS="-i $HOME/.ssh/id_ed25519"
```

Then run it from the checkout:

```sh
contrib/garage-update/garage-update-remote status
contrib/garage-update/garage-update-remote all
contrib/garage-update/garage-update-remote gui --build   # this checkout's HEAD
```

Each `garage-update-remote` run first installs or refreshes
`/usr/local/sbin/garage-update` on the target, so you never install it there by
hand. A run opens one SSH connection and passes your terminal through, so
`garage-update` can ask for confirmation. It exits with `garage-update`'s exit
status.

## Commands

| Command | What it does |
|---|---|
| `status` (default) | Shows the installed and latest version of each, and the service state and health. |
| `core [VERSION]` | Updates Garage to `VERSION`, by default the latest release. |
| `gui [VERSION]` | Updates WebUI-NG to a GitHub release, by default the latest. |
| `all` | Runs `core`, then `gui`, each to its latest release, after one confirmation. |

| Option | Effect |
|---|---|
| `--file PATH` | With `core` or `gui`, installs this binary instead of downloading one. |
| `--sha256 HEX` | With `--file`, refuses the file unless it has this SHA-256. |
| `-n`, `--dry-run` | Downloads and verifies everything, then stops without changing anything. |
| `-y`, `--yes` | Skips the confirmation. Required when there is no terminal. |
| `--force` | Allows a reinstall, a downgrade, a major Garage upgrade, a version that cannot be compared, or an update to a service that is stopped or unhealthy. |

`garage-update-remote` takes the same commands and options, plus
`gui --build [REF]` and `install`.

### Exit status

| Status | Meaning |
|---|---|
| 0 | Done, or nothing to do. |
| 1 | Failed before anything changed. |
| 2 | Usage error. |
| 3 | Failed and rolled back. |
| 4 | Failed, and the rollback failed too. Follow the `RESTORE.txt` in the backup that the error message names. |
| 5 | One component was updated, then a later step failed before changing anything more. With `all`, this means Garage was updated and the web UI was not. |
| 130 | Interrupted by Ctrl-C or SIGTERM before anything changed. |

With `all`, a 3 or 4 after a successful Garage update is about the web UI, and
the run prints a note that the Garage update stays in place.

Every `core`, `gui` and `all` run, dry runs included, appends its output to
`BACKUP_DIR/garage-update.log`, so the record survives a closed terminal.

## What an update does

1. **Plan.** It resolves the target version and compares it with the installed
   one. Without `--force`, it does nothing when that version is already
   installed or when the latest release is older than the installed build, and
   it refuses, before it downloads the binary:
   - a version you named that is older than the installed one;
   - a Garage upgrade across a major version, which needs Garage's migration
     steps;
   - a version it cannot compare with the installed one;
   - an update to a service that is stopped or unhealthy.

   It then prints the plan and asks for confirmation.
2. **Verify, with the services still running.**
   - Garage: the version and download URL come from the official release
     index, `https://garagehq.deuxfleurs.fr/_releases.json`, over HTTPS. The
     download must be exactly the size the index lists, and the binary must
     report the expected version. Garage publishes no checksums or signatures
     for its binaries, so this relies on HTTPS to the official host.
   - WebUI-NG: the checks the in-browser updater makes, plus a version check.
     OpenSSL checks the ed25519 signature on the release's `SHA256SUMS` against
     `WEBUI_PUBKEY`, the key in `backend/release_key.go`. Only then is the
     binary checked against `SHA256SUMS`, and it must report the release tag as
     its version.
   - `--file`: the file is checked against `--sha256` when you give one. It
     must run and report a version, and the plan compares that version. Two
     builds at the same `git describe` distance from a tag count as different
     builds, so installing one over the other needs no `--force`.

   A download that stays below 32 KiB/s for 30 seconds is cut off and retried,
   up to four attempts in all. The Garage release host can be slow.
3. **Back up.** Before it stops Garage, it runs `garage meta snapshot`. With
   the service stopped, it copies the old binary and the whole `metadata_dir`
   to `BACKUP_DIR/core-<from>-to-<to>-<time>/`. When `metadata_dir` is a
   symlink, it copies the directory the link points to. For WebUI-NG it copies
   the binary and the user database, `DB_PATH` plus any `-wal`, `-shm` or
   `-journal` file, to `BACKUP_DIR/gui-<from>-to-<to>-<time>/`. Each backup
   holds a `RESTORE.txt` with the exact steps to restore it by hand. Garage's
   data blocks (`data_dir`) are never copied.
4. **Swap and check.** It renames the new binary into place, which is atomic,
   and starts the service. Garage must answer `/health` and report a healthy
   cluster, the running node must report the new version, and the bucket and
   key counts must match the counts from before. WebUI-NG must serve its API
   and its UI page, which also catches a build without the embedded frontend,
   and must report the same setup state as before. Neither service may log a
   panic after it starts.
5. **Roll back on any failure after the stop, including Ctrl-C.** It puts the
   old binary and data back, restarts the service and checks its health again.
   It replaces the contents of the metadata directory rather than the
   directory itself, so a mount point works too. Whatever the failed version
   left behind stays in the backup, in `meta.failed/` or `db-failed/`. A
   closed terminal or a dropped SSH session does not stop a run, which then
   finishes or rolls back on its own.
6. **Prune and log.** It keeps the newest `KEEP_BACKUPS` backups of each
   component and deletes older ones, but never a directory it did not create.
   It logs a one-line result to syslog, which `journalctl -t garage-update`
   shows.

Restarting WebUI-NG signs everyone out, because sessions are kept in memory.

## Settings

`/etc/garage-update.conf` overrides any of these defaults. It uses shell
syntax, must be owned by the user who runs the script (root), and must not be
writable by group or others. `GARAGE_UPDATE_CONF` names a different file.

| Setting | Default |
|---|---|
| `GARAGE_BIN` | `/usr/local/bin/garage` |
| `GARAGE_CONFIG` | `/etc/garage.toml`, which also supplies `metadata_dir` and the admin API address |
| `GARAGE_SERVICE` | `garage.service` |
| `GARAGE_ADMIN_URL` | `http://127.0.0.1:<port of [admin] api_bind_addr>` |
| `GARAGE_ADMIN_TOKEN_FILE` | `admin_token` or `admin_token_file` from `GARAGE_CONFIG` |
| `GARAGE_PLATFORM` | from `uname -m`, for example `x86_64-unknown-linux-musl` |
| `GARAGE_RELEASES_URL` | `https://garagehq.deuxfleurs.fr/_releases.json` |
| `WEBUI_BIN` | `/usr/local/bin/garage-webui-ng` |
| `WEBUI_SERVICE` | `garage-webui.service` |
| `WEBUI_URL` | `http://<HOST>:<PORT><BASE_PATH>` from the service's environment |
| `WEBUI_DB` | `DB_PATH` from the service's environment |
| `WEBUI_REPO` | `t1nk333r/garage-webui-ng` |
| `WEBUI_PUBKEY` | the release key from `backend/release_key.go` |
| `BACKUP_DIR` | `/root/upgrade-backups` |
| `KEEP_BACKUPS` | `3` per component |
| `CORE_HEALTH_TIMEOUT` / `WEBUI_HEALTH_TIMEOUT` | `90` / `45` seconds |
| `LOCK_FILE` | `/run/lock/garage-update.lock` |
| `SYSTEMCTL` / `JOURNALCTL` | `systemctl` / `journalctl` |

Without an admin token, the update only checks that Garage answers `/health`.
It skips the cluster health, node version and bucket and key count checks, and
prints a warning. The script writes the token only to a mode 0600 header file
for `curl`, never to a command line or to its output.

## Building the web UI from this checkout

`garage-update-remote gui --build [REF]` checks out `REF` (default `HEAD`) in a
temporary worktree, so uncommitted changes are left out. It runs
`pnpm install --frozen-lockfile` and `pnpm run build`, embeds the result, and
compiles for the target's architecture with the Go toolchain pinned in the
`Dockerfile`. The workstation needs `git`, `pnpm`, `go` and `make`. It then
copies the binary to the target and installs it with
`garage-update gui --file <path> --sha256 <hash>`, so the copy is checked too.
The build's version is `git describe` of `REF`, which compares as newer than
the release it builds on.

## Rehearsing safely

Every `systemctl` and `journalctl` call goes through `SYSTEMCTL` and
`JOURNALCTL`. Point a config at user units and throwaway paths, and you can run
the whole flow, rollbacks included, without touching a real deployment:

```sh
SYSTEMCTL="systemctl --user"
JOURNALCTL="journalctl --user"
GARAGE_SERVICE=test-garage.service   # plus GARAGE_BIN, GARAGE_CONFIG, WEBUI_* and
BACKUP_DIR=$HOME/rehearsal/backups   # LOCK_FILE, pointing at your test copies
```

Then run `GARAGE_UPDATE_CONF=/path/to/that.conf garage-update ...`.

## Limits

- It updates one host at a time. On a multi-node cluster, update one node, let
  the cluster settle, then move to the next. The script checks cluster health
  but does not run a rolling upgrade for you.
- Garage downloads are trusted on HTTPS, the size the index lists and the
  version the binary reports.
- It updates an existing, working install. It does not install from scratch,
  and it refuses to update a binary that does not run.
- It refuses a `data_dir` inside `metadata_dir`, because backing up the
  metadata would copy every data block and a rollback would replace them with
  the backed-up copies. Back that layout up by hand.
- WebUI-NG release binaries exist for x86_64 and arm64 only. On other
  architectures, install a build with `--file`.
- Relative paths in `garage.toml` resolve against Garage's working directory,
  the unit's `WorkingDirectory`. The script runs the Garage CLI from there, so
  it sees the same paths Garage does.

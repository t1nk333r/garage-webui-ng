# garage-update

One command to keep **Garage** (the "core") and **Garage WebUI-NG** (the
"gui") up to date on a host that runs both as systemd services from plain
binaries — the layout of
[Path C in `docs/UPGRADING.md`](../../docs/UPGRADING.md#path-c--binary-under-systemd-lxc-vm-bare-metal)
(an LXC container, a VM, bare metal). Docker deployments update by pulling a
new image instead.

| File | Runs on | Job |
|---|---|---|
| `garage-update` | the Garage host, as root | finds, verifies, installs and — if the new version is unhealthy — rolls back updates |
| `garage-update-remote` | your workstation | runs `garage-update` over SSH (or inside a Proxmox container), keeps it in sync, builds the web UI from this checkout |

## Quick start

On the host (needs `curl`, Python 3.11+ and OpenSSL 3, all standard on
Debian 12/13):

```sh
install -m 0755 contrib/garage-update/garage-update /usr/local/sbin/garage-update
garage-update          # installed vs latest versions, service health
garage-update all      # update both to their latest releases (asks first)
```

From a workstation, describe the target once in
`~/.config/garage-update/remote.env` (kept out of the repository):

```sh
GARAGE_UPDATE_HOST=root@pve.example     # SSH destination
GARAGE_UPDATE_CTID=210                  # Proxmox container ID; omit for a plain host
GARAGE_UPDATE_SSH_OPTS="-i $HOME/.ssh/id_ed25519"
```

then:

```sh
contrib/garage-update/garage-update-remote status
contrib/garage-update/garage-update-remote all
contrib/garage-update/garage-update-remote gui --build   # this checkout's HEAD
```

Every `garage-update-remote` run first installs or refreshes
`/usr/local/sbin/garage-update` on the target, so there is no separate install
step. It uses one SSH connection per run, and passes your terminal through so
the confirmation prompt works.

## Commands

| Command | Does |
|---|---|
| `status` (default) | installed and latest version of each, service state and health |
| `core [VERSION]` | update Garage to `VERSION` (default: the latest release) |
| `gui [VERSION]` | update WebUI-NG to a GitHub release (default: the latest) |
| `all` | `core`, then `gui`, each to its latest release, after one confirmation |

| Option | |
|---|---|
| `--file PATH` | `core`/`gui`: install this binary instead of downloading one |
| `--sha256 HEX` | with `--file`: refuse the file unless it has this SHA-256 |
| `-n`, `--dry-run` | download and verify everything, then stop without changing anything |
| `-y`, `--yes` | skip the confirmation (required when there is no terminal) |
| `--force` | allow a reinstall, a downgrade, a major Garage upgrade, or updating a service that is currently unhealthy |

`garage-update-remote` takes the same commands and options, plus
`gui --build [REF]` and `install`.

Exit status: `0` done or nothing to do · `1` failed before anything changed ·
`2` usage error · `3` failed and rolled back · `4` failed **and the rollback
failed** — follow the `RESTORE.txt` in the backup it names · `5` one component
was updated, then a later step failed before changing anything more (with
`all`: Garage updated, the web UI not).

Every update run is also appended to `BACKUP_DIR/garage-update.log`, so the
record survives a closed terminal.

## What an update does

1. **Plans.** Resolves the target version and compares it with the installed
   one. It refuses — before downloading the binary — a downgrade, a
   reinstall, a Garage upgrade across a major version (those need Garage's
   migration steps), or touching a service that is not currently healthy,
   unless you pass `--force`. Then it shows the plan and asks.
2. **Verifies, with everything still running.**
   - *Garage:* the version and URL come from the official release index
     (`https://garagehq.deuxfleurs.fr/_releases.json`, over HTTPS); the
     download must be exactly the size the index lists and must report the
     expected version. Garage publishes no checksums or signatures for its
     binaries, so HTTPS to the official host is the trust anchor. That host
     can be slow: a transfer that stalls is cut off after 30 seconds and
     retried, up to four attempts.
   - *WebUI-NG:* the same chain as the in-browser updater. The ed25519
     signature over the release's `SHA256SUMS` is checked first, with
     OpenSSL, against `WEBUI_PUBKEY` (the key in `backend/release_key.go`); only
     then is the binary checked against `SHA256SUMS`, and it must report the
     release tag as its version.
   - *`--file`:* checked against `--sha256` when given; it must run and report
     a version, which is what the plan compares. Two builds at the same
     `git describe` distance count as different builds, so installing one over
     the other needs no `--force`.
3. **Backs up, with the service stopped.** Garage first takes a
   `garage meta snapshot`; then the old binary and the whole `metadata_dir`
   (symlinks resolved, so the data itself is copied) go to
   `BACKUP_DIR/core-<from>-to-<to>-<time>/`. For WebUI-NG it is
   the binary and the user database (`DB_PATH` and any `-wal`/`-shm` files)
   in `BACKUP_DIR/gui-…/`. Each backup has a `RESTORE.txt` with the exact
   manual steps. Garage's data blocks (`data_dir`) are never copied.
4. **Swaps and checks.** The new binary is moved into place atomically and the
   service started. Garage must answer `/health` and report a healthy cluster,
   the running node must report the new version, and the bucket and key
   counts must equal the ones from before. WebUI-NG must serve its API and its
   UI page (which also catches a build without the embedded frontend), and an
   instance that was set up must still be set up. Neither may log a panic.
5. **Rolls back on any failure after the stop**, including Ctrl-C: the old
   binary and data go back, the service restarts, and its health is checked
   again. The metadata directory's *contents* are replaced, so a mount point
   works too, and whatever the failed version left behind is kept inside the
   backup (`meta.failed/`, `db-failed/`). A closed terminal or a dropped SSH
   session does not interrupt a run: it finishes, or rolls back, on its own.
6. **Prunes** to the newest `KEEP_BACKUPS` backups per component — only ones
   this tool made — and logs a one-line result to syslog (`journalctl -t
   garage-update`).

Restarting WebUI-NG signs everyone out: sessions live in memory.

## Settings

`/etc/garage-update.conf` — shell syntax, owned by root and not writable by
group or others — overrides any of these defaults:

| Setting | Default |
|---|---|
| `GARAGE_BIN` | `/usr/local/bin/garage` |
| `GARAGE_CONFIG` | `/etc/garage.toml` (also the source of `metadata_dir` and the admin API) |
| `GARAGE_SERVICE` | `garage.service` |
| `GARAGE_ADMIN_URL` | `http://127.0.0.1:<port of [admin] api_bind_addr>` |
| `GARAGE_ADMIN_TOKEN_FILE` | `admin_token` / `admin_token_file` from `GARAGE_CONFIG` |
| `GARAGE_PLATFORM` | from `uname -m`, e.g. `x86_64-unknown-linux-musl` |
| `WEBUI_BIN` | `/usr/local/bin/garage-webui-ng` |
| `WEBUI_SERVICE` | `garage-webui.service` |
| `WEBUI_URL` | `http://<HOST>:<PORT><BASE_PATH>` from the service's environment |
| `WEBUI_DB` | `DB_PATH` from the service's environment |
| `WEBUI_REPO` | `t1nk333r/garage-webui-ng` |
| `WEBUI_PUBKEY` | the release key from `backend/release_key.go` |
| `BACKUP_DIR` | `/root/upgrade-backups` |
| `KEEP_BACKUPS` | `3` per component |
| `CORE_HEALTH_TIMEOUT` / `WEBUI_HEALTH_TIMEOUT` | `90` / `45` seconds |

Without an admin token the bucket/key and node-version checks are skipped
(with a warning); the health check still runs. The token is only ever written
to a mode-0600 header file for `curl`, never to a command line or the output.

## Building the web UI from this checkout

`garage-update-remote gui --build [REF]` checks out `REF` (default `HEAD`) in a
temporary worktree — so uncommitted changes are **not** included — runs
`pnpm install --frozen-lockfile` and `pnpm run build`, embeds the result, and
compiles with the Go toolchain pinned in the `Dockerfile` for the target's
architecture. It copies the binary over and installs it with
`garage-update gui --file … --sha256 …`, so the transfer is checked too. The
version is `git describe` of `REF`, which compares as newer than the release
it builds on.

## Rehearsing safely

Everything that talks to systemd goes through `SYSTEMCTL` and `JOURNALCTL`.
Point a config at user units and throwaway paths, and the whole flow —
including the rollbacks — can be exercised without touching a real
deployment:

```sh
SYSTEMCTL="systemctl --user"
JOURNALCTL="journalctl --user"
GARAGE_SERVICE=test-garage.service   # ...plus GARAGE_BIN, GARAGE_CONFIG, WEBUI_*,
BACKUP_DIR=$HOME/rehearsal/backups   # LOCK_FILE pointing at your test copies
```

and run with `GARAGE_UPDATE_CONF=/path/to/that.conf garage-update …`.

## Limits

- One host at a time. On a multi-node cluster, run it on one node, let the
  cluster settle, then the next: it checks cluster health but does not
  orchestrate a rolling upgrade.
- Garage downloads are trusted on HTTPS plus size and self-reported version
  (see above).
- It updates an existing, working install; it does not install from scratch.

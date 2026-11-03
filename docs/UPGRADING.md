# Upgrading

Migration notes for specific releases, newest first. When a later release
breaks something, its section goes above the previous one, and the older
sections stay as they were written.

---

## Upgrading to the persistent user store

This release moves user accounts out of environment variables and into a SQLite
database that the app owns. **It is a breaking change for every existing
deployment.** Allow ten minutes, and read the three breaking changes before you
pull the new image.

The full reference is [`authentication.md`](authentication.md).

### Breaking changes

1. **Authentication is mandatory.** The open (no-auth) mode is gone. A
   deployment with no accounts serves only the first-run `/setup` wizard until
   someone creates an administrator. There is no opt-out.
2. **A persistent volume is required.** Accounts live in a SQLite file at
   `DB_PATH` (`/data/garage-webui-ng.db` in the image). Without a volume mounted
   at `/data`, every account you create is lost the next time the container is
   recreated.
3. **`AUTH_USER_PASS` and `AUTH_VIEWER_USER_PASS` are import-only.** The server
   reads them once, at the first start against an empty database, and ignores
   them after that. Editing them later does nothing, because the database is
   authoritative. Manage users in **Settings → Users** instead.

Nothing else changes. Your `garage.toml`, `API_BASE_URL`, `S3_ENDPOINT_URL`,
`BASE_PATH` and every other setting behave as before, and the upgrade does not
touch any data in Garage.

### Before you start

Check which accounts `AUTH_USER_PASS` holds. After the upgrade you sign in with
the same usernames and passwords, because the hashes are copied verbatim.

---

### Path A. You already use `AUTH_USER_PASS`

Your accounts are imported automatically. Keep the variables set for this one
start, then remove them.

**1. Add the volume.** In `docker-compose.yml`:

```yaml
services:
  webui:
    image: ghcr.io/t1nk333r/garage-webui-ng:latest
    volumes:
      - ./garage.toml:/etc/garage.toml:ro
      # The user database. Without this, every container recreation wipes
      # the accounts and the setup wizard starts over.
      - webui_data:/data

volumes:
  webui_data:
```

For `docker run`, add `-v garage_webui_data:/data` instead.

**2. Pull and start the new image** with `AUTH_USER_PASS` still set:

```bash
docker compose pull webui
docker compose up -d webui
```

**3. Confirm the import** in the logs:

```bash
docker compose logs webui | grep -E 'User database|imported'
```

Look for both of these lines:

```
User database: /data/garage-webui-ng.db
Initial administrator imported from AUTH_USER_PASS (1 user(s)).
```

The count includes any `AUTH_VIEWER_USER_PASS` accounts, which get the
`viewer` role. The import skips entries whose password is not a bcrypt hash
(`$2a$`, `$2b$` or `$2y$`) and logs a line naming the user.

If you see the `User database:` line but no `imported` line, the database was
not empty. The import already happened on an earlier start, which is expected
on every restart after the first.

**4. Log in** with your existing username and password, and open
**Settings → Users**. Your accounts should be listed with their roles.

**5. Remove the variables.** Delete `AUTH_USER_PASS` and
`AUTH_VIEWER_USER_PASS` from your compose file, unit or `.env`, and recreate
the container. The server no longer reads them.

> ### Keeping the variables and running without a volume
>
> If you leave `AUTH_USER_PASS` set **and** never mount `/data`, every
> container recreation starts from an empty database and silently re-imports
> the legacy accounts. **Every user you created in the UI is discarded**, along
> with every password change, role change and disable.
>
> You can still log in with the credentials from the environment afterwards,
> so everything looks fine and the missing volume goes unnoticed. Mount the
> volume, then remove the variables, and neither half of the problem remains.

---

### Path B. You ran with no authentication

There is nothing to import, so the new instance starts empty.

1. **Add the volume**, as in step 1 of Path A.
2. Pull and start the new image.
3. Open the UI. Every route redirects to `/setup`, and the startup log says
   the same:
   ```
   No users configured. Open http://0.0.0.0:3909/setup to create the first administrator.
   ```
4. Create the administrator. The username takes 1 to 64 characters from
   `A-Z a-z 0-9 . _ @ -`, and the password needs at least 10 characters.
   Finishing the wizard signs you in.
5. Add any further accounts in **Settings → Users**. Use the `viewer` role for
   read-only access.

The wizard closes for good once that first account exists. From then on
`POST /api/setup` answers `409`.

There is no way to keep the old open mode. If the UI was reachable only because
it sat on a trusted network, keep that network isolation. It is now defence in
depth instead of the only control.

---

### Path C. Binary under systemd (LXC, VM, bare metal)

Paths A and B assume Docker. If you run the binary directly, usually inside an
LXC container next to Garage, the account migration works the same way. Two
problems come up, though, that Docker users never see.

> #### `ExecStart` still points at the old binary
>
> The binary is now named `garage-webui-ng`, not `garage-webui`. If you install
> the new one **next to** the old one and restart the service, nothing
> changes. systemd keeps launching the old path, which ignores `DB_PATH` and
> every other new setting. The service starts cleanly and looks healthy, so
> this is easy to miss. Update `ExecStart`.

> #### The default `DB_PATH` is relative
>
> `DB_PATH` defaults to `./data/garage-webui-ng.db`, relative to the process's
> working directory. Under systemd that directory is `/` unless you set
> `WorkingDirectory=`. A service that runs as a dedicated user cannot create
> `/data` there, so it **fails fast** with `cannot open user database`. A
> service that runs as root succeeds and puts the database at
> `/data/garage-webui-ng.db`. Always set an absolute `DB_PATH` in the unit.

**1. Note your current credentials.** You sign in with the same ones afterwards.

```bash
sudo grep -rE 'AUTH_USER_PASS|AUTH_VIEWER_USER_PASS' \
  /etc/systemd/system/garage-webui.service /etc/garage-webui.env 2>/dev/null
```

**2. Install the new binary.** Releases publish `linux-amd64` and `linux-arm64`
builds. To check your architecture, run `uname -m`. It prints `x86_64` for
amd64 and `aarch64` for arm64.

```bash
ARCH=amd64   # or arm64
curl -fsSL -o /tmp/garage-webui-ng \
  "https://github.com/t1nk333r/garage-webui-ng/releases/latest/download/garage-webui-ng-linux-${ARCH}"
sudo install -m755 /tmp/garage-webui-ng /usr/local/bin/garage-webui-ng
```

**3. Create the database directory.** If the unit has a `User=`, chown the
directory to that account. A unit with no `User=` runs as root and needs no
chown.

```bash
sudo mkdir -p /var/lib/garage-webui-ng
# only if the service runs as a dedicated user:
# sudo chown garage-webui:garage-webui /var/lib/garage-webui-ng
```

**4. Update the unit** with `sudo systemctl edit --full garage-webui`. Change
`ExecStart` to the new binary and add an absolute `DB_PATH`. Keep
`AUTH_USER_PASS` set **for this one start**, because it is what migrates your
accounts.

```ini
[Unit]
Description=Garage WebUI-NG
After=network.target garage.service

[Service]
Environment="PORT=3909"
Environment="CONFIG_PATH=/etc/garage.toml"
Environment="S3_ENDPOINT_URL=http://127.0.0.1:3900"
Environment="S3_REGION=garage"
# Absolute, and on persistent storage. Do not rely on the relative default.
Environment="DB_PATH=/var/lib/garage-webui-ng/users.db"
# AUTH_USER_PASS lives here and is import-only from this release on. Remove it
# after you have confirmed the import (step 7).
EnvironmentFile=/etc/garage-webui.env
ExecStart=/usr/local/bin/garage-webui-ng
Restart=always

[Install]
WantedBy=default.target
```

**5. Reload and restart.**

```bash
sudo systemctl daemon-reload && sudo systemctl restart garage-webui
```

**6. Confirm you are on the new binary.**

```bash
journalctl -u garage-webui -n 30 --no-pager | grep -E 'User database|imported|No users configured'
```

```
User database: /var/lib/garage-webui-ng/users.db
Initial administrator imported from AUTH_USER_PASS (1 user(s)).
```

The `User database:` line is the reliable sign, because **the old binary never
logs it**. If the line is missing, `ExecStart` still points at the old path, as
described in the first warning above.

**7. Log in** with your existing credentials and check **Settings → Users**.
Then remove `AUTH_USER_PASS` and `AUTH_VIEWER_USER_PASS` from
`/etc/garage-webui.env` and restart. The server no longer reads them.

To roll back, point `ExecStart` back at the old binary and keep the
environment variables set. Keep the old binary on disk until you are confident
in the upgrade. The old release reads the variables live and never touches the
database file, so the two can sit side by side.

#### Troubleshooting (systemd-specific)

| Symptom | Cause | Fix |
|---|---|---|
| The service restarts without errors but nothing changed, with no `/setup` and no new UI | `ExecStart` still names the old binary | Point it at `garage-webui-ng`, run `daemon-reload`, and restart |
| `cannot open user database at ./data/garage-webui-ng.db: …`, then the process exits | `DB_PATH` is not set, so the relative default resolves against `/` | Set an absolute `Environment="DB_PATH=…"` |
| `cannot open user database … permission denied` | The `User=` account cannot write to the directory | `chown` the directory to that user |
| Accounts vanish after a host rebuild | `DB_PATH` points somewhere temporary, such as `/tmp` or a tmpfs | Move it under `/var/lib` |

**Keeping a systemd install up to date.** Once this layout is in place,
[`contrib/garage-update`](../contrib/garage-update/README.md) updates it, and
Garage too, with one command. It verifies the new binary before stopping
anything, backs up the binary and its data, checks that the new version is
healthy, and rolls back automatically if it does not come up.

---

### Verifying the migration

```bash
# 1. The database is where you expect it, on the volume.
docker compose logs webui | grep 'User database:'
#    Expected: User database: /data/garage-webui-ng.db

# 2. The instance is set up, so needsSetup must be false.
curl -s http://localhost:3909/api/auth/status
#    Expected: {"authenticated":false,"enabled":true,"needsSetup":false,"role":"","username":""}

# 3. /data is a real volume.
docker inspect -f '{{ range .Mounts }}{{ .Destination }} {{ end }}' garage-webui-ng
#    Expected: /etc/garage.toml /data
```

Then, in the UI, **Settings → Users** lists every account with its role,
status, last login and creation date. That table is the authoritative view. If
an account you expected is missing, it was never imported.

The last check is the one that proves the accounts persist:

```bash
docker compose up -d --force-recreate webui
```

Log back in. Your users should still be there. If they are not, the volume is
not mounted where you think it is.

---

### Rollback

Each release leaves the other's account storage alone. The new release never
writes to the environment variables, and the old release never reads the
database.

1. Pin the previous image tag (`ghcr.io/t1nk333r/garage-webui-ng:<old-tag>`)
   and recreate the container.
2. The old release reads `AUTH_USER_PASS` live, so **keep those variables set
   until you are confident in the upgrade**. That is the only reason to delay
   step 5 of Path A.
3. Accounts created in the UI after the upgrade do **not** exist for the old
   release. They stay in the database file, untouched, and reappear if you
   upgrade again. The volume can stay mounted either way.

---

### Reference compose snippet

```yaml
name: garage-webui-ng

services:
  webui:
    image: ghcr.io/t1nk333r/garage-webui-ng:latest
    container_name: garage-webui-ng
    restart: unless-stopped
    volumes:
      - ./garage.toml:/etc/garage.toml:ro
      - webui_data:/data          # Required. Holds the user database.
    ports:
      - "3909:3909"
    environment:
      API_BASE_URL: http://garage:3903
      S3_ENDPOINT_URL: http://garage:3900
      # Set this whenever TLS is terminated in front of the UI.
      SESSION_COOKIE_SECURE: "true"
      # AUTH_USER_PASS / AUTH_VIEWER_USER_PASS: import-only. Set them for the
      # first start of an upgraded deployment, then delete them.
    healthcheck:
      test: ["CMD", "/main", "-health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  webui_data:
```

A bind-mounted host directory works in place of the named volume, but the
container runs as uid and gid 65532, so chown the directory first:

```bash
mkdir -p ./webui-data && sudo chown 65532:65532 ./webui-data
```

Otherwise startup fails fast with `cannot open user database`.

---

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `cannot open user database … permission denied`, and the process exits | `/data` is a bind mount that uid 65532 cannot write to | `chown 65532:65532` the host directory, or use a named volume |
| The setup wizard appears even though `AUTH_USER_PASS` is set | The import skipped the entry, because its hash is not `$2a$`, `$2b$` or `$2y$`, or because the entry is malformed | Look for `Skipping legacy user` in the logs. Fix the value, or create the account in the wizard. |
| Users vanish after every deploy | No volume is mounted at `/data` | Mount one, as shown above |
| Changing `AUTH_USER_PASS` has no effect | This is by design. The variable is import-only. | Change the password in **Settings → Account**, or reset it from **Settings → Users** |
| Signed out after every restart | This is by design. Sessions are stored in memory. | Log back in. Accounts are unaffected. |
| `403 invalid or missing CSRF token` from a script | Every write except login and setup needs the double-submit token | Send a `GET` first, keep the `csrf_token` cookie, and send its value in the `X-CSRF-Token` header |
| Locked out of every admin account | No admin credential remains | Recover without losing data. On the host, run `garage-webui-ng -reset-password <user>` or `-create-admin <user>`. In Docker, run `docker compose exec webui /main -reset-password <user>`. Deleting the database is the last resort; see [`authentication.md` §9](authentication.md#9-lockout--recovery). |
| `error loading dynamically imported module` right after an upgrade | A tab, or a caching proxy, holds the previous `index.html`, which names chunk files the new build no longer has | Hard-reload with `Cmd/Ctrl+Shift+R`. The app now reloads itself once automatically. If a proxy caches `index.html`, configure it to honour `Cache-Control: no-cache`. |

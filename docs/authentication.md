# Authentication

This is the reference for how Garage WebUI-NG signs users in and decides what
each of them may do. The README links here instead of repeating it.

Upgrading an existing deployment? Read [`UPGRADING.md`](UPGRADING.md) first.

---

## 1. Overview

- Users live in a small SQLite database that the app owns, and you manage them
  from the UI. They are not configuration.
- Authentication is mandatory. There is no open (no-auth) mode. Every API route
  requires a session except the ones listed under
  [Public endpoints](#61-public-endpoints).
- Nothing needs editing after the first start. Creating, renaming, disabling or
  deleting an account, or changing its role, never involves an environment
  variable, a config file or a restart.
- Passwords are hashed with bcrypt at cost 10. No endpoint ever returns a
  password or a password hash. [§6.5](#65-no-endpoint-returns-a-password)
  explains how the code enforces that.

The database is the only state this service owns. Everything else the UI shows
is read live from your Garage cluster.

---

## 2. The first-run setup wizard

A deployment with zero users has not been set up. In that state:

- `GET /api/auth/status` and `GET /api/setup/status` both report
  `needsSetup: true`.
- The single-page app redirects every route, including `/auth/login`, to
  `/setup`.
- The server logs this line at startup:
  `No users configured. Open http://<host>:<port>/setup to create the first administrator.`
  When `BASE_PATH` is set, the URL includes that prefix.

The wizard asks for a username and a password, with the password entered
twice. It creates one account, always with the `admin` role.

Finishing the wizard signs you in. The server issues a new session token and
records your identity, so you land in the app instead of on a login form.

After that the wizard is closed for good. Once any user exists,
`POST /api/setup` refuses with 409 Conflict and the message
`setup has already been completed`. The check runs inside the same database
transaction as the insert, so two concurrent requests cannot both succeed.
Deleting every user is not a supported way to reopen the wizard; see
[Lockout and recovery](#9-lockout--recovery).

### Validation rules

| Field | Rule |
|---|---|
| Username | 1 to 64 characters, using only `A-Z a-z 0-9 . _ @ -`. Uniqueness ignores case, so `Admin` and `admin` are the same account. |
| Password | At least 10 bytes, which is 10 characters of plain ASCII, and at most 72 bytes. It may not be entirely whitespace. bcrypt ignores everything past 72 bytes, so the server rejects a longer password instead of silently truncating it. |

The setup form checks part of this before it submits: a non-empty username, a
password of at least 10 characters, and two matching password fields. The
server checks every rule itself, and its answer is the one that counts.

---

## 3. Database & persistence

| Setting | Value |
|---|---|
| Env var | `DB_PATH` |
| Default in the Docker image | `/data/garage-webui-ng.db` |
| Default elsewhere (binary, `go run`) | `./data/garage-webui-ng.db`, relative to the working directory |
| Driver | `modernc.org/sqlite`, pure Go, no cgo |
| Journal mode | WAL, so `-wal` and `-shm` sidecar files sit next to the database |

**A persistent volume is required.** Losing the file loses every account and
sends the instance back to the setup wizard. For that reason the container
declares `VOLUME ["/data"]`, and the Compose stack mounts a named volume,
`webui_data`, at that path.

The runtime image is distroless `nonroot`. The process runs as uid and gid
65532, and the image ships a `/data` directory already owned by that uid.
Docker seeds a new named volume from the image directory, so the volume
inherits that ownership and the process can create its database. If you
bind-mount a host directory instead, **chown it to `65532:65532` yourself**.
Otherwise startup fails with `cannot open user database`.

Startup is fail-fast. If the database cannot be opened or migrated, the process
exits instead of serving a UI that could only return errors. After a successful
start it logs the path it used:

```
User database: /data/garage-webui-ng.db
```

---

## 4. Schema

The schema is one table plus a version counter. Migrations are append-only.
Each entry is one schema version, and its index plus one is the number recorded
in `schema_migrations`. A shipped entry is never edited, reordered or removed.
The counter is the only record of what a live database already has, so an
edited entry would never be applied to existing installs. Each migration runs
in one transaction together with its version bump, so a failure cannot leave a
half-applied version behind.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);

-- migration 1
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'admin',
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login    TIMESTAMP
);
```

Notes:

- `COLLATE NOCASE` on `username` makes the unique index ignore case. Operators
  expect that from a login name, and it blocks look-alike duplicates.
- `updated_at` records administrative changes to the account. A successful
  sign-in sets only `last_login` and leaves `updated_at` alone.
- A disabled account keeps its row and its history, but it cannot sign in.
- The connection pool is capped at one connection. SQLite allows only one
  writer at a time, and this database holds a handful of rows. Sending every
  statement through one connection costs nothing and means a "database is
  locked" error cannot happen.

---

## 5. Roles

There are two roles, `admin` and `viewer`.

### `admin`

Full access. An admin can do everything a viewer can, make every write, and
manage users under `/api/admin/*`.

### `viewer`

Read-only. The role is defined by an allowlist, not a denylist. A request the
rules below do not allow is denied.

- Everything under `/api/admin/` is denied, whatever the method. That includes
  reads, because the list of accounts, their roles and their sign-in times are
  not for viewers to see.
- Every other `GET` is allowed, with one exception. `GET /api/v2/GetKeyInfo`
  with `showSecretKey=true` is denied, so a viewer can never reveal a secret
  access key.
- Exactly three writes are allowed, each as an exact path match, not a prefix.
  `POST /api/auth/logout` and `POST /api/auth/change-password` act only on the
  caller's own session and account. `POST /api/browse/download-token` mints a
  short-lived token for a multi-object ZIP download. It is a `POST` only
  because the list of selected keys is too long for a URL, and it changes
  nothing, so a read-only viewer may call it.
- Every other request, including any other `POST`, `PUT`, `PATCH` or `DELETE`,
  is denied with 403 `forbidden: read-only session`.

A denied write still appears in the audit log, with its 403 status. The audit
log records only writes, so a denied `GET` leaves no entry there.

The administration API has two independent guards. The middleware refuses
`/admin/` to a viewer, and every `/admin/*` handler also calls `requireAdmin`
before doing anything. A routing mistake alone therefore cannot expose those
endpoints. Keep both.

---

## 6. API reference

All paths are relative to the server root and are served under `/api`,
prefixed by `BASE_PATH` when that is set. Successful responses are JSON. Error
responses carry a plain-text message body and the status code listed below.

### 6.1 Public endpoints

Exactly three routes are reachable without a session. The list uses exact
matches, never prefixes, and it is a security boundary.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/status` | Session state, and whether setup is still needed. |
| `GET` | `/api/setup/status` | Whether setup is still needed. |
| `POST` | `/api/setup` | Create the first administrator, only while there are none. |

`POST /api/auth/login` is registered ahead of the middleware chain, so it is
also reachable without a session.

### 6.2 Setup

| `GET /api/setup/status` | |
|---|---|
| Auth | none |
| Request | no body |
| Success | `200` with `{"needsSetup": true}` |
| Errors | `500` when the user count could not be read. While startup is still in progress the answer is `{"needsSetup": true}`. That answer does not decide whether an account can be created; the wizard's own guard does. |

| `POST /api/setup` | |
|---|---|
| Auth | none, but succeeds only while the users table is empty |
| CSRF | exempt |
| Request | `{"username": "...", "password": "...", "confirmPassword": "..."}` |
| Success | `200` with `{"authenticated": true, "username": "...", "role": "admin"}`, and the caller is signed in |
| `400` | `invalid request body`, `passwords do not match`, or a validation message (`password is not acceptable: …`, `invalid username: …`, `"x": username is already taken`) |
| `409` | `setup has already been completed`. The instance already has a user, and the wizard is closed for good. |
| `429` | `too many setup attempts, try again later` |
| `500` | the store is unavailable, or the account could not be created |

### 6.3 Session

| `POST /api/auth/login` | |
|---|---|
| Auth | none |
| CSRF | exempt |
| Request | `{"username": "...", "password": "..."}` |
| Success | `200` with `{"authenticated": true, "username": "...", "role": "admin"\|"viewer"}` |
| `401` | `invalid username or password`. The same response covers an unknown user, a disabled account and a wrong password. An unknown or disabled account still costs a bcrypt comparison, so the response time matches as well. |
| `429` | `too many login attempts, try again later` |
| `500` | a body that is not valid JSON or is larger than 1 MiB (the response carries the JSON decoder's own message), the store is unavailable, or the session could not be started |

The response reports the username as stored, not as typed. Logins ignore case,
and the session and the audit log should show one canonical form. Login renews
the session token before it records the identity, so a session ID planted
before authentication cannot become an authenticated one.

| `POST /api/auth/logout` | |
|---|---|
| Auth | any authenticated session, including `viewer` |
| CSRF | required |
| Request | no body |
| Success | `200` with `true` |
| Errors | `401` when unauthenticated, `403` when the CSRF token is missing or invalid |

| `GET /api/auth/status` | |
|---|---|
| Auth | none |
| Success | `200` with `{"enabled": true, "authenticated": bool, "username": "...", "role": "...", "needsSetup": bool}` |
| Errors | `500` when the user count could not be read |

`enabled` is always `true`, because authentication is mandatory. The field
stays because the frontend still reads it. On an unauthenticated session,
`username` and `role` are empty strings. The endpoint reveals nothing beyond
the caller's own session state and whether a first account is still needed.

| `POST /api/auth/change-password` | |
|---|---|
| Auth | any authenticated session, including `viewer` |
| CSRF | required |
| Request | `{"currentPassword": "...", "newPassword": "...", "confirmPassword": "..."}` |
| Success | `200` with `true` |
| `400` | `invalid request body`, `passwords do not match`, `the new password must differ from the current one`, or `password is not acceptable: …` |
| `401` | no session, a session whose account no longer exists or has been disabled, or `current password is incorrect` |
| `403` | the CSRF token is missing or invalid |
| `429` | `too many attempts, try again later` |
| `500` | the store is unavailable, or the password could not be stored |

The body carries no user id. The endpoint always acts on the account the
session names, so it cannot target another account. Checking the current
password is a password guess like any other, so this endpoint has its own rate
limit, keyed on the account; [Rate limiting](#rate-limiting) has the details.
The limit is checked before the password comparison. Otherwise a stolen
session could test guesses at the account's password with no limit. A
successful change renews the session token and keeps the caller signed in.

### 6.4 User administration

Every route below requires an `admin` session, and every write also requires a
valid CSRF token. A viewer gets `403 forbidden: read-only session` from the
middleware. Any other caller that reaches a handler without the admin role
gets `403 forbidden: administrator role required`.

A user object looks like this:

```json
{
  "id": 1,
  "username": "alice",
  "role": "admin",
  "disabled": false,
  "createdAt": "2026-08-04T09:15:00Z",
  "updatedAt": "2026-08-04T09:15:00Z",
  "lastLogin": "2026-08-04T10:02:11Z"
}
```

`lastLogin` is `null` for an account that has never signed in. The object has
no password field of any kind.

| `GET /api/admin/users` | |
|---|---|
| Request | no body |
| Success | `200` with an array of user objects, ordered by username |
| Errors | `401`, `403`, `500` |

| `POST /api/admin/users` | |
|---|---|
| CSRF | required |
| Request | `{"username": "...", "password": "...", "role": "admin"\|"viewer"}` |
| Success | `200` with the created user object |
| `400` | `invalid request body`, `invalid role: …`, `invalid username: …`, `password is not acceptable: …` |
| `409` | `"x": username is already taken` |
| Errors | `401`, `403`, `500` |

| `PATCH /api/admin/users/{id}` | |
|---|---|
| CSRF | required |
| Request | any subset of `{"username": "...", "role": "...", "disabled": bool}`. The fields are optional pointers, so an absent field differs from an empty one. `{}` changes nothing, and `{"username": ""}` is a rename that gets rejected. |
| Success | `200` with the updated user object |
| `400` | `invalid user id`, `invalid request body`, `invalid role: …`, `invalid username: …` |
| `404` | `user not found` |
| `409` | `"x": username is already taken`, or a lockout guard (see [§7](#7-lockout-guards)) |
| Errors | `401`, `403`, `500` |

| `DELETE /api/admin/users/{id}` | |
|---|---|
| CSRF | required |
| Request | no body |
| Success | `200` with `true` |
| `400` | `invalid user id` |
| `404` | `user not found` |
| `409` | a lockout guard (see [§7](#7-lockout-guards)) |
| Errors | `401`, `403`, `500` |

| `POST /api/admin/users/{id}/reset-password` | |
|---|---|
| CSRF | required |
| Request | `{"newPassword": "..."}` |
| Success | `200` with `true` |
| `400` | `invalid user id`, `invalid request body`, `password is not acceptable: …` |
| `404` | `user not found` |
| Errors | `401`, `403`, `500` |

An administrator who resets another account's password does not need the old
one. This is how an admin recovers a colleague who is locked out. A reset does
not end the target's existing sessions, because the server does not check
sessions against the password hash. To cut a session off, disable, delete or
demote the account instead.

The server revalidates every authenticated request against the user store
instead of trusting what the session recorded at login. Disabling or deleting
an account, or changing its role, takes effect within 5 seconds. The delay
comes from a short cache in `backend/middleware/auth.go` that keeps the lookup
off the single-connection SQLite pool. Without the revalidation, a change
would wait for the session to expire, which takes up to 24 hours with the
default `SESSION_LIFETIME_HOURS`.

Renames and password resets never take away administrative access, so the
lockout guards never block them.

### 6.5 No endpoint returns a password

`store.User.PasswordHash` carries the `json:"-"` tag. That tag is the single
guarantee that a hash cannot leak through a response, and the tests check raw
response bodies to confirm that no bcrypt prefix ever appears. No handler logs
a submitted password either. The setup, change-password and user
administration handlers replace JSON decoder errors with a flat
`invalid request body`, because the decoder can quote the request body, and
the password is in the body. Login is the exception. A login body that fails
to decode gets a `500` with the decoder's own message.

---

## 7. Lockout guards

Three rules keep the instance from losing its last way to be administered. A
request that breaks one gets 409 Conflict with the message shown, and the write
does not happen. If the server cannot evaluate a rule, it fails closed with a
`500`. It never treats an admin count it could not read as "there are plenty
of admins".

| Rule | Message |
|---|---|
| An admin may not delete their own account. | `you cannot delete your own account` |
| An admin may not demote or disable their own account. This holds even when other admins exist, because a one-click accidental lockout is too easy. | `you cannot demote or disable your own account` |
| Nobody may take administration away from the last enabled admin, whether by deleting, disabling or demoting that account to viewer. | `cannot remove the last administrator: this instance would become unadministrable` |

The server takes the caller's identity from the session, never from the
request body. It compares names case-insensitively, to match the
`COLLATE NOCASE` username index.

The Users tab greys out the actions these rules would refuse. That is only a
convenience. The server answers 409 regardless, and the UI shows its message
verbatim.

---

## 8. Sessions & CSRF

### Session cookie

[`alexedwards/scs`](https://github.com/alexedwards/scs) stores sessions on the
server. The cookie carries only an opaque token.

| Property | Value |
|---|---|
| `HttpOnly` | `true`, set explicitly so that a change in the library's default cannot weaken it |
| `SameSite` | `Lax`, also set explicitly |
| `Secure` | on when `SESSION_COOKIE_SECURE=true`, off by default |
| `Path` | `/`, or `BASE_PATH` when the UI is mounted under a prefix |

`Secure` is opt-in because browsers reject `Secure` cookies over plain HTTP,
and this UI is often served over HTTP on a private network.
**Set `SESSION_COOKIE_SECURE=true` whenever TLS is terminated in front of it.**

| Env var | Default | Meaning |
|---|---|---|
| `SESSION_LIFETIME_HOURS` | `24` | Absolute limit on a session's age, counted from creation. A session in constant use still reaches it. |
| `SESSION_IDLE_TIMEOUT_HOURS` | `2` | Signs out a session that has not been used for this long. |

Both take a positive whole number of hours. A value that does not parse, or
is `<= 0`, falls back to the default. The server logs a warning when that
happens instead of silently using a different expiry.

Session data is held in memory, so restarting the process signs everyone out.
Accounts are unaffected, because they are in the database.

The server renews the session token on login, on completing setup, after a
password change and on logout. A session ID planted before a privilege change
therefore never becomes a privileged one.

### CSRF double-submit token

| Part | Value |
|---|---|
| Cookie | `csrf_token`, 32 random bytes, hex-encoded. It is deliberately not `HttpOnly`, because the frontend has to read it. It copies the session cookie's `Path`, `SameSite=Lax` and `Secure` settings. |
| Header | `X-CSRF-Token`, which must equal the cookie on every state-changing request |

The server issues the cookie to any request that arrives without one, so a new
client picks up its token on its first `GET`. `GET`, `HEAD` and `OPTIONS`
requests are never rejected. A `POST`, `PUT`, `PATCH` or `DELETE` gets 403
`invalid or missing CSRF token` unless the cookie and the header match. The
comparison runs in constant time.

Only two endpoints are exempt, each as an exact method and path match:
`POST /api/auth/login` and `POST /api/setup`. They are the only writes a caller
can make before it holds a session or a token. Both are rate-limited, and each
is guarded either by a credential or by the check that no users exist yet.
Every other write requires the token, including logout and password change.

The session cookie is already `SameSite=Lax`, and the API reads JSON request
bodies, so a cross-site form post cannot reach a write endpoint with
credentials attached. The token is defence in depth on top of those two. Do
not relax `SameSite` or add permissive CORS to accommodate it.

### Rate limiting

Three checks are rate-limited, each by its own limiter. A limiter records
every request it lets through, successful or not. It refuses the next request
for the same key with 429 while 10 recorded requests fall inside the last 60
seconds. A refused request is not recorded.

| Check | Keyed on | 429 message |
|---|---|---|
| `POST /api/auth/login` | the client address plus the username tried, lower-cased | `too many login attempts, try again later` |
| `POST /api/setup` | the client address | `too many setup attempts, try again later` |
| The current-password check in `POST /api/auth/change-password` | the username in the session | `too many attempts, try again later` |

By default the client address is the peer address (`RemoteAddr`). The server
does not trust `X-Forwarded-For` or similar headers by default, because
honouring one without knowing the proxy setup would let a client choose its
own rate-limit bucket. With that default, every client behind a reverse proxy
has the proxy's address. All clients then share one setup limit, and each
username has one login limit across all clients. Size your proxy's own rate
limiting to match.

If a proxy you control overwrites a forwarding header on every request, name
that header in `TRUSTED_PROXY_HEADER`. The app then reads the last
comma-separated entry of the last copy of that header, which is the entry the
proxy appended. A request without the header falls back to `RemoteAddr`. The
README's [environment variable table](../README.md#environment-variables)
describes the variable.

---

## 9. Lockout & recovery

Losing every administrator credential cannot be fixed from inside the app. The
setup wizard reopens only when there are zero users, and the lockout guards
exist to stop you reaching a state with no working admin.

Work through the steps below in order. Only step 3 deletes anything.

### Step 1. Another admin can still sign in

Use **Settings → Users → Reset password** on the locked-out account. The rest
of this section does not apply.

### Step 2. Recover with the command-line flags

The binary that serves the UI also has three offline recovery flags. They read
and write the SQLite database at `DB_PATH` directly, lose no data, and work
even when every password is forgotten.

| Flag | Effect |
|---|---|
| `-list-users` | Prints every account with its username, role, status, last login and creation time. It never prints a password or a hash. |
| `-reset-password <username>` | Prompts for a new password and stores it on that account. |
| `-create-admin <username>` | Prompts for a password and creates a new admin. Unlike `POST /setup`, it works when accounts already exist. |

```bash
# systemd or bare binary. Run as the service user so that the ownership of any
# new file and the database's own permissions stay correct.
sudo -u garage-webui DB_PATH=/var/lib/garage-webui-ng/garage-webui-ng.db \
  /usr/local/bin/garage-webui-ng -list-users

sudo -u garage-webui DB_PATH=/var/lib/garage-webui-ng/garage-webui-ng.db \
  /usr/local/bin/garage-webui-ng -reset-password admin

# Docker. -it is required, because without it there is no terminal to prompt on.
docker run -it --rm -v garage-webui-ng_webui_data:/data \
  --entrypoint /main ghcr.io/t1nk333r/garage-webui-ng:latest -reset-password admin

# Or run it inside the running container.
docker compose exec webui /main -list-users
```

The output looks like this, with no hash anywhere:

```
USERNAME  ROLE    STATUS  LAST LOGIN            CREATED
admin     admin   active  2026-08-04 09:12:44Z  2026-06-01 10:02:11Z
reader    viewer  active  -                     2026-06-01 10:04:02Z
```

How these commands behave:

- They are process flags, not HTTP endpoints, and will not become endpoints. A
  password reset reachable over the network without authentication would be a
  backdoor. The flags need local read and write access to `DB_PATH`, and anyone
  with that access could already edit the database file by hand, so they grant
  nothing new.
- The password is never a command-line argument. The command prompts for it
  twice with terminal echo turned off, so it never reaches your shell history,
  `ps` output or process accounting. For scripted recovery, the command accepts
  a single line on stdin instead
  (`printf '%s\n' "$NEW" | … -reset-password admin`) and skips the
  confirmation prompt. If you do that, check your shell history settings.
- They enforce the same password policy as the UI, described in
  [§2](#validation-rules), because they call the same validation code.
- You do not need to stop the service. WAL mode and a busy timeout make the
  concurrent write safe. The server reads credentials at each login instead of
  caching them, so a reset takes effect at the next sign-in. Stopping the
  service anyway is the cautious choice and costs nothing.
- Existing sessions stay signed in. Sessions live in memory
  ([§8](#8-sessions--csrf)), and a password change, from the CLI or the UI,
  does not end a session that already exists.
- They run schema migrations, as the server does. Pointing them at an old
  backup copy upgrades that copy.

### Step 3. Reset the database (last resort)

Use this only if you cannot run the commands in step 2.

1. Stop the container or process.
2. Remove the database from the volume. That means the file at `DB_PATH` and
   its WAL sidecar files:
   ```bash
   docker compose stop webui
   docker run --rm -v garage-webui-ng_webui_data:/data busybox \
     sh -c 'rm -f /data/garage-webui-ng.db /data/garage-webui-ng.db-wal /data/garage-webui-ng.db-shm'
   docker compose start webui
   ```
   Adjust the volume name to match your stack. `docker volume ls` shows it.
3. Reopen the UI. `needsSetup` is `true` again, and the wizard asks for a new
   administrator.

> **This deletes every account**, including viewers, along with their creation
> and last-login history. Nothing else is affected. Buckets, keys and objects
> live in Garage, not in this database.

---

## 10. Legacy import (`AUTH_USER_PASS`)

Releases from before the user database read accounts from `AUTH_USER_PASS` and
`AUTH_VIEWER_USER_PASS` on every request. Those variables are now import-only,
kept so that an existing deployment survives the upgrade. Each also has a
`_FILE` variant, `AUTH_USER_PASS_FILE` and `AUTH_VIEWER_USER_PASS_FILE`, that
names a file holding the value. The `_FILE` variant wins over the plain
variable. The README's environment variable table lists all four.

- The server reads them once, at startup, and only when the users table is
  empty. After that the database is authoritative and the server never reads
  the variables again, so editing them has no effect.
- The format is unchanged: comma-separated `username:bcrypt-hash` entries.
  Within an entry the first `:` separates the two, since bcrypt hashes contain
  neither `:` nor `,`. The import skips malformed entries.
- Only `$2a$`, `$2b$` and `$2y$` hashes are accepted. The import skips anything
  else and logs a line that names the user, never the hash.
- Hashes are stored verbatim. Re-hashing them would lock every existing
  operator out.
- Admins are imported before viewers, so a name present in both variables
  becomes an admin and its viewer entry is dropped.
- Legacy usernames are not checked against the current username rules, so an
  existing login keeps working even if the app would no longer accept that
  name for a new account.
- After a successful import the server logs:
  `Initial administrator imported from AUTH_USER_PASS (N user(s)).`

Once you have signed in, remove the variables from your compose file or unit.
[`UPGRADING.md`](UPGRADING.md) explains the one trap to avoid, which is keeping
them while running without a volume.

---

## 11. Not implemented (future extension points)

None of the following exists today. They are listed so that the current schema
and API read as deliberate choices.

- **Fine-grained RBAC.** The `role` column holds one of two strings. Richer
  role-based access control would add `roles` and `permissions` tables and a
  join, and leave `users` otherwise unchanged. The two current values would
  become seeded rows.
- **MFA or TOTP.** Multi-factor sign-in with time-based one-time passwords
  would add a per-user secret and recovery codes in a new migration, plus a
  second step in the login handler between password verification and
  `Session.Renew`.
- **OAuth, OIDC and LDAP.** Each would map an external identity onto a local
  user row. The local account would still be what roles apply to, so roles, the
  audit log and the lockout guards keep working unchanged. `password_hash`
  would become optional for accounts that sign in elsewhere.
- **Session revocation across restarts.** Sessions are stored in memory today.
  Storing them on disk would also make "sign out everywhere" possible.

---

## See also

- [`UPGRADING.md`](UPGRADING.md) covers migrating an existing deployment.
- [`../README.md`](../README.md) covers installation, configuration and the
  security summary.
- [`../CLAUDE.md`](../CLAUDE.md) is the architecture reference.

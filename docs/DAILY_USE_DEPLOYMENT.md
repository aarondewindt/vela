# Experimental daily-use deployment

Vela and PostgreSQL run on the Ubuntu desktop, inside the existing dev container.
The Pi keeps Caddy, cloudflared, Pi-hole and Home Assistant. Vela uses its own
Better Auth login; there is no Cloudflare Access application for this hostname.

```text
https://vela.aarondewindt.space
  → existing remotely managed Cloudflare Tunnel
  → cloudflared on the Pi
  → http://192.168.0.106:3001 on the desktop
  → next start in the dev container
  → existing PostgreSQL database
```

The inspected desktop endpoint was `192.168.0.106:3000`: it answered the current
Vela development server. Inside the container, `172.18.0.2` is a Docker address,
not the desktop's LAN address. Reserve `192.168.0.106` for the desktop in DHCP,
or recheck its address on the desktop with `ip -4 address` before creating the
route. The Pi's `172.23.0.0/24` edge network is not the origin address.

## LAN development access

Compose publishes development port 3000 on the desktop network interfaces;
`yarn dev` listens on `0.0.0.0` inside the container. Open
`http://<desktop-LAN-IP>:3000` from another LAN device. In `vela.env`, add that
full origin to `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated), for example
`BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.0.106:3000`. Next.js also uses the
hostnames from this setting for development asset requests. Keep
`NEXT_PUBLIC_BETTER_AUTH_URL` unset to let browser auth requests use the current
origin.

After changing Compose port mappings or `vela.env`, run **Dev Containers: Rebuild
Container** in VS Code, then restart `yarn dev`. A server restart alone does not
update Docker's port publication. If LAN access still times out, check the
desktop firewall allows TCP 3000 from the LAN and that the devices are not on an
isolated guest network. Keep this development port off public tunnels.

## Why a second command in the same container

The actual command is `yarn dev` (`yard` is not installed). It runs Next.js 16.2.9
in development mode, including error overlays, source maps, HMR and editor/debug
endpoints. Vela's session checks do not protect Next's development machinery;
`allowedDevOrigins` is an origin policy, not login enforcement. Do not publish
this port through the tunnel. See [Next's CLI](https://nextjs.org/docs/app/api-reference/cli/next)
and [development origin configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).

`yarn public:build` and `yarn public:start` use the same checkout, dependencies,
container and database, but serve an optimized build from `.next-public` on
`0.0.0.0:3001`. The local development output stays in `.next`. No separate
production database, app container, release workflow or Caddy route is introduced.
Development edits require rebuilding/restarting the public process to appear there.
Do not rebuild `.next-public` while it is being served: stop public:start first.

## First setup

1. **Back up before rebuilding the dev container.** From the existing container:

   ```bash
   yarn db:backup
   ```

   This saves a private custom-format dump to `.local/backups` in the desktop's
   bind-mounted checkout. Copy the dump off the desktop too; it contains private
   data, password hashes and sessions. The implementation was restore-tested into
   a new database, without replacing the running database.

2. Review `vela.env`: keep the existing `DATABASE_URL` and strong
   `BETTER_AUTH_SECRET`. The secret must be non-placeholder and at least 32
   characters. Keep it stable across rebuilds; changing it invalidates sessions.
   If it ever needs replacing, generate a value with `openssl rand -hex 32` and
   save it privately. Never put secrets in a `NEXT_PUBLIC_*` variable.

3. Rebuild/reopen the dev container so Docker applies the changed outer mappings.
   Keep the workspace path and dev-container identity stable. Do not delete volumes.
   From an Ubuntu desktop terminal, verify the outer container:

   ```bash
   docker ps --format 'table {{.Names}}\t{{.Ports}}'
   ```

   Expected: desktop `3001 → container 3001`, desktop **127.0.0.1:3000** and
   **127.0.0.1:5050** only. Port `5432` is not published by the outer container.
   VS Code port forwarding is for desktop access; it does not provide Pi access.
   Inside the dev container, PostgreSQL publishes to `127.0.0.1:5432`; pgAdmin's
   inner `5050` listener is reached through the outer desktop-loopback mapping.

4. Create your separate personal account **locally, before publishing the route**.
   Stop any existing `yarn dev` process, then start it with the one allowed address:

   ```bash
   VELA_SIGNUP_EMAILS='your-real-email@example.com' yarn dev
   ```

   On the desktop open `http://localhost:3000/sign-up` and register. This uses the
   existing database. Stop that process, then restart with plain `yarn dev` if
   wanted. The local default still permits the existing test-email domain; the
   public server ignores that default and closes registration unless explicitly
   allowlisted. An allowlisted email is **not email verification**; create the
   account locally so someone else cannot claim it first. No email provider or
   password recovery flow is configured. Keep the password in your password manager.

5. From the container, build and launch the public server:

   ```bash
   yarn public:build
   yarn public:start
   ```

   Leave it running in a terminal. The wrapper reads `vela.env`, existing process
   variables, then optional `.env.public.local` overrides, and forces production
   mode, `VELA_PUBLIC_MODE=true`, the public origin, and same-origin browser auth.
   No public env file is required. Registration is closed by default; if you
   previously set `VELA_SIGNUP_EMAILS` in the container environment, override it
   with an empty `VELA_SIGNUP_EMAILS=` in `.env.public.local`.
   The wrapper does not migrate, reset, seed or rebuild the database.

6. Test from the Pi **before** adding the tunnel route:

   ```bash
   curl -i -H 'Host: vela.aarondewindt.space' http://192.168.0.106:3001/
   ```

   Expect 200. A request using the LAN IP as Host intentionally returns 421.
   This verifies the desktop's outer Docker publishing, routing and firewall.
   Container-local tests cannot prove this hop. If it fails, check the desktop
   listener, outer mapping and firewall before changing cloudflared.

## Desktop firewall

Do not forward desktop ports on the router. Allow the Pi to reach TCP 3001 and
keep other LAN clients out if practical. With Docker bridge networking, traffic
leaves the Pi with its LAN address (Docker NAT), not normally `172.23.0.x`.
Determine that source on the Pi with `ip -4 route get 192.168.0.106`.

Docker-published ports can bypass ordinary UFW input rules. If the desktop uses
Docker's iptables backend, use its `DOCKER-USER` forwarding chain rather than
assuming `ufw deny 3001` protects the published port. After substituting the Pi's
actual LAN IP and the desktop interface, a narrow example on the **desktop** is:

```bash
sudo iptables -I DOCKER-USER 1 -i LAN_INTERFACE -p tcp -s PI_LAN_IP \
  -m conntrack --ctorigdst 192.168.0.106 --ctorigdstport 3001 -j ACCEPT
sudo iptables -I DOCKER-USER 2 -i LAN_INTERFACE -p tcp \
  -m conntrack --ctorigdst 192.168.0.106 --ctorigdstport 3001 -j DROP
```

Inspect existing rules first; persist using the desktop's existing firewall
management. These commands are an example, not an applied firewall change. If
Docker uses nftables, use its corresponding forwarding policy instead. Host
checking is not network access control: a LAN client can send the correct Host.
Avoid remote administrative changes until the Pi curl succeeds. Background
services elsewhere on the Pi do not need changes.

## Cloudflare published application route

Use the **existing remotely managed tunnel** in the Cloudflare dashboard under
Networking / Tunnels (some dashboard layouts use Zero Trust / Networks /
Connectors). Add a published application route:

| Field | Value |
| --- | --- |
| Subdomain | `vela` |
| Domain | `aarondewindt.space` |
| Path | empty (all paths) |
| Service type | HTTP |
| Service URL | `192.168.0.106:3001` (full origin: `http://192.168.0.106:3001`) |
| HTTP Host Header | `vela.aarondewindt.space` |
| Access application / Access enforcement | none / disabled |

Keep chunked encoding enabled; AI chat uses HTTP streaming. No origin TLS,
`noTLSVerify`, WebSocket rewrite or Caddy is needed. The public process has no
HMR connection. Use Cloudflare's HTTPS redirect / Always Use HTTPS for the
hostname. Add a cache rule matching `http.host eq "vela.aarondewindt.space"`
with **Cache eligibility: Bypass cache**, ordered so no later rule overrides it.
Do not use Cache Everything for Vela. Purge any previously cached content for
this hostname. See [Cloudflare routing](https://developers.cloudflare.com/tunnel/concepts/routing/)
and [origin parameters](https://developers.cloudflare.com/tunnel/reference/origin-parameters/).

Saving the published route creates/updates its tunnel DNS record; resolve any
pre-existing conflicting DNS record first. Leave the Home Assistant route
`http://192.168.0.101:8123` unchanged. No new tunnel, connector, token or secret is
needed. Nothing needs adding to `/opt/stacks/home-gateway/caddy/Caddyfile` or the
Pi Compose file. The `edge` network and existing `tunnel` profile remain as they
are. A remotely managed route update normally needs no connector restart.

## Authentication and acceptance checks

Better Auth has a fixed `https://vela.aarondewindt.space` base URL and trusts only
that origin in public mode. It does not trust forwarded host/protocol headers for
redirects. Cookies are Secure, HttpOnly, SameSite=Lax and scoped to this host;
HTTP between Pi and desktop does not change browser cookie security. Auth clients
use relative same-origin URLs. The public proxy rejects other Host values and
cross-origin API mutations. Cloudflare's `CF-Connecting-IP` supplies the public
login rate limiter's client address; trust it only on the controlled tunnel/LAN
path. Rate limits are in memory and reset with the process. See [Better Auth
cookies](https://better-auth.com/docs/concepts/cookies) and [proxy security](https://better-auth.com/docs/1.6/reference/security).

All tRPC feature procedures use the server-validated session; ownership comes
from that session, not a client-supplied user ID. AI chat authenticates before
parsing input or invoking inference. Nutrition pages check the session before
loading diary/catalog/history data. Unauthenticated visitors can see the shell,
sign-in UI and browser assets, but not personal records. Public `/dev-tools` and
its RPC operations are disabled even for authenticated users. AI experiments
remain available to authenticated users only. `public/` currently contains only
a favicon. NEVO CSVs are parsed through authenticated RPCs; original source rows
and imported records live in PostgreSQL. There is no persisted filesystem upload
store or unauthenticated file-download route. Do not put private uploads or dumps
in `public/`; future file storage needs an authenticated download path and backup.

After publishing, check from outside the LAN:

```bash
curl -I https://vela.aarondewindt.space/
curl -i https://vela.aarondewindt.space/api/auth/get-session
curl -i https://vela.aarondewindt.space/api/trpc/nutrition.getGoals
curl -i -X POST -H 'Content-Type: application/json' -d '{}' \
  https://vela.aarondewindt.space/api/ai-dev/chat
curl -i https://vela.aarondewindt.space/__nextjs_original-stack-frames
curl -i https://vela.aarondewindt.space/_next/webpack-hmr
curl -i https://vela.aarondewindt.space/.env
curl -i https://vela.aarondewindt.space/dev-tools
```

Expect HTTPS with no Access login, null session, unauthorized RPC/chat, and 404
for debug paths, `.env` and developer tools. Sign in with the personal account;
inspect Set-Cookie attributes in browser devtools, refresh the diary, create a
food/log entry, sign out and confirm it is no longer accessible. Repeat in a
private browser window. Test a NEVO upload and streaming chat if using them.
Do not post credentials in shell commands or share cookies/logs.

## Backups, recovery and schema work

The current Docker-in-Docker feature mounts **both `/var/lib/docker` and
`/var/lib/containerd` in desktop named volumes**. Inside it, PostgreSQL uses
`vela-postgres-data:/var/lib/postgresql` (correct for PostgreSQL 18), and pgAdmin
uses `vela-pgadmin-data`. Normal stop/start and same-workspace rebuilds reuse
these volumes. The checkout is a desktop bind mount; `.local/backups` survives a
container rebuild independently of Docker-in-Docker. Verify retained volumes on
the desktop before/after a rebuild; renaming/moving the checkout or deleting
Dev Container volumes can select new empty storage. Never solve that by resetting
the old database. Keep the original volumes until recovery is verified.

Run a dump before every schema change/rebuild and at the end of each logging day:

```bash
yarn db:backup
# Optional absolute backup directory on another mounted disk:
node scripts/database-backup.mjs backup /path/to/private/backups
```

The database runs while pg_dump takes a consistent snapshot. The dump contains
all Vela accounts, catalog/source snapshots, nutrition entries/goals/history,
chat/drafts, sessions, migrations and vectors. No filesystem uploads currently
need a separate backup. Copy dumps to another device such as the Pi using your
existing SSH setup, and keep several dated copies. Back up `vela.env`,
`vela_db.env`, `vela_pgadmin.env` and any `.env.public.local` separately in an
encrypted/password-manager backup; never commit them. Retain the matching code
revision and any uncommitted source changes needed to read that schema. A backup
on the same desktop disk does not protect against disk loss.

Test recovery to a **new database**, leaving the existing database intact:

```bash
node scripts/database-backup.mjs restore .local/backups/vela-TIMESTAMP.dump vela_recovery_check
```

The tool uses PostgreSQL 18's `createdb`/`pg_restore` inside the running DB
container, refuses an existing database name, and stops on restore errors. A
failed restore may leave a partial **new** database; inspect or remove that
specific recovery database before retrying. It never drops an existing database.
Check the result:

```bash
docker compose -f .devcontainer/docker-compose.inner.yml exec db \
  sh -c 'psql -U "$POSTGRES_USER" -d vela_recovery_check -c "SELECT count(*) FROM \"user\";"'
```

For actual recovery, stop both Vela processes and the nutrition indexing worker,
restore to a fresh name, and point `DATABASE_URL` at that name (preserve the rest
of the connection settings). Recreate the dev container to reload `vela.env`, or
set the recovered URL in the relevant process environment/public override.
Use code compatible with the restored schema, rebuild the public app, sign in,
and verify records before restarting workers. Retain the old DB until satisfied.
A `pg_restore --list FILE` check alone does not prove successful recovery.

Avoid `prisma migrate reset`, `prisma db push --force-reset`, `db push
--accept-data-loss`, manual DROP/TRUNCATE, `docker compose down -v`, `docker
volume rm`, `docker system prune --volumes`, and removing Dev Container data
volumes. There is currently **no configured Prisma seed or automatic reset**;
`postCreateCommand` installs packages and `postStartCommand` starts inner Compose.
The authenticated Dev Tools clear action deletes the caller's tagged test tasks
and related planner records; it does not reset nutrition, and is disabled publicly.

For ordinary reviewed migrations: back up, stop app/worker processes, review the
SQL, and use `yarn prisma migrate deploy`. Generate the Prisma client as required
with `yarn prisma generate`, then rebuild/start. Do not casually run `migrate dev`
on daily-use data: drift handling can propose a reset. A successful migration
can still destroy data if its SQL does so. Every developer command targets the
same database unless you explicitly change its connection string.

## Availability and limits

Desktop sleep/reboot, closing the dev container (its shutdown action stops
Compose), Docker failure, database failure, stopping the public terminal, build
errors and application bugs interrupt daily use. The Pi/tunnel can stay healthy
while Vela is unavailable. No automatic boot/start supervisor is included.
Stopping `yarn dev` alone does not stop the public process, but public:start,
container or shared-database shutdown does. If you point the tunnel at yarn dev
instead, stopping it and development recompilation failures also interrupt use
and expose the debugging surface described above.

Development and daily use share database/schema, dependencies, generated Prisma
code and machine resources. A separate user provides application record
ownership, **not isolation from resets, migrations, DBA commands or bad code**.
Public builds lag behind local edits until explicitly rebuilt. Coordinate schema
changes with both processes. Keep regular backups and record feedback while
accepting these experimental availability limits. A separate deployment can wait.

## Repository validation (2026-10-19)

- `yarn public:build` completed, including Next's production TypeScript check.
- `yarn typecheck` passed; all 63 Jest suites / 422 tests passed.
- Both Compose files passed `docker compose … config --quiet`.
- Focused lint and formatting checks passed for the deployment code.
  Repository-wide `yarn lint` still fails on existing unused imports, alerts and
  missing braces in planner/UI files outside this change.
- An actual custom-format pg_dump was restored to a fresh database, checked for
  restored tables, and that temporary database was removed. The original dump
  remains in private `.local/backups`.
- The built server passed HTTP checks for Host/origin enforcement, disabled
  registration, public debug paths, anonymous data/upload/chat rejection,
  secure session cookies, authenticated food logging and two-user isolation.
  Both temporary accounts and their records were removed afterwards.
- Outer host port mappings, a dev-container rebuild, Pi-origin connectivity,
  firewall rules, Cloudflare configuration and an external-browser HTTPS check
  have **not** been applied or verified by this repository session. The public
  server was started on container port 3001 for testing; the existing container
  still needs rebuilding to publish that port and restrict 3000/5050.

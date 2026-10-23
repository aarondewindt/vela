# Device credentials and pairing (#93)

Vela browser login and pairing approval use Better Auth. External clients use
independent account-owned bearer credentials. Android, Home Assistant clients and
scripts can share this protocol; no OAuth server or browser-session export is
required. Manual/headless token issuance remains a follow-up.

## Deployment

Apply `20261024000000_device_credentials` with `yarn prisma migrate deploy`, then
run `yarn prisma generate` and rebuild/restart Vela. The migration adds
`device_credentials`, `device_pairings`, and `device_rate_limits` with account
cascade deletion. No existing credentials are converted. No new secret or
environment variable is required.

`BETTER_AUTH_URL` must be the canonical **HTTPS origin**. Device pairing/verification
is disabled on HTTP-only deployments. The existing public-mode configuration is
recommended. TLS terminates at the trusted gateway (currently Cloudflare Tunnel);
keep the application's direct HTTP port private. The server checks configured
HTTPS deployment rather than trusting caller-supplied forwarded headers. A local
HTTP process configured with an HTTPS origin is not itself TLS: never expose its
port as an alternative public ingress. Do not use insecure Android trust managers
or HTTP development exceptions for credentials.

## Pairing

1. Android: enter the Vela HTTPS origin and a recognizable device name; tap
   **Start pairing**. It displays a 12-character code and expiry.
2. In your signed-in Vela browser open **Settings → Devices**. Enter the code,
   choose **Review pairing**, verify the device name/type and `health:write`
   permission, then explicitly approve. Approve only pairings you initiated.
3. Android: tap **Finish pairing after approval**, then **Check saved connection**.
   No health measurements are uploaded. A pending result means approval has not
   happened yet; there is no automatic polling.
4. The Devices screen shows name, client type, scopes, created/last-used times,
   optional expiry and revocation state. Revoke access there and check the Android
   connection again: it must fail. Pair a second device to confirm independence.

The display code authorizes a request but cannot retrieve a token. The initiating
client separately holds a random 256-bit session secret. Pairings expire after ten
minutes. Approval atomically assigns the owner once; redemption atomically consumes
an approved pairing and creates one credential in the same transaction. Only SHA-256
hashes of code, session secret and token are stored. Each token contains 256 random
bits with the `vela_device_` prefix. Code hashes use a high-entropy 48-bit display
code with short expiry and bounded online attempts. No password hashing algorithm
is needed for randomly generated 256-bit bearer secrets.

Android encrypts the origin and token together using AES-GCM with a key generated
inside Android Keystore, saving only ciphertext/IV in private preferences. Backup
and cleartext traffic are disabled. Pairing secrets stay in memory; restarting or
recreating the screen before completion requires starting again. Credentials are
never displayed/copied/logged. **Forget local credential** removes local storage;
it does not revoke server access. Revoke in Vela before replacing credentials.
If a redemption response is lost, app cancellation occurs before storage, or
Keystore/storage fails after issuance, the token cannot be retrieved again. Revoke
the issued device in Vela and start a new pairing. Uninstall/Keystore loss also
requires re-pairing. Browser logout does not invalidate independent device tokens.

## HTTP contract

All responses use `Cache-Control: no-store`; JSON bodies are limited to 2 KiB,
including streamed requests. No cookies are needed by external clients. Do not put
secrets in URLs, query strings, diagnostic reports, analytics or logs.

| Endpoint | Input / result |
| --- | --- |
| `POST /api/devices/pairing/start` | JSON `{ "name": "My phone", "clientType": "android" }`; returns `code`, `sessionSecret`, `expiresAt`, `approvalPath` |
| `POST /api/devices/pairing/redeem` | JSON `{ "sessionSecret": "…" }`; returns `{ "status": "pending" }` or `{ "status": "paired", "token": "…", "scopes": ["health:write"] }` |
| `GET /api/devices/verify` | Header `Authorization: Bearer <token>`; returns verified `userId`, `credentialId`, `scopes`; requires `health:write` and records last use |

JSON inputs reject extra properties, including caller-provided owner or scopes.
Names are 1–100 characters; client types are lowercase identifiers of up to 40
characters. Web review/approval/list/revoke use protected tRPC `devices` procedures;
device tokens never authorize those account-management procedures. List responses
select public metadata explicitly and never return hashes or tokens.

Failures use safe JSON `error` codes: 400 invalid input, 401 invalid/expired/revoked
credential or pairing, 403 insufficient permission/HTTPS disabled, 413 oversized
body, 429 rate limit (`Retry-After: 60`), 500 generic server failure. No database
errors or credential material are returned. There is no successful replay of a
redemption: save its token securely before attempting anything else.

Database-backed fixed one-minute windows allow 20 pairing starts/minute and 120
redemptions/minute globally, 10 reviews and 10 approvals/minute per authenticated
owner, and 600 credential verification attempts/minute globally. Global limits
avoid trusting public forwarded IP headers and bound anonymous pairing storage;
this small private deployment deliberately shares those budgets across devices.
They survive restarts and multiple processes, but an abusive client can exhaust a
global budget. Larger deployments should add gateway rate limiting and revisit
budgets before increasing traffic. Expired pairing rows are removed at the next
valid pairing start; rate counters have fixed global/account keys rather than
arbitrary caller-controlled keys. No expired tokens or sessions are accepted.

## Reusing authentication for #90

An integration route should use `deviceResponse` for HTTPS enforcement/safe
responses, bound and validate its own payload, then call
`requireDevice(request.headers, ['health:write'])`. It returns the owning `userId`
and `credentialId` for the deterministic ingestion service. Never obtain the owner
from an upload body. The helper performs a fresh database lookup on every request,
checks expiry/revocation and all required scopes, and records successful use. It
has no browser-session fallback. `health:write` grants no existing tRPC access.
Future scope additions must be explicit in issuance/approval and each route.
Credentials currently have no automatic expiry; the model/verifier support expiry,
and users can revoke at any time. A request already authenticated when revocation
occurs may finish; subsequent requests fail.

Before #90: test pairing/revocation on the physical phone and public HTTPS origin;
confirm Samsung calorie observation semantics; define idempotent upload validation,
source provenance and precedence relative to Home Assistant, including owner-scoped
storage. Health ingestion and manual/automatic sync are deliberately absent here.

## Validation

- `yarn jest --runInBand lib/devices` runs unit/transport/router security checks.
- Optional real PostgreSQL checks use an isolated randomly named temporary schema
  with synthetic accounts; no application tables are changed. The database role
  needs schema creation privileges. Prisma's ESM compiler needs the transform flag:

  ```bash
  VELA_DEVICE_DB_TESTS=1 yarn jest --runInBand lib/devices/database.test.ts --transformIgnorePatterns='/node_modules/(?!@prisma/client/)'
  ```

- `yarn typecheck`, `yarn lint`, `yarn format:test`, `yarn build` check the web app.
- With the Android toolchain configured, run the checks in [Android README](../android/README.md).
  Device tests include a Keystore encryption round trip; compilation alone does not
  establish a physical-device result. Exercise the pairing flow above on the phone.

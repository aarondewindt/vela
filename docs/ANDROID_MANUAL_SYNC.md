# Android manual health synchronization (#90)

Manual sync reuses #89's read-only Samsung activity-summary provider and #93's
Keystore-backed paired device credential. Background scheduling, bounded retries
and the shared durable outbox are documented in
[Android background sync](ANDROID_BACKGROUND_SYNC.md).

## Deploy

Apply `20261024100000_android_health_ingestion` with `yarn prisma migrate deploy`,
then `yarn prisma generate` and rebuild/restart the web app. The additive migration
adds `ACTIVE_CALORIES` to the existing metric enum and a default-empty `metadata`
JSONB column to `health_metrics`. No separate measurement store is created. Existing
readings and HA mappings remain valid. No new environment variables are needed;
#93's canonical HTTPS `BETTER_AUTH_URL` and paired credential are required.

Rebuild/install from the Ubuntu host with the same signing key as #89/#93:

```bash
./android/scripts/build.sh :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
./android/scripts/deploy.sh
```

Use the existing public HTTPS deployment (including its trusted TLS gateway) for
phone synchronization. The phone's localhost is not the devcontainer. For this
checkout, `yarn public:build` and the existing public deployment/start workflow
provide the configured production origin; a development process on port 3000 is
not automatically reachable through that origin. Check the actual running public
process and rebuild/restart it after migration. Keep direct HTTP ports private.
LAN HTTP and ADB reverse in the Android README are browser connectivity checks,
not native credential/health-upload routes. Never bypass certificate validation or
expose the development server publicly to make sync work.

## Snapshot contract

`POST /api/health/ingest` accepts bearer device credentials with `health:write`.
The owner and credential ID come exclusively from fresh server authentication.
Browser cookies do not authorize this endpoint. JSON requests are bounded to
64 KiB and 1–100 measurements; unknown properties and duplicate metric/date pairs
are rejected. The whole batch is transactional, including conflicts.

```json
{
  "version": 1,
  "source": "samsung_health",
  "measurements": [{
    "metric": "TOTAL_CALORIES",
    "value": 2400,
    "unit": "kcal",
    "date": "2026-03-29",
    "timezone": "Europe/Amsterdam",
    "observedAt": "2026-03-30T10:00:00Z",
    "periodStart": "2026-03-28T23:00:00Z",
    "periodEnd": "2026-03-29T22:00:00Z",
    "measurementKind": "sdk_aggregate_semantics_unverified"
  }]
}
```

This is synthetic example data. Also supported: `ACTIVE_CALORIES`. Values must be
finite 0–100000 kcal. Periods start at local midnight and end within that day or
at the next local midnight; elapsed periods cannot extend past capture time.
DST days use calendar boundaries rather than fixed 24-hour durations. Capture
must not be more than five minutes in the server's future. Phone and server clocks
must agree. `observedAt` means SDK **query response/capture time**, not source
measurement time, watch sync time or source modification time. `receivedAt` is
server receipt/write time. Metadata retains timezone, query interval, unit,
credential identity and explicit semantic uncertainty. Provider provenance is a
client assertion by an authorized device, not cryptographic Samsung attestation.

Each owner/device/provider/metric/date has one snapshot. Newer captures replace it,
including downward corrections. Equal captures with equal normalized data return
`unchanged`; different data at the same capture returns 409. Older captures return
`stale`. Concurrent requests serialize per owner. Storage uses six decimal places.
Response: `{ "version": 1, "results": [{ "metric": "TOTAL_CALORIES", "date":
"2026-03-29", "status": "created" }] }`, with `updated`, `unchanged`, and `stale`
as the other statuses. No cumulative totals are added together.

Errors: 400 invalid JSON/schema/period/unit (validation paths/messages included),
401 absent/expired/revoked credentials, 403 missing scope or HTTPS deployment,
409 capture conflict (read again), 413 oversized body, 429 rate limit (wait at least
60 seconds), 500 generic server error. Responses are not cached and omit database
errors. Android shows safe actionable messages without remote-body logging.

The versioned transport is independent of Samsung SDK types. Additional providers
and metric/unit definitions should extend explicit server validation and shared
Health storage; callers cannot invent unchecked metrics or source labels.

## Calorie interpretation and precedence

Sync reads **today from local midnight to sync start** and the selected completed
historical day, for total and active calories separately. It excludes the diagnostic
full-day-today query. It never calculates BMR/resting calories, adds active calories
to total, estimates missing data or substitutes HA values. Missing readings are
skipped, including zero-length elapsed ranges at exact midnight; explicit SDK zero
is a valid reading. Query errors or permission loss abort before upload.

#89 was accepted on the phone, but its elapsed-versus-projected semantics were not
classified. These are raw SDK aggregates with **unverified calorie semantics**;
querying elapsed time does not prove that Samsung excludes projected resting
energy. The app and Vela source labels preserve this limitation. Do the comparison
procedure in [the validation guide](ANDROID_HEALTH_VALIDATION.md) before treating
these as final observed expenditure.

For total and active calories, Health selects one series per day: **manual override,
then Samsung Health, then HA**. Within a priority, latest capture/state time wins,
then receipt time/ID. Other metrics retain existing latest-reading behavior.
Samsung totals therefore stay authoritative even if HA updates later. A manual
override remains until deleted. Multiple phones retain distinct provenance but
only one selected snapshot contributes. Active calories are visible separately and
never used in calorie balance. No daily calories carry forward to missing days.
Phone timezone determines uploaded dates; configure Vela's timezone to match for
intake/burn comparisons. Existing dates do not move if timezone changes. Re-pairing
creates a new credential/series; old rows remain historical and are not added to
new rows. Credential revocation prevents future requests, not deletion of history.

## Physical phone acceptance test

1. Deploy the migration/web build. Install the host-built APK. Confirm Samsung
   Health developer Data Read mode, watch sync, and Activity Summary READ consent
   using the #89 guide. Pair via Settings → Devices using #93's instructions, or
   verify the existing saved connection. Confirm the intended Vela account.
2. Select yesterday (or another known completed day) in the companion. Record the
   phone timezone. Refresh diagnostics; privately compare today's **elapsed** and
   historical total/active SDK readings with Samsung Health at nearly the same time.
   Do not use the full-day-today projection diagnostic as the upload expectation.
3. Tap **Sync now**. Check progress (connection/read/upload), per-status counts,
   skipped readings, and the persisted last-success timestamp. Open `/health` on
   the same account, select each uploaded date, and check total/active cards,
   Samsung source/capture labels and calorie balance (`intake − total`). Allow
   the Health query's 30-second refresh or reload. Compare displayed precision
   (two decimals) with private diagnostics; storage retains six decimals.
4. Tap Sync again. This takes fresh captures and updates the same daily rows;
   it must not accumulate calorie totals or rows. After a workout/watch sync,
   repeat and check the new total. Repeat the same historical day after late data
   or a source correction; a newer lower value must replace the previous value.
   For exact-body replay/stale/concurrent tests use the synthetic automated DB
   test below; do not put personal upload bodies or tokens in shell history/logs.
5. With HA mapping enabled, let HA update after the phone upload. Samsung stays
   selected; calorie balance must not add both sources or active calories. Add a
   manual total and verify override, then delete it to restore Samsung selection.
   In another Vela account verify none of the first account's readings appear.
6. Disconnect networking and tap Sync. Expect an error and unchanged last-success
   time. Reconnect and tap again; a response lost after server commit is safe to
   retry. There is no automatic retry or durable pending batch. Restart the app
   and confirm saved credentials and last-success time persist.
7. Revoke the device in Settings → Devices; sync must fail with a pairing/revocation
   message and no writes. Forget local credential, then pair again. Test Samsung
   permission denial/revocation independently; no health upload should occur.
8. Repeat around local midnight and DST where practical, plus watch delay and a
   selected historical day. Compare exact query ranges/values per #89; do not
   classify projection semantics merely because upload succeeded.

Connected UI/Keystore tests run on an authorized phone with
`cd android && ./gradlew :app:connectedDebugAndroidTest`. Compilation alone does
not establish a phone-to-Vela result. This implementation has not performed the
physical phone acceptance flow; keep private comparison evidence locally.

## Automated checks and #91 boundary

`yarn jest --runInBand lib/health lib/devices components/Health
lib/integrations/home-assistant` covers validation, auth transport, updates and
existing integration regressions. The opt-in PostgreSQL test creates/drops its own
random schema, never application tables:

```bash
VELA_HEALTH_DB_TESTS=1 yarn jest --runInBand lib/health/ingestion-database.test.ts --transformIgnorePatterns='/node_modules/(?!@prisma/client/)'
```

It verifies the migration, simultaneous identical uploads, precision-safe retries,
late stale uploads, downward corrections, owner separation, source priority,
manual override and exclusion of active calories from balance. Android JVM tests
cover provider reads/conversion, missing/zero values, ranges and permission loss.

Issue #91 now reuses this endpoint and provider boundary through `HealthSync`.
See [background sync](ANDROID_BACKGROUND_SYNC.md) for recent-day reconciliation,
durable retries and the remaining physical-device acceptance checks. Calorie
semantic classification remains unverified and is preserved in upload metadata.

## Implementation verification (2026-10-24)

- Full Jest: 1,127 passed; four opt-in database tests skipped in the default run.
  The isolated health-ingestion PostgreSQL test also passed separately.
- Prisma generation, TypeScript, changed-file Oxlint/formatting and whitespace
  checks passed. Repository-wide lint and formatting retain unrelated baseline
  failures (21 pre-existing files fail formatting).
- `NODE_ENV=production yarn build` passed outside the restricted sandbox. The
  inherited nonstandard NODE_ENV caused an initial prerender failure; sandboxed
  Turbopack stalled. No deployment or application-database migration was performed.
- Android offline build, 17 JVM tests, lint (zero errors, ten advisory warnings),
  and device-test compilation passed with the existing temporary JDK/SDK. Lint
  advisories concern pinned dependency versions, backup rules and KTX edit helpers.
  Host `local.properties` was restored. Connected tests and actual phone uploads
  remain unperformed.

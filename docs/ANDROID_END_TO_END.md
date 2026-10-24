# Android companion end-to-end review (#92)

Reviewed 2026-10-24. Implementation covers Samsung Health → Android → scoped HTTPS
API → PostgreSQL → Vela Health. This is a code/test review, not evidence that an
unattended physical phone completed the pipeline. No deployment, application-table
migration, new health permission, SDK upgrade or additional integration was made.

The expanded source-matrix continuation is documented in
[Android source matrix](ANDROID_SOURCE_MATRIX.md); it implements steps, sleep and
optional SDK BMR and restricts new HA health imports to Withings body measurements.
The verification numbers below record the initial pass.

## Findings and fixes

- The Android coordinator previously discarded its pending snapshot after any
  HTTP 200 JSON response. It now requires protocol version 1 and exactly one
  recognized acknowledgement for every uploaded metric/date before clearing the
  outbox. Missing, duplicate, mismatched and unknown acknowledgements retain it.
  Unexpected protocol failures pause background sync for inspection/recovery.
- Unexpected multiple SDK aggregate rows previously became a null value and were
  silently skipped during upload. They now fail the batch as a query error; no
  inferred sum or incomplete success is reported. Empty/null readings still mean
  unknown, while an actual numeric zero is retained.
- The pairing success message claimed no health data had been sent even though
  pairing schedules background work. It now explains automatic synchronization.
  Setup documents no longer describe ingestion or background sync as future work.

## Calorie and persistence review

Both total and active kcal are read independently. Only TOTAL_CALORIES is used as
burned energy; active is never added to total. Diagnostics expose both elapsed
midnight-to-now and full-calendar-day requests, but upload excludes future full-day
windows. An elapsed query range does **not** prove Samsung's value excludes a
projected/resting baseline. Existing metadata accurately retains
`sdk_aggregate_semantics_unverified`; SDK response bounds are not represented as
measurement or last-modified timestamps. Capture time is the SDK response time.

Today and the seven preceding completed dates are reread automatically. Manual
sync adds the selected completed historical date to today. The backend stores
snapshots, never cumulative deltas. Identity is owner + device + source + metric +
date. Later captures can revise downward; older captures are ignored; identical
capture/payload retries are unchanged; conflicting reuse of capture time is 409.
An owner advisory lock serializes ingestion, and batches commit transactionally.

Vela selects one daily series: Samsung, then manual, then legacy Home Assistant,
with recency within a priority. Multiple devices/sources may retain separate
provenance rows; those rows are not summed. Device revocation prevents future
requests but does not erase already accepted measurements or change precedence.
Manual readings fill gaps; Samsung remains authoritative when available. A missing/newly deleted
upstream aggregate does not delete an existing server reading. These are explicit
limitations, not confirmed upstream deletion support.

Local calendar dates and IANA phone timezone produce UTC query bounds. Tests cover
23-hour spring days, 25-hour autumn days and a non-whole-hour timezone. Midnight
changes the next query's today. Historical dates use the phone's **current** zone;
the SDK LocalTimeFilter is wall-time based. Travel, repeated autumn hours and data
recorded in a different zone still need phone comparison. No original-record zone
or ambiguous-hour behavior is inferred. Reads are sequential rather than atomic;
watch delivery between metric reads can produce temporally different snapshots.

## Reliability, security and privacy review

- Manual and worker uploads share a coroutine mutex and bounded app-private
  outbox. Credential replacement/removal uses the same mutex. The WorkManager
  job is unique and uses the default app process; changing the interval updates
  existing work. No second upload engine or persistent foreground service exists.
- WorkManager runs with connectivity and battery-not-low constraints. Defaults
  are 60 minutes; choices are 15/30/60/120. Network/408/429/5xx and query failures
  have four exponential retries per cycle. Permanent auth, permission, validation
  and unexpected failures pause work. Pending capture timestamps survive replay.
  A simulated lost-response test compiles for the device; actual process death,
  cancellation, OS scheduling and battery effects remain physical tests.
- Samsung consent is checked before pending replay and before saving fresh data.
  Background work never opens permission dialogs. A permission or token already
  checked can be revoked during a request; an already accepted request may finish.
- Pairing uses separate random session secret/display code, authenticated browser
  approval, expiry and single transactional redemption. Server stores hashes of
  random secrets. Each device request checks revocation, expiry and health:write;
  owner identity comes from the token, never the payload. Device tokens cannot
  manage devices or authorize browser tRPC. Account deletion cascades credentials.
- HTTPS origin is required, redirects disabled, platform TLS trust retained,
  request/response bodies bounded, input schemas strict, responses no-store, and
  rate limits database-backed. The trusted TLS gateway must keep the direct HTTP
  app port private: the server's HTTPS configuration check is not transport TLS.
- Android origin/token are AES-GCM encrypted with Android Keystore. App backup
  and cleartext traffic are disabled. Health outbox data is plaintext app-private
  storage, not additionally Keystore encrypted. Rooted devices, debug tooling,
  screenshots, explicit clipboard diagnostics and shared Logcat exports are
  outside that protection; keep personal readings and credentials out of issues.
  No new health/credential logging was found in the app/API paths reviewed.
- Browser sign-out does not revoke device credentials. Forgetting locally clears
  the outbox and cancels work but does not revoke the token on the server. Revoke
  in Vela Settings when retiring/replacing a phone. Tokens have no automatic
  expiry in the current issuance flow; expiry checks exist in verification.

## Practical setup and recovery

1. Follow [Android README](../android/README.md) for Ubuntu Android Studio, JDK 17,
   pinned Gradle wrapper, SDK packages and host ADB. VS Code devcontainer edits the
   same checkout; container builds are optional and do not supply USB access.
2. Supply the licensed Samsung AAR, enable developer Data Read mode and grant
   activity-summary READ using [the validation guide](ANDROID_HEALTH_VALIDATION.md).
3. Deploy both documented device/ingestion migrations through your normal server
   workflow. Use the canonical HTTPS origin, then pair through signed-in
   Settings → Devices as described in [device auth](DEVICE_AUTH.md).
4. On Ubuntu run `./android/scripts/deploy.sh` to build with the host signing key,
   install with retained data and launch. Debug APK is
   `android/app/build/outputs/apk/debug/app-debug.apk`. Do not install a differently
   signed container APK over the host app. Reinstall after a signing mismatch
   destroys local credentials/outbox and requires pairing again.
5. Select a completed date, run Sync now, and verify source/date/total in Vela
   Health. Use the sync card interval and pause/resume controls for background work.
   Android/Samsung sleeping-app settings can delay runs, including after reboot.
6. For 401/403 revoke/re-pair or repair scopes/server configuration. For denied SDK
   access, repair Samsung consent/developer mode and resume. For 400/409 repair
   date/time or app/server compatibility, discard the rejected pending snapshot
   explicitly, then capture fresh values. For temporary outages retain pending
   data and allow retries. Never change TLS trust to bypass a connection failure.

Build and native checks from the repository root on the Ubuntu host:

```bash
./android/scripts/build.sh :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
cd android
./gradlew :app:connectedDebugAndroidTest
```

Connected tests require an authorized test phone; compilation alone does not run
them. See README for ADB authorization, install stalls, signing, Logcat and report
paths. Keep the host key, SDK binaries, `local.properties` and private reports out
of Git. Do not run host/container Gradle concurrently against shared outputs.

## Galaxy S25 FE acceptance still required

Keep comparison evidence privately with date, timezone, app/SDK versions, query
range, SDK raw values, exact Samsung display label and Vela result. Do not replace
unknown semantics with an assumed BMR adjustment.

| Check | Expected evidence |
| --- | --- |
| Morning, midday, late evening and after workout | Total and active match identified Samsung displays with explained rounding; elapsed/full-day differences classified |
| Midnight and delayed watch sync | New local date and revised yesterday/older totals appear without accumulation |
| DST/travel/repeated local hour | Exact SDK query and displayed calendar dates agree, or discrepancy recorded |
| Offline/response loss/process kill | Retained pending snapshot recovers; no duplicate daily total |
| Consent/token revocation and wrong account | Upload blocked, actionable state, no cross-owner records; re-pair/resume recovers |
| Manual sync during background work | Serialized upload and consistent final total |
| Reboot/app update/force-stop | Work resumes when Android allows; force-stop requires reopening; consent persistence recorded |
| Several days at chosen interval | Actual cadence and battery usage acceptable with Samsung sleep restrictions recorded |
| Connected Android tests | Keystore, UI and outbox recovery tests actually execute on the authorized phone |

Earlier #88/#89 user acceptance established app launch and satisfactory reads,
not elapsed/projected classification or these complete end-to-end outcomes.

## Original integration proposals (superseded in part by the continuation)

The existing `HealthProvider` boundary keeps Samsung SDK types isolated, but its
permission methods and `readCalories` result are calorie-specific. Do not map
other measurements into `CalorieUpload`. A follow-up should introduce typed,
optional provider capabilities and per-capability read consent, while retaining
the common scheduler, outbox and authenticated ingestion boundary. Distinguish
point samples, sessions and daily aggregates; preserve upstream IDs, revision and
deletion semantics, pagination and origin. No broad dictionary-based metric API
or new permissions are necessary for this review.

Proposed issue titles and scope, ordered by usefulness for the existing app:

| Proposed follow-up | Scope and acceptance gate |
| --- | --- |
| Android: verify calorie semantics and unattended S25 FE acceptance | Complete the evidence table before treating SDK totals as verified elapsed expenditure |
| Android: opt-in weight/body composition ingestion | Existing Vela weight/fat/lean-mass concepts are a useful starting point. Define source IDs, units and per-sample timestamps; verify actual available Samsung fields before expanding schema/permissions |
| Android: sleep-session ingestion | Define overnight date attribution, awake/stage durations, overlapping sessions and revisions; reconcile with existing scalar sleep display without summing overlaps |
| Android: steps and activity summaries | Decide the Vela product use first; retain daily cumulative identity and origin deduplication. No calories derived from steps |
| Android: heart-rate summary feasibility | Define a useful bounded summary rather than uploading all samples; requires a new server contract and Health presentation decision |
| Android: optional Health Connect provider | Feature/permission checks, origin attribution and comparison against Samsung; preserve one authoritative calorie series, not a silent fallback or duplicate import |
| Android: older corrections and source deletions | Evaluate upstream change APIs and tombstones; the seven-day aggregate reread currently cannot detect every old edit or deletion |

Samsung lists body composition, sleep, heart rate, steps and exercise among its
[data types](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-types/index.html).
Availability of a type does not guarantee data exists on this phone or that every
field has the semantics Vela needs. These are feasibility proposals, not approvals
to ingest them. [Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
include body measurements, sleep and activity. Background and older-history reads
need additional consent and availability checks; see its [read guidance](https://developer.android.com/health-and-fitness/health-connect/read-data).

## Personal use versus distribution

Keep the present app a personal development/testing prototype for now; continued
access is contingent on Samsung developer-mode behavior and consent. This is a
recommendation, not a guarantee of permanent developer-mode access. Samsung says
[developer mode is for testing/debugging](https://developer.samsung.com/health/data/guide/developer-mode.html),
and [distribution requires partnership/registration](https://developer.samsung.com/health/data/process.html).
An approved distribution path needs the correct package, release-signing SHA-256
and permitted data scope; see [app verification](https://developer.samsung.com/health/data/guide/app-verification.html).
A sideloaded debug APK alone supplies none of that approval. Stable release key
handling, release build/privacy review and appropriate store declarations would
be separate work. No partnership or registration request was initiated.

## Performed validation

- Android offline checks with the existing temporary JDK 17/SDK: `assembleDebug`,
  `testDebugUnitTest` (**25 passed**), `lintDebug` (**zero errors**, 22 warnings and
  one hint), and `assembleDebugAndroidTest` passed. Lint advisories include pinned
  dependency versions, preference KTX suggestions and backup configuration.
  Host `local.properties` was restored. Connected tests were not run.
- Full Jest: **145 suites / 1,131 tests passed**; four database tests skipped in
  that default run. The two opt-in PostgreSQL suites then passed separately:
  **four tests**, isolated random schemas created/dropped, no application-table
  migrations. These verify concurrent redemption, owner isolation, revocation,
  expiry/rate limits, ingestion retries/corrections and source precedence.
- `yarn typecheck` and `NODE_ENV=production yarn build` passed. Builds and database
  tests required execution outside the restricted sandbox; the initial sandboxed
  database attempt failed to connect. No application deployment was performed.
- Changed TypeScript test passes focused Oxlint/format checking. `git diff --check`
  passed. Repository-wide Oxlint still fails on existing unused imports in
  `app/client_layout.tsx` and missing braces in Planner/Today files. Repository
  formatting has 21 unrelated pre-existing files failing; they remain untouched.
- Stylelint initially scanned generated Gradle report CSS and failed on seven
  report-style violations. `.stylelintignore` now excludes `android/**/build/**`;
  the standalone Stylelint check passes. This keeps Android builds from breaking
  web style validation without weakening checks on authored application CSS.

New/updated tests cover exact acknowledgement completeness/status/version,
unexpected SDK aggregate cardinality, retained outbox after malformed acknowledgement
and permission revocation (device test compiled), and additional backend DST,
non-whole-hour timezone and invalid-range cases. The existing recovery device test
now supplies realistic server acknowledgements. There is still no claimed physical
Samsung-to-Vela verification or measured battery result.

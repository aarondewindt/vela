# Android background synchronization (#91)

The companion schedules unique WorkManager work at a configurable interval (**15, 30, 60 or 120 minutes**, default **60**), with connected
network and battery-not-low constraints. Execution is opportunistic: Doze, Samsung
sleeping/deep-sleeping app restrictions, battery saver, network availability and
Android quotas can delay it substantially. There are no exact alarms, foreground
services, persistent notifications or battery-optimization exemption requests.
WorkManager persists scheduling and restores it after reboot and package updates.
Use **Sync interval** in the sync card to change the interval. The setting survives
app restarts and re-pairing. Updating the interval updates the existing unique work
without interrupting a running sync; changing it while paused keeps sync paused.
WorkManager requires at least 15 minutes, so 10-minute periodic work is unsupported.
Android force-stop prevents execution until the app is opened again. Uninstall or
clearing app storage removes credentials and pending work; pair again afterwards.

`HealthSync` is the common manual/worker coordinator. A process-wide coroutine mutex
serializes manual sync, worker sync and local credential removal/replacement. SDK
reads use application context in the worker; permission and availability dialogs
remain Activity-only. WorkManager uses its default application process.

Each automatic pass queries today through captured local time and the previous
seven completed calendar days, once per metric/day. Calendar boundaries use the
current phone timezone, including DST; a later pass naturally rolls over midnight
and recalculates ranges after travel. Late updates and downward corrections use
#90's existing versioned snapshots and server upserts. Total and active calories
remain separate and their SDK elapsed/projected semantics remain unverified.
Missing data is skipped, never turned into zero or a deletion. Automatic correction
coverage is seven days; for an older correction, select one completed historical
date in diagnostics and use **Sync now** (one-day bounded backfill plus today).

Before HTTP upload, an app-private, backup-disabled preference stores the complete
bounded batch, including original capture times. Credentials stay separately
Keystore encrypted and never enter WorkManager input/output. The batch is removed
only after a versioned successful response acknowledges every uploaded metric/date. On process termination or response loss, the
next pass checks credentials and Samsung consent, then replays that exact batch
before reading fresh values. The backend's owner/device/metric/date identities,
capture ordering and transactional ingestion make this replay idempotent. This
is one coalesced outbox, not an unbounded historical queue.

Network I/O errors, HTTP 408/429/5xx and SDK query/availability failures get at most four retries
per periodic cycle (five attempts), using WorkManager exponential backoff starting
at one minute. Once exhausted, pending data remains for the next periodic cycle.
Samsung Health being temporarily unavailable must not permanently pause synchronization;
missing/disabled/outdated installations still show the provider's repair instructions
while later periodic runs can recover. Authentication, validation, permission, SDK authorization and unexpected
storage/protocol failures pause automatic work and expose an actionable status.
A paused worker does not upload; **Resume background sync** explicitly re-enables
it after repair. **Pause background sync** cancels scheduled work. An HTTP operation
already accepted by the server may finish while cancellation takes effect.

The screen observes preference changes and shows live WorkManager state, next
eligible run (not a deadline), retry count, last scheduler stop reason, pending
upload, last successful upload and last worker outcome. `ENQUEUED` means waiting
for timing/constraints, not failure. A diagnostic `partial` outcome can still have
a completely acknowledged upload: missing source readings are skipped, including
empty aggregates shortly after midnight. Check the ingest receipt and last-success
time before classifying it as a transport failure.

Explicit debug uploads additionally include a bounded scheduler snapshot with work
ID/state/generation, retry count, next eligibility and previous stop reason, plus
power saver, background restriction, battery percentage, battery-optimization
exemption status and validated-network availability. These are observations at
capture time, not proof of which constraint delayed an earlier execution. Samsung's
Never auto sleeping setting is separate from Android's battery-optimization
exemption; neither exemption is requested or changed by Vela. Cancelled worker
attempts capture Android's stop reason on API 31+; older platforms omit it.
WorkManager snapshot failure is explicit (`workAvailable: false`). Diagnostics
remain local until **Send debug logs to Vela** is selected. Deploy the additive
backend diagnostic schema before using the 0.3.1 client's expanded debug upload;
older clients remain accepted. Health ingest itself uses the existing protocol.

After fixing invalid data/date/time or upgrading the app,
**Discard pending snapshot** removes the rejected local batch so **Sync now** can
capture fresh values; it does not remove server measurements. Forgetting local
credentials clears the outbox/status under the same lock and cancels scheduling.
Pairing clears old local sync state so a pending batch cannot cross accounts.
Browser sign-out does not revoke the independent device token: revoke the device
in Vela Settings or forget it locally to stop its access.

## Verification and phone acceptance

### Investigation on 2026-10-25

The initial report that automatic sync had never uploaded was contradicted by
both the supplied diagnostic snapshot and a read-only check of Vela's ingestion
audit. The 00:12 Amsterdam automatic attempt uploaded 28 measurements, received
HTTP 200, validated every receipt and cleared the outbox. Its local `partial`
status described missing source readings shortly after midnight, not failed
delivery. Logcat also showed WorkManager `SUCCESS` after a cancelled first attempt
and a successful retry. An earlier paused attempt was recorded, but the available
history does not establish why it had originally been paused.

ADB inspection found the existing unique periodic work at 900,000 ms, not reset
on Activity creation, with connected-network/battery-not-low constraints and
exponential backoff. The app was installed, not force-stopped/suspended, in the
ACTIVE standby bucket, with background app-op allowed and battery saver off.
The battery was approximately 39% and USB powered. The job's only unmet constraint
at inspection was timing; connectivity had fluctuated earlier. No evidence
established Samsung's Never auto sleeping setting as the cause of the report.
After eligibility, `cmd jobscheduler get-job-state` returned `ready` while the
process remained absent. The system dump had `Force batch connectivity jobs:
true`, a Samsung connectivity batch-delay setting of 240,000 ms and general
network batch-delay setting of 1,860,000 ms. These observations support Android
batching as an explanation for a ready job waiting beyond 15 minutes; they are
not execution deadlines, and no system scheduling settings were changed.

Two code defects were addressed: the sync card did not subscribe to preference
changes, so worker success/pause/outbox state could remain stale; and any SDK
availability failure permanently set `paused`, requiring manual recovery even
after Samsung Health became available again. The latter path is now retried with
the existing budget and allowed to recover on later periodic cycles. This is a
verified policy fix, not a claim that an availability failure caused the recorded
00:12 cancellation. Stop-reason diagnostics were added to distinguish future
cancellations.

Verification: `./android/scripts/verify.sh --offline` passed (30 JVM tests,
debug APK, lint with zero errors / 24 advisory warnings / one hint, instrumentation
APK). `./android/scripts/verify.sh --offline -PvelaIsolatedDeviceTests=true
:app:connectedDebugAndroidTest` passed all 10 tests on the SM-S731B / Android 16.
Those tests use synthetic provider/HTTP boundaries in a separate package; they
cover manual/outbox recovery, cancellation retention, diagnostic snapshots and
live status updates, without touching real pairing. The new UI test initially
failed behind the device lock screen; matching the existing test's Activity
visibility setup resolved it. Four focused Jest suites passed 42 tests across
diagnostic schema/HTTP and health ingestion/HTTP, and TypeScript, scoped lint,
format and whitespace checks passed. Next.js MCP confirmed the project, routes,
log path and no current configuration/session errors. An authenticated web
browser check was unavailable; no web UI was changed.

The 0.3.1 (4) APK was installed with `adb install -r --no-streaming`, preserving
pairing/data and the existing job. No launch, sync button, forced job execution,
exemption, scheduler override or foreground service was used for the background
observation. The process was absent before eligibility. With the screen still off,
Android started it through `SystemJobService` at **00:30:46 Amsterdam time** and
WorkManager logged **SUCCESS at 00:30:50**. The automatic attempt reported 0.3.1 (4),
retry 0, 28 readings and 28 acknowledged receipts; local `partial` again represented
missing source readings. The outbox was empty, `paused` remained false and
`last_success` advanced. Vela's server audit independently recorded that same
attempt as automatic / success / HTTP 200 / count 28 at 22:30:50 UTC on October 24.
The next periodic job remained registered for eligibility approximately 15 minutes
later. The observed start was about three minutes after the 00:27:39 eligibility,
consistent with opportunistic Android batching.

This verifies one real scheduled background cycle with the updated APK, Samsung
SDK and backend, including process startup without opening the app. Physical reboot, unplugged deep Doze, long-duration battery-saver
operation and real permission/token revocation remain separate acceptance tests.

JVM tests cover retry classification/budget, seven-day reconciliation without
repeated today queries, cancellation, permission loss, missing readings and existing
DST/range behavior. `HealthSyncRecoveryTest` compiles as an instrumentation test and
uses isolated test preferences plus a simulated response loss to check exact
outbox replay after coordinator recreation. It does not contact Vela or Samsung.
Run connected tests only on an authorized test device.

On the paired physical phone, use the normal host build/signing identity and check:

1. Grant Samsung consent, pair, resume automatic sync, close the UI and allow an
   hourly run. Verify last success and daily totals in Vela without manual sync.
2. Disable connectivity, allow work to become pending, restore connectivity and
   verify recovery and no duplicate daily records. Interrupt the app process after
   an upload begins, then verify replay and eventual corrections.
3. Sync delayed watch data, including downward corrections for yesterday and an
   older day inside the seven-day window. Check midnight and DST/travel ranges.
4. Revoke Samsung consent or the device token: verify actionable paused status and
   no retry loop; repair/re-pair and explicitly resume. Forget locally while work
   is running and ensure no subsequent upload uses the forgotten credential.
5. Reboot and update the companion while retaining app data; allow Android to run
   work without opening the UI. Check Samsung Health consent/developer-mode
   persistence. Test force-stop separately, reopening to permit execution again.
6. Observe several days of cadence and Android battery usage. If Samsung puts Vela
   in sleeping/deep-sleeping apps, review that restriction in system settings;
   communicate that timing remains controlled by Android even after changes.

Physical-phone acceptance and battery observations are still required; compilation
and simulated tests do not establish those outcomes.

Implementation checks (2026-10-24): debug APK build, 21 JVM tests, lint (zero
errors; 21 advisory warnings), and instrumentation APK compilation passed using
the existing temporary JDK 17/SDK. The final run was offline with dependency locks
enforced. All 17 focused ingestion/service-route Jest tests passed. Connected tests
were not executed. The host `local.properties` was restored after each build.

## Expanded source matrix (#92 continuation)

The same batch now includes steps, Samsung sleep-date duration and actual optional
BMR body-composition points. Grant the four required READ types after upgrading.
See [source matrix and rollout](ANDROID_SOURCE_MATRIX.md). BMR scans are bounded;
its actual measurement date is retained, with labeled carry-forward in Health.

## Sync diagnostics (#103)

The shared sync coordinator now persists bounded local attempt history, including
pre-HTTP failures and WorkManager context. Android explicitly uploads snapshots
through **Send debug logs to Vela**; the server independently audits ingestion.
Use Dev Tools → Companion App for filters, reports and correlated request details.
See [diagnostics, retention and verification](COMPANION_DIAGNOSTICS.md). Pairing, permissions,
outbox replay, idempotency and receipt validation retain their existing behavior.

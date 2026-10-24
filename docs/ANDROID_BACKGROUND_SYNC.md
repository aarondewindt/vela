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

Network I/O errors, HTTP 408/429/5xx and SDK query failures get at most four retries
per periodic cycle (five attempts), using WorkManager exponential backoff starting
at one minute. Once exhausted, pending data remains for the next periodic cycle.
Authentication, validation, permission, SDK availability/authorization and unexpected
storage/protocol failures pause automatic work and expose an actionable status.
A paused worker does not upload; **Resume background sync** explicitly re-enables
it after repair. **Pause background sync** cancels scheduled work. An HTTP operation
already accepted by the server may finish while cancellation takes effect.

The screen shows WorkManager state, pending upload, last successful upload and
last worker outcome. After fixing invalid data/date/time or upgrading the app,
**Discard pending snapshot** removes the rejected local batch so **Sync now** can
capture fresh values; it does not remove server measurements. Forgetting local
credentials clears the outbox/status under the same lock and cancels scheduling.
Pairing clears old local sync state so a pending batch cannot cross accounts.
Browser sign-out does not revoke the independent device token: revoke the device
in Vela Settings or forget it locally to stop its access.

## Verification and phone acceptance

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

# Required Android / Withings source matrix (#92 continuation)

This continuation supersedes the initial #92 proposal-only status for steps,
sleep and BMR. All eight required metrics have ingestion/storage/display paths.
Automated checks use synthetic data; live Galaxy S25 FE / Withings acceptance is
still required. Nothing here claims actual personal readings were observed.

| Measurement | New ingestion source | Stored unit and display |
| --- | --- | --- |
| Weight | Withings sensor selected in Home Assistant settings | kg; existing card/chart/history, labeled carry-forward |
| Body fat | Withings → HA | %; existing card/chart/history, labeled carry-forward |
| Lean mass | Withings → HA | kg; existing card/chart/history, labeled carry-forward |
| Total calories burned | Samsung activity-summary aggregate | kcal; card, total/active chart, history and calorie balance |
| Active calories burned | Samsung activity-summary aggregate | kcal; card/chart/history, never added to total |
| Steps | Samsung `StepsType.TOTAL` platform aggregate | integer steps; card/chart/history, no carry-forward |
| Sleep | Samsung `SleepType.TOTAL_DURATION` platform aggregate | duration converted to hours; card/chart/history/goals, no carry-forward |
| BMR | Optional Samsung `BodyCompositionType.BASAL_METABOLIC_RATE` field | kcal/day; card/chart/history, latest actual point carried forward and labeled |

## SDK reads and semantics

The companion requests READ for **activity summary, steps, sleep and body
composition**. Body composition is needed only to read BMR; the companion does not
upload Samsung weight/fat/lean mass, preserving the intended Withings source.
No write, heart-rate or Health Connect permission is added. All four permissions
are currently required for the shared sync pass. Regrant access after updating an
older calorie-only APK, then explicitly resume a previously paused worker.

Calories retain their existing elapsed-query ranges and explicit unverified
elapsed/projected semantics. Steps use Samsung's native aggregate rather than
summing phone/watch samples, following its [migration guide](https://developer.samsung.com/health/data/migration-guide/overview.html).
Both use the phone's current local date and IANA timezone.

Sleep uses a **single Samsung sleep-date aggregate**, via the explicit half-open date range
`LocalDateFilter.of(date, date.plusDays(1), true, false)`, not a duration inferred from bed/wake wall times.
The native [sleep aggregate](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-sleep-type/-companion/-t-o-t-a-l_-d-u-r-a-t-i-o-n.html)
handles Samsung's grouping of overnight/multiple sessions. Vela stores the SDK's
returned duration unchanged except conversion to hours; it does not split a night
at midnight or independently sum overlapping device sessions. Metadata marks it
`sdk_sleep_date_total`. Query-range metadata is the requested sleep date, not an
invented bedtime/wake-up interval. Check actual Samsung date assignment, naps,
awake-time treatment, DST and travel on the phone; sleep stages/session export is
not implemented. Old HA sleep readings retain their original update-date semantics.

BMR **is available**, but optional, in the pinned Samsung 1.1.0 AAR and official
[field reference](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-body-composition-type/-companion/-b-a-s-a-l_-m-e-t-a-b-o-l-i-c_-r-a-t-e.html).
The documented unit is kcal/day and range 100–12000. SDK support does not imply a
BMR value exists in this user's records. Reads select the latest non-null field
per requested date, plus the latest available point if older than the normal
reconciliation window. Each scan paginates up to ten pages of 100; hitting the cap
fails visibly instead of claiming a complete result. There is no conversion from
resting expenditure, active calories, total burn or a profile formula.

BMR metadata retains the upstream record ID, actual SDK point timestamp and
optional update timestamp, separately from query capture/receipt time. Its calendar
date is the point time interpreted in the current phone zone. Null BMR fields are
skipped; no synthetic zero is uploaded. Historical cards can carry the latest known
point across missing days and label its original date, while charts show only
actual dates. BMR never enters `intake − total burn`; future estimation stays in #12.

## Shared synchronization and source authority

`HealthProvider.readAdditionalMeasurements` returns provider-neutral upload records;
only `SamsungHealthProvider` imports Samsung classes. The additional measurements
join existing calorie snapshots in **one** `HealthSync` batch, under the same
mutex, authenticated endpoint, durable outbox, acknowledgement validation and
bounded WorkManager retries. Existing queued version-1 calorie batches remain
valid and replay before fresh expanded reads. Version 1 gained metric-specific
unit/kind validation rather than a second transport. Credential scopes remain
`health:write` and existing tokens need not be replaced solely for these metrics.

Today and seven completed dates are reconciled automatically; manual sync includes
today and one selected older date. Daily metric identity remains owner/device/
source/metric/date, with capture-time ordering, precision-safe idempotent replay
and transactional whole-batch writes. Later downward corrections replace snapshots.
BMR captures additionally preserve the actual point's identity/times. Multiple
phones retain provenance but only one selected source contributes to a daily value.

For total/active calories, steps, sleep and BMR, **Samsung → manual → legacy HA**
is the daily priority, regardless of which source uploaded most recently. This
intentionally changes the previous manual-total override policy: manual entries
now fill missing Samsung days instead of overriding Samsung. Historical HA rows
are retained and remain labeled fallbacks for dates without Samsung data. Sleep,
steps and burn never carry across missing dates; body metrics and BMR do.
For the three body metrics, **HA → manual → other retained sources** is the
same-date priority. Carry-forward first chooses the latest measurement date, then
applies that date's source priority. Manual and historical rows are preserved.

HA settings now expose only weight/body-fat/lean-mass mapping controls. The server
rejects other new mappings, filters retained legacy mappings out of diagnostics,
and the worker ignores them before subscribing or requesting history. Normalization
also rejects obsolete HA metrics as a second guard. Existing Withings conversion,
owner isolation, encrypted token storage, recovery and revision/lease fencing remain.
The general HA REST/WebSocket adapter, connection settings, entity discovery and
other-module APIs are retained. An arbitrary sensor cannot be proven to belong to
Withings automatically: select the actual Withings entities belonging to you.

## Migration and rollout

1. Apply reviewed migrations through the normal deployment workflow:
   `yarn prisma migrate deploy`, then `yarn prisma generate`, rebuild/restart Vela.
   The new migration is `20261024120000_companion_source_matrix` (after #90).
2. It adds `STEPS` and `BMR` enum values. It deletes no health rows or mappings.
   It increments HA connection revisions to fence old worker sessions and resets
   their recovery cursor for bounded Withings reconciliation. Restart the HA worker
   with the new code as part of rollout; running an old binary can still import old
   mappings. No new environment variables or device credentials are required.
3. Legacy mappings remain stored but inert for rollback. Saving the three current
   Withings mappings through Settings replaces obsolete mappings, without deleting
   measurements. Check weight/body-fat/lean-mass entity IDs and diagnostic units.
4. Build/deploy Android from Ubuntu with the existing signing key:
   `./android/scripts/build.sh :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest`
   then `./android/scripts/deploy.sh`. Preserve app data with the normal update flow.
5. Grant the expanded Samsung read access, resume sync, run Sync now and inspect
   Vela Health. Deploy backend support first: an old server rejects new metrics.
   If a rejected batch was retained, repair the deployment and resume; discard the
   local pending snapshot only when a fresh read is needed.

The migration was validated on an isolated PostgreSQL schema. It was **not applied
to the application database** here; neither app was deployed to production/phone.
Enum additions are intentionally non-destructive and are not automatically rolled
back by downgrading application code.

## Galaxy S25 FE acceptance

- Grant all four READ types; verify denying/revoking one prevents upload and gives
  an actionable message. Regrant and resume both manual/background paths.
- Compare total and active against the exact Samsung labels throughout the day.
  Preserve the earlier calorie semantic caveat; never add active or BMR to total.
- Compare steps before/after watch delivery and subsequent correction. Repeat sync
  and check that one date does not grow by adding the same snapshot twice.
- After overnight sleep and after a nap, compare date and duration with Samsung;
  verify delayed/corrected historical sleep replaces the prior daily snapshot.
  Test the DST/repeated-hour/travel cases when feasible.
- Confirm an actual body-composition record contains BMR. Check Vela's kcal/day,
  measured timestamp, original date and labeled carry-forward on later dates.
  If Samsung supplies no BMR, expect Not recorded; do not infer a value from UI
  resting calories. No profile/forecast calculation is implemented.
- Weigh on Withings; confirm weight, body fat and lean mass still arrive via HA.
  Confirm old HA calorie/sleep controls are absent, new subscriptions omit them,
  and historical readings remain visible with source labels.
- Check offline recovery, app kill/reboot, credential revocation, interval changes
  and concurrent manual/background sync from the existing background checklist.
  Run `connectedDebugAndroidTest` on an authorized test device.

Remaining limits: no upstream deletion propagation; automatic corrections older
than seven days need explicit historical sync (latest BMR bootstrap is separate).
BMR scan cap is 1000 body records per query; missing BMR is not a computed estimate.
Current-zone historical attribution and exact SDK sleep-date behavior need device
comparison. Background timing and battery usage remain controlled by Android.
No #12 prediction, #94 communication, heart-rate or unrelated Health Connect work.

## Performed validation (2026-10-24)

- Android: `assembleDebug`, `testDebugUnitTest` (**29 passed**), `lintDebug`
  (**zero errors**, 22 warnings/one hint), and `assembleDebugAndroidTest` passed
  offline with the existing temporary JDK 17/SDK. Host `local.properties` restored.
  A test against the actual pinned SDK verifies the explicit inclusive-start /
  exclusive-following-date sleep filter; same-date endpoints would otherwise be
  empty under SDK defaults. Connected tests were compiled, not executed.
- Full Jest: **145 suites / 1,141 tests passed**, five opt-in database tests skipped
  in that run. The separate isolated PostgreSQL run passed all **five tests**,
  including expanded units/metrics, correction/replay, legacy-history retention,
  Samsung precedence and BMR carry-forward before/inside the query window.
- Prisma generation/validation, TypeScript and production Next.js build passed.
  Changed Health/HA TypeScript passes focused Oxlint/format checks; Stylelint and
  `git diff --check` pass. Broad Oxlint retains unrelated baseline unused-import /
  missing-brace failures; broad formatting retains 21 unrelated files.
- New coverage includes integer steps/ranges, sleep duration and DST query dates,
  BMR units/optional timestamps, invalid device payloads, rejected obsolete HA
  mappings, worker subscription filtering, new UI cards/history and source labels.
  The compiled recovery device test includes steps/sleep/BMR in the shared outbox
  replay and verifies new units/record provenance survive serialization.

No additional integrations, live phone claims, deployment or issue closure were
performed. Stop here for user review of the source matrix and real incoming data.

## Read-only investigation of missing today burn (2026-10-25)

This later verification supersedes the earlier local migration/deployment status
above. The running Next.js development server identified `/workspaces/vela` on
port 3000 (Next.js 16.2.9); Prisma CLI, Client and adapter are 7.9.1, and the
generated metric enum includes all eight kinds. All repository migrations were
applied, including `20261024120000_companion_source_matrix` and both diagnostic
migrations. No migration or health-data repair was necessary. Read-only ADB
package inspection confirmed Companion **0.3.1 (4)** on the Galaxy; older stored
diagnostic reports identify their original 0.3.0 upload version separately.

The latest inspected automatic attempt queried October 25 at about 02:17 in
`Europe/Amsterdam`. Samsung returned **zero rows** for today's total/active
calories, steps and sleep. The Companion omitted these missing readings and sent
28 historical/daily/BMR measurements. The matching server audit contained
successful per-measurement receipts, and SQL confirmed persisted rows with the
same owner, source, calendar dates, rounded values and capture/query metadata.
An incoming request or successful batch therefore did not imply a reading for
October 25. Why the SDK had no current-day rows is not established by this trace;
Vela must not substitute a projected/full-day diagnostic or a previous day's burn.

The existing `healthService.history()` returned Samsung daily readings through
October 24 and missing daily metrics on October 25. Body composition came from HA;
the actual older Samsung BMR point carried forward with its original date and
provenance. The Health router uses the authenticated owner and delegates to that
service; the view selects the period's final date. Its query refreshes every 30
seconds, and manual writes invalidate history. No separate cache or store caused
the missing total. Calorie balance used only the selected Samsung total.

Health now explains a missing selected-day total, shows a dated latest total
within the displayed period, and offers a button to inspect that measurement date.
It retains unknown today burn/balance. HA
same-date priority is now explicit for body metrics, matching the required matrix.
Regression coverage exercises all eight source selections through ingestion,
PostgreSQL and tRPC, competing newer sources, owner isolation, preserved rows,
BMR carry-forward/absence, missing today burn and the UI's recorded-date action.
All database test writes use an isolated randomly named schema, not real records.

Verification: 101 focused Health/Companion/HA Jest tests passed, plus nine isolated
PostgreSQL tests covering the API/audit and Health suites (using the documented
Prisma transform option). TypeScript, changed-file Oxlint/format and whitespace
checks passed. A read-only call through the real Health tRPC caller matched the
accepted Samsung total to its persisted row and returned missing today burn.
Both affected routes were visited in an isolated browser; they required sign-in,
so authenticated browser comparison remains unverified. The changed rendering and
date-button behavior are covered by component tests. Next.js runtime diagnostics
reported no current errors after those visits; a historical pg deprecation warning
remains in the development log. No production build/restart, new SDK query, or
manual health-data mutation was performed.

The subsequent [SDK/DST investigation](ANDROID_DST_INVESTIGATION.md) directly
verified all four grants and Samsung's Today display. The same elapsed queries
began returning today's calories and steps after Samsung Health was opened;
separate overlap-offset and cross-midnight capture defects were fixed in
Companion 0.3.2 (5), preserving the existing pipeline and source matrix.

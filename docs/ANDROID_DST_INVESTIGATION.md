# Samsung SDK date-boundary investigation (#92, 2026-10-25)

The earlier Health investigation established successful historical ingestion, but
did not establish why Samsung returned no current-day SDK values. This follow-up
used the existing Galaxy SM-S731B, Samsung Health 7.1.0.053, Data SDK 1.1.0 and the
paired Companion 0.3.1 (4). No Samsung health records, permissions, timezone or
clock settings were changed. No manual Vela upload was triggered for testing.

## Effective access and source data

A fresh `getGrantedPermissions` call at `2026-10-25T00:37:54.608602Z` returned READ
for **activity summary, steps, sleep and body composition**. Subsequent SDK reads
succeeded. There was no authorization exception, missing-permission exception or
SDK query error in that probe. An empty successful result is not evidence of
permission expiry. Samsung's [developer-mode guide](https://developer.samsung.com/health/data/guide/developer-mode.html)
documents Data Read access and package/signing verification, without prescribing
a daily expiry. The [SDK FAQ](https://developer.samsung.com/health/data/faq.html)
distinguishes missing consent from package/signature/scope authorization errors.

Opening the existing Data SDK developer-mode entry displayed Samsung's license
notice before its switches. It was cancelled without accepting a new agreement
or changing settings. Consequently the switch itself was not visually verified;
the effective SDK access and all four grants were verified directly. Do not
regrant consent or toggle developer mode merely because a query returns no rows.

Samsung Health's Today activity page did contain steps, active calories and total
burn, even while the preceding Companion diagnostics had returned no partial-day
calorie rows. The UI was observed between two SDK probes, so comparisons must
allow for elapsed time and display rounding. Private numeric readings and raw
reports are retained only in ignored local evidence, not this document.

## Query comparisons

All intervals are half-open. Local endpoints are exactly the `LocalDateTime`
values sent to `LocalTimeFilter`; UTC bounds below are their phone-zone
interpretations, not an additional SDK UTC filter. The phone remained in the
**first** 02:xx hour, at `+02:00`, during these observations. The fallback occurs
at `2026-10-25T01:00:00Z`.

| Query | Exact local interval | UTC interval | Start/end offsets | Result before opening Samsung Health |
| --- | --- | --- | --- | --- |
| October 24 completed day | `2026-10-24T00:00` → `2026-10-25T00:00` | `2026-10-23T22:00:00Z` → `2026-10-24T22:00:00Z` | `+02:00` / `+02:00` | One total row and one active row |
| October 25 elapsed day | `2026-10-25T00:00` → `2026-10-25T02:34:51.553200` | `2026-10-24T22:00:00Z` → `2026-10-25T00:34:51.553200Z` | `+02:00` / `+02:00` | Successful queries, zero total/active rows |
| October 25 full-day diagnostic | `2026-10-25T00:00` → `2026-10-26T00:00` | `2026-10-24T22:00:00Z` → `2026-10-25T23:00:00Z` | `+02:00` / `+01:00` | One tiny total row; no active row; not a usable replacement for the UI total |

The first refresh ran at approximately `00:34:51Z`. The subsequent opt-in SDK
probe captured `00:37:54.608602Z`, with today's local end
`02:37:54.608602+02:00`. It compared:

- October 24's completed day and October 25's elapsed/full day;
- total calories, active calories and steps;
- ungrouped and hourly grouped aggregation;
- explicit Samsung platform filtering and the builder's default source policy.

Every variant succeeded. The original ungrouped/platform-filtered elapsed query
now returned today's total, active calories and steps; steps matched Samsung's
Today display. Source-filter variants returned the same values. Hourly variants
also returned data. Sleep uses a date filter, not clipped midnight-to-now session
times: October 24 returned a duration and October 25 returned no duration. A later
Samsung Sleep detail visit confirmed **Today → Available after sleep**, with no
current duration. The follow-up body-composition reads returned no point on
October 24 or 25; an absent current BMR is not an authorization error and does not
justify estimating one.

The same query strategy recovered before any production query-code update. The
evidence supports delayed Samsung SDK data availability, temporally associated
with opening Samsung Health, rather than an empty application interval, lost
consent or a daily developer-mode expiry. It does **not** establish Samsung's
internal refresh trigger, nor prove that every future empty result has that cause.
Do not force-open Samsung Health in the background, change source authority, or
substitute a projected/full-day query for the elapsed query based on this sample.

Samsung's [total-calories reference](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/-companion/-t-o-t-a-l_-c-a-l-o-r-i-e-s_-b-u-r-n-e-d.html)
supports local midnight-to-now aggregation. Its [time-filter guide](https://developer.samsung.com/health/data/guide/features/filter-and-group.html)
distinguishes local-time, local-date and instant filters. The pinned AAR confirms
`LocalTimeFilter.of(start, end)` defaults to inclusive start/exclusive end. The
application's original full-day boundary already covered the correct **25 hours**.

## Date-handling defects corrected

Two application defects were independently demonstrated and fixed. Neither
explains the observed empty results **before** the fallback:

1. Resolving a captured local time again with `atZone()` loses its original offset
   during an overlap. For Amsterdam `02:30+01:00`, the old upload metadata and BMR
   instant filter incorrectly selected `02:30+02:00`, one hour earlier. A query
   window now retains its actual captured end `Instant`. Calorie/steps/sleep upload
   metadata and BMR instant queries use that instant; reports include both offsets
   and flag an ambiguous SDK local endpoint.
2. Calories and additional metrics previously captured their dates separately.
   Crossing midnight during calorie reads could give the additional metrics a new
   today while omitting the just-completed day. The coordinator now captures once
   after outbox replay, derives the reconciliation dates once, and shares those
   windows across the pass. Window eligibility uses instant ordering.

There is no fixed offset or date-specific branch. Version-1 upload shape, source
matrix, pending-batch replay, credentials, scheduling policy and historical rows
are retained. No total is calculated from active calories or BMR. Missing values
remain missing. SDK calorie elapsed/projected semantics still need broader
throughout-the-day validation; this is one live comparison, not a general proof.

The Samsung activity-summary/steps API accepts an offset-free `LocalTimeFilter`.
Retaining the captured instant fixes Vela's metadata and BMR ranges; it cannot add
an offset to that SDK API. Exact aggregation of the repeated hour remains a
physical acceptance check. Diagnostics explicitly expose this limitation.

## Reproducing the read-only probe

`LiveSamsungQueryTest` is skipped by default. It does not request consent, write
Samsung data, access Vela credentials, or call Vela HTTP. It emits private query
results to the instrumentation caller, not an application logcat stream. Run it
only intentionally, under the already-authorized original Companion identity:

```bash
./android/scripts/build.sh --offline :app:assembleDebugAndroidTest
# Install only the test APK; keep the paired application and its existing grants.
adb -s "$ANDROID_SERIAL" install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w -r \
  -e class space.aarondewindt.vela.companion.LiveSamsungQueryTest \
  -e velaLiveSamsungRead true \
  space.aarondewindt.vela.companion.test/androidx.test.runner.AndroidJUnitRunner \
  > /tmp/vela-live-sdk-queries.txt
```

Use the existing signing key. An isolated package has separate Samsung grants;
do not grant it access merely to run the synthetic regression suite. The probe
records exact local/UTC endpoints, offsets, source/grouping options, request and
response timestamps, SDK row bounds/values, pagination and typed SDK error codes.
Sleep records the actual date filter; BMR records its actual instant filter.
Never commit the output or a personal report. This session's ignored evidence is
under `.local/diagnostics/issue92-dst/`.

## Verification and rollout

- Offline Android verification passed: debug APK, **34 JVM tests**, lint with
  **zero errors** (20 warnings/one hint), and instrumentation APK compilation.
- The separate `diagnosticstest` package ran **11 synthetic phone tests** with no
  failures, including a clock advanced across midnight during SDK reads. The live
  SDK probe was skipped by default in that suite. Synthetic HTTP/credentials never
  touched the real pairing or application health records.
- Explicit live probes ran successfully under the already-authorized original
  package before and after the date fixes. The later probe emitted 41 observations
  (grants plus calendar/elapsed/group/source/sleep/BMR results). All SDK operations
  succeeded; missing sleep/BMR remained successful empty results. Numeric results
  are private local artifacts.
- Companion **0.3.2 (5)** was installed with `adb install -r`, using the original
  signing key. Pairing was retained, the outbox remained empty, the paused flag
  remained false and the existing last-success/status values were unchanged by
  the diagnostic/update operations. No phone timezone, developer setting,
  permission or sync interval was changed. The app was reopened normally to retain
  its existing background scheduling. No manual health sync or Vela health-record
  repair was performed.
- The existing scheduler subsequently ran without intervention at
  `2026-10-25T00:48:42.592372Z`: **31 measurements**, automatic/success, HTTP 200.
  Read-only server inspection confirmed **created** receipts for October 25 total
  calories, active calories and steps, matching persisted `samsung_health` rows.
  The real Health tRPC caller returned that day's stored total and steps. Today's
  sleep remained missing and the older actual BMR stayed labeled carry-forward.
  All three current-day uploads shared the same captured period end. This verifies
  the original pipeline naturally delivered today's newly available source data;
  it was not a forced test upload or a health-record repair. Private receipt/query
  evidence is saved alongside the SDK probes.
- The actual fallback-hour SDK behavior, Samsung's internal data refresh trigger,
  and long-duration developer-mode persistence remain unverified. Tests cover both
  occurrences of the repeated hour, spring-forward, the 25-hour completed day and
  midnight rollover. No web production rebuild/restart was needed for this Android
  change. The pre-existing host `local.properties` SDK-path warning remains; the
  container SDK environment builds successfully.

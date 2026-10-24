# Samsung Health calorie validation (#89)

This guide describes the #89 read-only diagnostics. The current app also supports
pairing, manual uploads and background sync (#90/#91); pause background sync when
performing diagnostics-only comparisons. Samsung Health writes remain unsupported. **The user accepted #89 for closure on 2026-10-24 after successful permission
granting and satisfactory readings on the Galaxy S25 FE.**

## SDK setup (Ubuntu host)

Checked against Samsung's official documentation on 2026-10-24:

- [Data SDK overview/download](https://developer.samsung.com/health/data/overview.html):
  Data SDK **1.1.0**, Samsung Health **6.30.2+**, Android **10/API 29+**, Java 17+,
  physical smartphones only (no emulator SDK support). The app's minimum SDK is
  now 29; the #88 JDK 17, Gradle, SDK platform/build-tools and host scripts remain.
- [Library setup](https://developer.samsung.com/health/data/guide/hello-sdk/app-module.html):
  local AAR, Gson and Parcelize. Samsung's page contains an older example filename;
  use the 1.1.0 download rather than the legacy `com.samsung.android.sdk.healthdata` SDK.

1. On the Ubuntu host, download **Samsung Health Data SDK v1.1.0** from the overview
   page. Review/accept Samsung's license yourself and sign in if prompted.
2. Extract the archive. Copy its `libs/samsung-health-data-api.aar` library to
   **`android/app/libs/samsung-health-data-api-1.1.0.aar`** in this checkout. If the
   extracted AAR includes a version in its name, use the library from that 1.1.0
   archive and rename it to this destination. Do not copy a sample application's APK.
3. The AAR is ignored by Git; do not commit the archive, signing key or personal
   health reports. No automatic download or license acceptance is built in.
4. The supplied 1.1.0 AAR's SHA-256 is
   `f5d3d83cf00b97d0bb1b1db4da076e861eb1c3e6e704d89a34e68909d2f38654`.
   This records the artifact used here; it is not a Samsung-published signature.
   Its embedded SDK version is 1.1.0 (code 1010004).
5. Build and verify from an Ubuntu host terminal at the repository root:

   ```bash
   ./android/scripts/build.sh :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
   ./android/scripts/deploy.sh
   ```

   `build.sh` always includes `:app:assembleDebug`. The dependency lockfile is
   already resolved; use `--write-locks` only for intentional dependency changes.
   Keep using the same host debug key as #88. The package remains
   `space.aarondewindt.vela.companion`.

The path-scoped Android CI requires repository secret
`SAMSUNG_HEALTH_DATA_SDK_AAR_URL` containing an HTTPS download URL for the licensed
1.1.0 AAR in private storage (for example, a signed URL; renew it when it expires).
Configure it privately in GitHub Actions settings if permitted by your SDK license;
do not publish the SDK or put the binary/base64 data in a GitHub secret. CI checks
the pinned AAR checksum. CI fails explicitly if the URL is unavailable (including
untrusted fork PRs); it
does not substitute a mock SDK or claim a Samsung build passed. No binary is
uploaded as a CI artifact. CI compilation cannot validate real phone access.

## Enable development reads on the S25 FE

This is a developer test setup, not a distribution/onboarding flow.
[Samsung's developer-mode instructions](https://developer.samsung.com/health/data/guide/developer-mode.html):

1. Update/open Samsung Health and complete its initial setup.
2. Open Samsung Health → ⋮ → Settings → About Samsung Health.
3. Tap the version line quickly at least ten times.
4. Open **Developer mode (Samsung Health Data SDK)** and review its notice.
5. Enable **Developer Mode for Data Read**. Do not enable writing or request a
   write access code.
6. Deploy/open Vela Companion. Tap **Grant / manage read access**, grant activity
   summary read access, then tap **Refresh readings**.

Only `Permission.of(DataTypes.ACTIVITY_SUMMARY, AccessType.READ)` is requested;
Samsung handles this consent, not Android Health Connect runtime permissions.
The current Data SDK guide does not prescribe the old SDK's manifest permission
metadata; it is not copied here. Package visibility is declared for Samsung Health.
The source manifest explicitly requests `android.permission.INTERNET` for the HTTPS
Vela client; the Samsung AAR also contributes it. This normal network permission
is separate from Samsung read consent. No cleartext exception is configured.
[Consent reference](https://developer.samsung.com/health/data/guide/features/data-permission.html).

Without developer mode, distribution needs Samsung partnership approval with the
package name, release-signing SHA-256 and permitted data scope registered. A
debug key, changed key or matching package name alone does not establish that
approval. Inspect your local identity with `cd android && ./gradlew :app:signingReport`
if investigating authorization. Do not commit keys. Read developer mode needs no
write access code. [Samsung app process](https://developer.samsung.com/health/data/process.html).

**Unverified:** whether Data Read developer mode and consent survive Samsung Health
restart, phone reboot, Samsung Health upgrade and app reinstall/signing changes.
Check these on the real device; re-enable/regrant only as necessary. Do not treat
this debug workflow as proof of production eligibility.

## What the screen reads

`health/HealthProvider.kt` is the small provider-neutral read contract.
`SamsungHealthProvider.kt` owns all Samsung imports, permissions, platform errors
and SDK queries. `ReadCalorieDiagnostics.kt` plans a manual refresh with a captured
clock and phone timezone. UI state/readings are held only in memory.

Each refresh independently requests both:

- `TOTAL_CALORIES_BURNED`: total energy, in **kcal**.
- `TOTAL_ACTIVE_CALORIES_BURNED`: active energy, in **kcal**. This is already part
  of total energy. It is displayed separately and never added to total.

See Samsung's [total](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/-companion/-t-o-t-a-l_-c-a-l-o-r-i-e-s_-b-u-r-n-e-d.html)
and [active](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/-companion/-t-o-t-a-l_-a-c-t-i-v-e_-c-a-l-o-r-i-e-s_-b-u-r-n-e-d.html)
API references. Their descriptions establish units/operations, **not whether a
particular Samsung Health UI total includes projected resting expenditure**.

Three ranges are displayed together:

| Range | Start inclusive | End exclusive | Purpose |
| --- | --- | --- | --- |
| Today to refresh time | Local midnight | Captured local refresh time | Elapsed-range request |
| Today full calendar day | Local midnight | Next local midnight | Probe potential future/resting contribution |
| Historical day | Selected day's local midnight | Following local midnight | Compare a completed day |

At exact midnight the empty elapsed range is omitted. A historical date must be
before today; select any completed date using `YYYY-MM-DD`. Boundaries use calendar
dates rather than adding 24 elapsed hours, including 23/25-hour DST days.
`LocalTimeFilter` operates on local wall times; UTC query bounds shown in the
report are **derived using the phone's current zone**, not evidence of the zone
in which historical records were recorded. Travel/DST overlaps need direct checks.

Queries explicitly use `AggregateSourceFilter.fromPlatform()` for Samsung Health's
platform activity summary. Samsung documents that activity summary deduplicates
phone and wearable activity. Individual watch/phone source attribution is not
available on these aggregate rows; the app does not invent it. No extra steps,
exercise or profile permissions are requested.
[Activity summary reference](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/index.html).

The raw report preserves unrounded floating-point values, null/empty results,
row count, request/response instants, returned row start/end instants, and phone/
Samsung Health versions. Query results are sequential, **not an atomic snapshot**;
wearable updates between queries can cause differences. Empty/null is unknown,
not zero; unexpected multiple rows are shown without silently summing them.
Samsung's aggregate bounds are interval bounds, **not** last measurement,
modification or wearable sync timestamps. Those timestamps are unavailable here.
[Aggregate result reference](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.data/-aggregated-data/index.html).

## Comparison procedure and completion gate

1. Let the watch sync to Samsung Health. Note phone timezone, Samsung Health and
   wearable versions, the exact Samsung Health screen/label, selected date, visible
   total calories and active calories, and the wall-clock time. Samsung Health's
   activity calorie goal is not necessarily its total calories display.
2. Refresh Vela, inspect both today ranges, and use **Copy diagnostic report** to
   retain the private report locally. Copying is explicit; there is no upload or
   automatic health logging. Returning from another app, rotating, editing the
   date or starting another action clears displayed results; copy before switching.
3. Compare the SDK values and the UI at nearly the same time. Record the UI's
   displayed precision and any difference from each SDK candidate. Do not round
   away a discrepancy in the raw record. Repeat a stable reading to distinguish
   UI rounding and sync delay from a persistent mismatch.
4. Repeat in the morning, midday and late evening, including a period with little
   activity and after a workout. If the full-day query exceeds the elapsed-range
   query early and the UI matches it, that is evidence worth investigating for
   projected resting energy; it is not conclusive by itself. If both SDK queries
   agree, that alone does not prove elapsed-only semantics.
5. Keep the same selected completed historical day and repeat after watch sync.
   Also compare yesterday and an older day with known activity. Note changes due
   to late data. Test just before/after local midnight: “today” must advance, the
   selected historical date must remain explicit, and yesterday's total may settle.
6. Test delayed wearable delivery: capture before sync, sync in Samsung Health,
   capture again, and note when the UI and each SDK value change. Refresh does not
   command a watch sync or guarantee Samsung Health has received new data.
7. Revoke Vela's read consent under Samsung Health → Settings → Apps, return and
   refresh. Verify permission status updates and no prior successful values remain.
   Deny/cancel a permission dialog, then grant again. Test missing/disabled/outdated/
   uninitialized Samsung Health where practical; setup errors offer an SDK
   resolution button when supported. Authorization errors identify developer mode/
   signing/account checks; query errors preserve the SDK numeric code for diagnosis.
8. Verify restart/reboot developer-mode persistence and large-font, dark-mode,
   rotation and scrolling usability. On the host, run the connected UI test:

   ```bash
   cd android
   ./gradlew :app:connectedDebugAndroidTest
   ```

   That test uses a fake provider to verify the UI; **it is not SDK feasibility proof**.

Maintain a private comparison record with these columns (do not commit actual
personal health readings):

| Captured time + zone | Date + UI screen/label | UI total/active kcal | Elapsed SDK total/active | Full-day SDK total/active | SDK code/permission | Watch sync timing + notes |
| --- | --- | --- | --- | --- | --- | --- |

Before closing #89, record an evidence-backed outcome: exact total value matches
an identified Samsung Health display with understood rounding/time-range/sync
behavior, and observed semantics are elapsed-day, projected-day, another explained
aggregation, or **inconclusive/failed feasibility**. If no SDK candidate reproduces
the UI total, stop and report that limitation; do not substitute Health Connect,
Home Assistant, BMR arithmetic or a guessed correction. Backend ingestion (#90)
and background work (#91) must not assume this gate passed.

## Implementation verification record (2026-10-24)

- The supplied AAR's embedded SDK version is 1.1.0 (code 1010004); Gradle enforces
  the recorded SHA-256. The AAR remains ignored by Git.
- Full `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug
  :app:assembleDebugAndroidTest --write-locks` passed using a temporary JDK 17 and
  Android SDK under `/tmp`, without changing the devcontainer or host SDK paths.
  An offline rerun with dependency locks enforced also passed.
  All **12 Android JVM tests** passed (11 diagnostic-domain tests and the source
  manifest test). Device tests compiled but were not run on a phone.
- Lint: **zero errors, seven warnings** — six dependency/build-tool update notices
  for deliberate fixed versions and the existing Android 12 backup-rule advisory.
- Nine existing Jest host-script tests, shell syntax, XML parsing and whitespace
  checks passed. APK inspection confirms Samsung's INTERNET permission plus the
  AndroidX internal receiver permission, with no health/write runtime permissions.
- User confirmed #89 permission granting works and the values look good on the
  S25 FE, then explicitly accepted the issue for closure (2026-10-24). USB/ADB
  shell and installation hangs cleared after disconnecting/reconnecting the cable.
- This is user acceptance, not an independently captured measurement record. No
  exact comparison values, elapsed-versus-projected classification, or individual
  midnight/watch-delay/revoke/reboot results were supplied. Keep the procedure
  above for further investigation; do not infer a specific calorie interpretation
  for future ingestion from this sign-off alone.
- The APK built in the container may use a different debug key. Run `deploy.sh`
  normally on Ubuntu so it rebuilds with your host signing identity; do not use
  `--no-build` with the container APK unless you deliberately share signing keys.

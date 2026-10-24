# Companion synchronization diagnostics (#103)

Dev Tools now opens **Planner** at `/dev-tools/planner`, with every existing task
generation/cleanup action preserved. **Companion App** at `/dev-tools/companion`
requires your Vela browser session. Existing public-server policy still hides Dev
Tools (including its protected tRPC procedures); use the private development app.
Device uploads work on the HTTPS public deployment independently of this UI policy.

## Using the two perspectives

In Android, **Sync history and debug logs** shows manual and WorkManager executions,
including unpaired, permission, SDK and network failures before ingestion. Expand
an entry to inspect its structured JSON. **Send debug logs to Vela** explicitly
sends the retained history and current diagnostic information. Refresh Samsung
readings first to include the current calorie query report; otherwise the snapshot
explicitly says that report is unavailable. No reading is required for uploading.
This action includes private health values when present. It does not upload logcat,
credentials, unrelated phone data or uncontrolled exception messages. Failure
leaves history and the health outbox untouched; retry using the button.

On the web, use the three views:

- **Server requests** records each request from an authenticated device, whether
  ingestion succeeds, fails validation, conflicts or rolls back. Details contain
  valid measurement values/units/dates and receipt results, or a classified safe
  error. Invalid payloads retain only safe correlation IDs and validation issue
  codes/paths, never raw rejected bodies or headers. Invalid/expired/revoked tokens
  have no trusted owner: they increment the existing fixed-cardinality global auth
  rate-limit counter, without creating attacker-controlled audit rows or retaining
  token/IP/header data. A valid identity missing `health:write` is audited as forbidden.
- **Uploaded device attempts** is the history the phone explicitly reported. It
  includes attempts that never reached Vela. Repeated uploads can contain the same
  attempt; this is a snapshot history, not a count of unique synchronizations.
- **Diagnostic uploads** lists snapshots and their app version, report and attempts.
  Open a snapshot or attempt, follow correlated records, or copy/download its
  private JSON. Device/date filters apply to snapshots; trigger/status/source
  filters apply to the separate request/attempt tables. Dates are inclusive UTC
  dates; displayed instants use the browser's timezone.

The device overview reports the last **uploaded** execution status, last reported
successful execution and app version/upload time. It never indicates live phone
connectivity. Server receipt time and device occurrence time remain separate. Old
companions work unchanged and show unknown trigger/retry/replay information.
Missing counts/durations are unavailable, not zero. Unparsed requests have an unknown source. Refresh reloads persisted data;
loading, errors, empty results and pagination are explicit.

## Identity, stages and health correctness

Each invocation of shared `HealthSync.run` gets a UUID operation/attempt ID before
waiting for its mutex. Automatic retries are separate executions, linked by the
WorkManager work ID and actual `runAttemptCount`; a periodic work ID alone is not a
unique execution. Requests inside an execution have their own timestamps/outcomes.

A newly persisted outbox receives a separate stable `batchId`, its originating
`attemptId` and trigger. Replays send the original body unchanged, including its
original measurement/capture times and IDs. Optional whitelisted HTTP metadata
(`x-vela-attempt-id`, `x-vela-trigger`, `x-vela-retry`, `x-vela-replay`) identifies
the **current** execution. The audit retains both current ID and originating body.
Older outboxes without IDs still replay unchanged. Correlation is observational,
not an idempotency mechanism: owner/device/source/metric/date and capture ordering
still govern ingestion. No receipt contract changed.

History checkpoints include credential/verification/permission, SDK reads, durable
outbox persistence, HTTP upload, receipt validation and acknowledgement. Calorie
queries retain actual result counts/values and ranges. Samsung steps, sleep and
BMR page queries retain actual requested ranges and row counts; these are SDK rows,
not counts of successfully uploaded measurements. BMR's scan cap, sleep-date
semantics, null handling and calorie semantics are unchanged. Other providers may
not expose internal additional-query details; absent details are not fabricated.
A successful fresh upload with known missing calorie aggregates is `partial`;
missing optional BMR alone is not an error. A fresh empty read is `no_data`, even
when a prior pending batch was replayed successfully (inspect request receipts).

All manual/automatic health operations still use the same mutex, persistent outbox,
permission checks before replay, retries/backoff and exact receipt validation.
Diagnostics never mark an outbox acknowledged. History persistence failures are
shown locally and never prevent health sync. After process death a previously
running, inactive entry becomes `interrupted`, with no invented end time/duration.
Cancellation and paused worker execution have distinct outcomes. History is stored
in separate app-private, backup-disabled preferences; credentials remain Keystore
encrypted. No credentials need replacement or new pairing scopes for this feature.

## Persistence, bounds and deployment

`CompanionEvent` holds independently observed `ingestion` records and uploaded
`attempt` records, with indexed owner/device/time/correlation fields. JSON details
are private diagnostics, separate from authoritative `HealthMetric` records.
`CompanionUpload` stores versioned reports and owns its snapshot attempts. Owner
and device deletion cascade; revocation blocks future uploads and retains existing
owner-visible history until expiry. Ingestion creates its audit before parsing or
starting the health transaction and completes it outside that transaction, so
rollback does not discard the audit. A crash can leave `received` without a final
outcome; it must not be interpreted as ingestion success. A database outage cannot
guarantee an audit write; failed receipt delivery remains safe to retry.

Apply both additive migrations and regenerate the client on deployment:

```bash
yarn prisma migrate deploy
yarn prisma generate
```

Migrations: `20261024220000_companion_diagnostics` and
`20261024223000_companion_unknown_counts` (unparsed counts are nullable).
Neither rewrites health records or pairing credentials. Deploy the new backend
before updating Android: older servers reject unknown payload fields. An automatic
sync paused by an old server's 400 response needs **Resume background sync** after
the backend is updated.

- Android: last 7 days, maximum 100 entries and 192 KiB encoded history; stages,
  queries and HTTP records also have bounded arrays. Snapshots trim oldest uploaded
  entries if necessary to fit the HTTP limit, without deleting local history.
- Server: 256 KiB streaming diagnostic request limit, 100 attempts/snapshot,
  32,000-character report, strict schemas and timestamp checks, secret-pattern
  redaction, two valid diagnostic uploads/device/minute and at most 60 retained
  snapshots/device. Ingestion retains its existing 64 KiB/100-measurement bounds,
  authentication rate limits and at most 2,000 recent audit rows/device.
- Server retention: 30 days by receipt time. Lists/details always exclude expired
  records; reads/writes prune expired rows. Schedule `yarn companion:prune` daily
  in the existing trusted runtime to physically remove data even during inactivity.
  For example, a daily system timer can invoke this command in the project directory
  with the normal database environment. It logs no payloads or secrets.
- Owner-only tRPC list/detail endpoints cap pages at 50 and correlated references
  at 50. Web export is explicit; protect downloaded files as health data.

## Verification and phone checklist

Use the Android toolchain from [the devcontainer guide](ANDROID_DEVCONTAINER.md):

```bash
cd android
./scripts/verify.sh --offline --rerun-tasks
./gradlew --no-daemon :app:connectedDebugAndroidTest
```

If the installed paired app has a different signing key, **do not uninstall it**.
Use its existing signing key for a normal `adb install -r` update. Fixture tests can
instead run in a separate package with the container key:

```bash
cd android
./gradlew --no-daemon -PvelaIsolatedDeviceTests=true :app:connectedDebugAndroidTest
```

This opt-in package is `space.aarondewindt.vela.companion.diagnosticstest`; it has
independent data/credentials and cannot establish the original app's live Samsung
access. Connected test-runner dependencies may need one online Gradle run before
`--offline` works. Restore the standard APK afterward by running the verification
script without the property. Do not use the isolated APK as an upgrade for the
paired package. Test reports are under `android/app/build/reports/androidTests/`.

On the normally signed, paired installation:

1. Update with `install -r`, launch, and confirm pairing and any pending snapshot
   remain. Sync manually; reopen the app and inspect the persisted manual entry,
   query counts, receipt and correlated server request on the private web page.
2. Wait for actual WorkManager execution and verify an automatic entry with work ID
   and retry count. Android controls cadence; forcing a fixture is not proof of
   long-term background scheduling or battery behavior.
3. Where practical, check permission denial, network loss, 4xx/5xx and retained
   outbox replay; restore connectivity/permissions without clearing pairing/data.
   Compare stable batch IDs and distinct current attempt IDs with server receipts.
4. Explicitly send logs with a current read report, then without one; inspect both
   snapshots in Vela. Failed upload must leave local history and health sync usable.
5. Verify dark mode, large fonts, rotation, browser filters/details/export and
   owner isolation. Logcat inspection should use the app PID/AndroidRuntime and
   must not publish private health information.

Automated synthetic tests prove boundaries, persistence and recovery, not Samsung
measurement semantics. Continue the [source matrix](ANDROID_SOURCE_MATRIX.md) and
[health validation](ANDROID_HEALTH_VALIDATION.md) checks for actual health values.

## Implementation verification record (2026-10-24)

All implementation is present in the local working tree; no source was committed
or published by this run. The local development database migrations were applied.
The #104 toolchain was already committed at `450afb8`; no devcontainer, host SDK,
relay configuration, signing key or `local.properties` changes were made.

| Command | Result |
| --- | --- |
| `cd android && ./scripts/verify.sh --offline --rerun-tasks` | Passed repeatedly after substantial changes: all 81 Gradle tasks, 29 JVM tests, debug APK, lint (zero errors / 24 advisory warnings), instrumentation APK. |
| `cd android && ./gradlew --no-daemon -PvelaIsolatedDeviceTests=true :app:connectedDebugAndroidTest` | First online connected run downloaded missing official UTP dependencies; all 8 tests passed on SM-S731B / Android 16. |
| `cd android && ./gradlew --no-daemon --offline -PvelaIsolatedDeviceTests=true :app:connectedDebugAndroidTest` | Final connected run: all 8 tests passed. Includes preferences/Keystore, Compose, durable replay/receipt validation, permission/SDK/network/HTTP/cancellation failures, automatic-trigger context, history bounds/interruption and explicit upload/auth failures. SDK/HTTP boundaries are synthetic. |
| `NODE_ENV=production yarn build` | Passed; all new pages and API routes compile, typecheck and build. |
| `yarn next typegen` and `yarn typecheck` | Passed after refreshing obsolete generated route types. Old `.next/dev/types` was moved to `/tmp/vela-pre103-next-dev-types`; source configuration was unchanged. |
| `yarn jest --runInBand` | Passed: 162 suites, 1,278 tests. Four database suites are opt-in; their 14 cases are skipped by default. |
| `VELA_COMPANION_DB_TESTS=1 VELA_HEALTH_DB_TESTS=1 VELA_DEVICE_DB_TESTS=1 yarn jest --runInBand lib/companion/database.test.ts lib/health/ingestion-database.test.ts lib/devices/database.test.ts --transformIgnorePatterns='/node_modules/(?!@prisma/client/)'` | Passed: 3 suites, 11 PostgreSQL integration tests, including both new migrations, audit survival of rollback, unchanged/stale replay, owner/cursor isolation, filters, bounds, retention and revocation. Each suite creates/drops its own schema. |
| `yarn prisma generate` / `yarn prisma validate` / `yarn prisma migrate deploy` / `yarn prisma migrate status` | Passed; both migrations applied and all 41 migrations current. |
| `yarn prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | Passed: no difference detected. |
| `yarn stylelint '**/*.css' --cache` | Passed. |
| `yarn companion:prune` | Passed against the local development database; no payloads logged. |
| `git diff --check` | Passed. |

Exact scoped lint and format commands (both passed):

```bash
yarn exec oxlint -c oxlint.config.mjs lib/companion app/dev-tools components/CompanionDevTools lib/health/ingestion.ts lib/health/ingestion-route.test.ts lib/trpc/root.ts components/NavbarNested app/api/devices/diagnostics app/api/health/ingest scripts/companion-prune.ts
yarn oxfmt -c oxfmt.config.mjs --check lib/companion lib/health/ingestion.ts lib/health/ingestion-route.test.ts lib/trpc/root.ts app/dev-tools app/api/health/ingest/route.ts app/api/devices/diagnostics/route.ts components/CompanionDevTools components/NavbarNested/NavbarNested.tsx components/NavbarNested/NavbarNested.test.tsx scripts/companion-prune.ts
```

Additional integration checks:

- A synthetic snapshot written by the actual Android uploader was retrieved from
  the isolated test app and passed the server's `diagnosticUploadSchema`, including
  its recorded SDK-query history and explicit unavailable-report state.
- `NODE_ENV=production yarn start --hostname 127.0.0.1 --port 3103` temporarily
  served the built app. HTTP requests to all Dev Tools routes showed the session
  guard; both device POST routes enforced the HTTPS-deployment guard (403 with the
  private HTTP auth origin). The database route tests separately verified 401/403
  authentication, valid uploads, real persistence and owner-only reads. The temporary
  server was stopped after testing; the normal public runtime was not restarted.
- `adb devices -l` found the authorized Galaxy S25 FE (`SM-S731B`).
  `adb -s R5CY92BD43Y install -r android/app/build/outputs/apk/debug/app-debug.apk`
  refused the original-package update with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
  No uninstall, data reset, credential removal or signing-key replacement followed.
  Connected tests used the opt-in separate package and launched synthetic Compose UI.
- `adb -s R5CY92BD43Y logcat -d -t 100 -s AndroidRuntime` returned no runtime crash
  entries during inspection. Subsequent ADB shell/Logcat operations temporarily
  stalled despite an authorized device listing. Reconnecting only the device
  transport restored access; the complete connected suite then passed again.

Intermediate failures were corrected and rerun: Gradle's restricted cache access
needed normal access to the existing volumes; offline connected tests initially
needed the official UTP dependency downloaded online; the Prisma database tests
needed the documented ESM transform flag; the test-only doze window adjustment
needed the Android main thread; a disconnected device interrupted a run; stale
Next generated route types needed regeneration. An initial sandboxed Next build
was stopped after stalling and the production build passed with required process/
network access. None required a development-environment redesign.

Repository-wide `yarn lint` and `yarn format:test` still fail on **pre-existing,
unmodified files**. Oxlint reports unused imports/variables, missing braces and
legacy `alert` calls in `app/client_layout.tsx`, `components/CurrentUserBadge`,
`components/DataView/ContentEditor.tsx`, `components/TodayView/CategoryPickerPane.tsx`,
`hooks/auth.tsx` and `lib/planner/{scheduling,service,store}.ts`. Formatting reports
20 existing files (auth/client styles, Planner/view/store code and Prisma config).
All changed TypeScript/TSX files pass scoped checks. These unrelated files were
left untouched.

### Remaining physical acceptance/setup

The existing paired phone app still needs an update built with **its original
signing key**, followed by the live checklist above: real Samsung manual and
scheduled attempts, current read-report upload, and correlation in the private
Companion web view. The container key cannot update that installation. No real
Samsung measurements or live diagnostic uploads from that paired installation
were claimed. The issue remains open for this signed-phone end-to-end acceptance;
there is no intentionally deferred implementation phase. Deploy the backend first
and schedule the daily retention command in the normal trusted runtime.

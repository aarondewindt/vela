# Shared Agent Handoff

This Git-tracked checkpoint records significant unfinished work between agents; it is not chat history. Keep credentials and private user content out of it.

**Status:** Issue #59 workspace foundation and #37 conversational planning implemented on `feat/59-planner-workspace` / draft PR #96. Live Ollama and authenticated browser acceptance remain; keep #37 open. Existing Android checkpoints below are historical.
**Last updated:** 2026-10-25

## Android automatic health sync investigation — 2026-10-25

- The supplied `partial` automatic attempt actually uploaded 28 measurements:
  HTTP 200, all receipts validated, outbox cleared; a read-only server audit check
  corroborated `automatic` / `success`. Earlier paused state lacks evidence of
  its original cause. Do not describe this as a demonstrated broken scheduler.
- Fixed SDK availability failures permanently pausing automatic work; they now
  use bounded retries and future periodic cycles. Permission/authorization still
  require intervention. Fixed missing preference observation in the status card;
  added eligibility/retry/stop details and explicit-upload scheduler/power/network
  diagnostics. Backend fields are optional and strictly validated. See
  [background sync investigation](ANDROID_BACKGROUND_SYNC.md#investigation-on-2026-10-25).
- Normal APK 0.3.1 (4) installed with original signing key and data-preserving
  update. Paired app was not launched; existing 15-minute work and credentials
  remain intact. Isolated instrumentation uses a separate package and synthetic
  credentials/SDK/HTTP. No server deployment or health-data repair was performed.
- Real scheduled background execution verified: Android started the absent process
  through SystemJobService at 00:30:46 Amsterdam with the screen off; WorkManager
  SUCCESS at 00:30:50, 28 measurements / 28 acknowledged receipts / retry 0.
  Server audit independently corroborated automatic / success / HTTP 200 for the
  same attempt. Outbox cleared, paused false, next periodic cycle registered.
  Start occurred approximately three minutes after eligibility; Samsung/Android
  connectivity-job batching was enabled. This verifies one real closed-app cycle,
  not all future device/battery conditions.
- Validation: normal offline Android verification passed, 30 JVM tests, zero
  lint errors (24 advisories / one hint), all 10 isolated device tests passed;
  42 focused Jest tests, TypeScript, scoped lint/format and whitespace passed.
  Next.js MCP diagnostics worked and reported no current errors. Browser UI
  acceptance was unavailable; no web UI was changed. Host-only `local.properties`
  SDK path still warns in the container; environment SDK discovery builds correctly.
- Expanded debug uploads need the updated backend schema deployed/restarted before
  use against an older runtime. Automatic health ingest remains compatible.
  Unplugged deep Doze, reboot, long-duration operation and real credential/consent
  revocation remain physical acceptance checks.

## Next.js DevTools MCP #106 — 2026-10-25

- Phase 1 implementation is in the working tree: official connector pinned to
  0.4.0 in both MCP configs, Codex startup timeout 60s, devcontainer extension
  installation and runtime workflow guidance. No Phase 2/3 or Android changes.
- Existing VS Code/devcontainer Codex tools successfully discovered Vela on 3000
  and returned project metadata, 36 routes, empty current errors and a readable
  log path. A fresh-cache pinned stdio connector repeated all calls successfully.
  Config parsing/preservation checks, `git diff --check` and `yarn typecheck` passed.
- Keep #106 open pending a rebuilt/reloaded VS Code container window and a new
  Codex conversation recognizing the pinned server and repeating the smoke check.
  This session cannot reload its own extension host. See NEXT_DEVTOOLS_MCP.md for
  commands, evidence, limitations and troubleshooting. Leave parent #105 open.

## Companion diagnostics #103 — 2026-10-24

- Entire implementation is in the current working tree, not committed/pushed:
  preserved Planner Dev Tools moved to its subroute; Companion UI has persisted
  server requests, uploaded attempts/reports, owner-only filters/pagination/details,
  correlation and JSON export. `lib/companion` owns schemas, audit, queries/retention.
- Android shared `HealthSync` persists bounded local execution history, SDK queries,
  HTTP outcomes and explicit report uploads, preserving the mutex, durable outbox,
  stable replay bytes and receipt validation. New batch IDs and current-operation
  headers are optional for old clients. No tooling/SDK/signing configuration changed.
- Both additive companion migrations are applied to the local database; regenerate
  Prisma Client on deployment and deploy backend before Android. Schedule
  `yarn companion:prune` daily. See COMPANION_DIAGNOSTICS.md for exact commands.
- Validation: 81 Android verification tasks / 29 JVM tests, zero lint errors;
  all eight connected tests passed on the Galaxy in a separate package using fake
  SDK/HTTP boundaries. Full Jest: 1,278 passed; 11 isolated PostgreSQL integration
  tests passed; production build, typecheck, scoped lint/format and migration drift
  checks passed. Whole-repo lint/format still have unrelated pre-existing failures.
- Phone installation retry succeeded on 2026-10-24 using the mounted original
  host debug key: `build.sh --offline`, then `deploy.sh --no-build --serial …`.
  Original-package `adb install -r` returned Success and MainActivity launched
  with Status: ok on the Galaxy SM-S731B; no uninstall or data clearing occurred.
  Keep #103 open for real manual/WorkManager Samsung sync and explicit report
  upload acceptance in the private web page. New code is not deployed to the
  normal public runtime. Earlier signing mismatch is resolved; earlier temporary
  ADB stalls recovered with a device reconnect and no host daemon reset.
- 2026-10-25: User restarted the web server. Fixed Dev Tools' RSC serialization
  error by moving Mantine/Next Link navigation into a client component; authentication
  stays in the server layout. Three page tests, typecheck and scoped lint/format
  pass; running Next.js reports no session/config errors after the change. Real
  sync/report acceptance above remains outstanding.

## Android devcontainer #104 — 2026-10-24

- Implemented headless JDK 17/SDK 36/Build Tools 35.0.0/ADB 37.0.1 in the existing
  image; SDK is cached in image layers, Gradle/signing data in named volumes with
  UID repair. Wrapper and licensed Samsung AAR remain unchanged. No #103 work.
- Option B uses container loopback TCP → private bind-mounted host Unix socket →
  Ubuntu loopback ADB server. Host script creates a 0600 socket in a 0700 folder,
  rejects wildcard/LAN ADB listeners; no USB passthrough or ADB published ports.
  TCP adapter supports Gradle/ddmlib as well as CLI. Ubuntu runs the relay manually;
  VS Code initializes the mount directory and starts the container relay.
- Actual image built and repeat build reused SDK/install layers. In-image non-root
  `verify.sh --offline --rerun-tasks`: all 81 tasks executed, 29 JVM tests, lint,
  debug APK and instrumentation APK compilation passed with no host/phone mount.
  Node/project Yarn 4/PostgreSQL CLI smoke, both Compose configs, volume persistence/
  UID repair, repeated relay startup, 15 Jest and seven Python relay tests passed.
  Real ADB through both relays used a protocol fixture, not a phone.
- Still needs user workstation rebuild/open with DinD/inner services and actual
  Ubuntu/Galaxy authorization, matching host/container device lists, install,
  logcat/instrumentation and host Studio breakpoint checks. Keep #104 open.
  Exact setup, commands, limitations and verification: ANDROID_DEVCONTAINER.md.

## Integrated task/theme conversation #38 — 2026-10-24

- Existing Today chat now has owner-bound inventory find/propose/revise tools,
  inline shared record-review cards, explicit deletion confirmation, match choices,
  ordinary Tasks links and planner/search/review cache invalidation. No new chat.
- `PlannerRecordProposal` persists preview state and transactional receipts linked
  to the Planner-scoped streaming conversation. Stable per-message identity blocks
  duplicate creates; current-message fencing, stale fingerprints, serial acceptance
  and superseded/discarded statuses protect retries and corrections. Interrupted
  pending cards recover independently of message persistence. Existing domain record
  services and lock ordering are reused; shared locks moved into conversation/transaction.ts.
- Dedicated revision tool derives target/action from the pending preview. Live
  qwen3:8b initially tried updating an unaccepted creation and omitted irrelevant
  nullable tool fields; optional tool arguments and the dedicated revision tool
  corrected tool invocation in synthetic smoke checks. Model prose can still
  describe previews imprecisely; canonical cards/explicit acceptance own state.
- Migration `20261024140000_planner_record_proposals` is additive and NOT applied
  to the application DB. Isolated PostgreSQL tests passed concurrency, replay after
  deletion, stale rejection, receipt-write rollback, theme relationships, status,
  creation corrections and destructive confirmation. No deployment/restart.
- Production build and TypeScript pass. Synthetic live model used production tool
  schemas with stub operations, not actual record persistence. Authenticated desktop/
  mobile acceptance remains; keep #38 open. See PLANNER_WORKSPACE.md for supported
  properties, persistence, deployment and acceptance. Final checks: full Jest 1,256 passed / eight opt-in skips; three isolated
  PostgreSQL checks passed; changed-file Oxlint/format, Prisma validation, TypeScript
  and production build passed. Sandbox build stalled, was stopped, and its stale
  lock removed after checking no build process remained; external build passed.

## Planner guidance and debug continuation — 2026-10-24

- Generation chat tool now takes only date/guidance. Removed chat-side hard
  classification/rejection and forced typed duration/free-time extraction; latest
  user request is preserved with bounded prior context for the existing scheduler.
  Deterministic constraints, typed application APIs and proposal approval remain.
- Planner stream now records owner-scoped `data-plannerDebug` parts: bounded model
  request, tool input/output/error, finish reason/token counts and status. Collapsed
  Mantine inspector streams/restores these beneath each response. Redaction,
  escaped text and payload/event bounds avoid raw SDK/config/header serialization.
- Planner uses Ollama think:false, 4,096 output tokens and a 150s deadline. Empty
  completions, output exhaustion, setup/provider/tool failures get visible text and
  persisted trace; cancellation remains distinct. Existing AI Dev behavior retained.
- Real AI SDK stream composition verified with a mock provider, then live qwen3:8b
  verified against all five production tool schemas with synthetic context and stub
  operations: generateDayPlan received durations and produced a complete visible
  response/card/debug trace. No real planning records were read or changed. No
  application migration/restart/deployment performed. Full Jest: 1,211 passed, five
  opt-in skips; TypeScript, production build and changed-file lint/format pass.
  #37 remains open for actual scheduler/browser acceptance.

## Conversational duration fix — 2026-10-24

- Fixed the broad unsupported-constraint response for normal remaining-day requests.
  Saved availability/current-time cutoffs, approximate durations, ordering and focus
  are supported. Prompt/tool schema distinguish these from unsupported restrictions;
  errors now name the restriction and do not advise reserving empty time for tasks.
- Existing AI scheduler selection supports optional per-task `plannedMinutes` for
  guided allocation; unguided fill ignores unsolicited model targets. Explicit
  `taskLimits` resolve task names/IDs against the owner's snapshot, share deterministic
  future-minute accounting with the proposal validator and survive revisions,
  corrections, regeneration and acceptance. No task estimate or schedule writes
  occur before normal explicit approval. No migration/dependency added.
- Full Jest: 1,199 passed, five opt-in skips; focused checks cover the reported mix
  of approximate duration, cleaning cap, main-task emphasis and practice. TypeScript,
  production build and changed-file lint/format pass. Live Ollama interpretation
  and authenticated browser behavior remain unverified. No application restart,
  migration or deployment was performed.

## Conversational planning #37 — Phase 2 — 2026-10-24

- Planner streaming now has typed owner-bound context, generation, edit/progress,
  review and explanation tools. Generation calls the same `generateDayPlan` as the
  ordinary UI; review uses `reviewDayPlan`; edits/progress reuse `planInstruction`
  and `proposalService.replan`. No task/theme CRUD or second scheduler.
- Conversation model/override remains independent of `planner.dayPlan` and
  `planner.planReview`. Tools cannot accept proposals or access arbitrary Prisma.
- Compact typed result parts restore inline application-owned preview/review cards;
  Apply/Discard/Revise and saved proposal controls retain canonical acceptance.
  Serial tool calls, deterministic request identities, saved-result recovery,
  owner/date checks and existing fingerprints/receipts handle retries and stale data.
- Explicit empty intervals are subtracted by shared availability for task/meal
  generation and retained as `freeIntervals` in proposal JSON for creation,
  correction/revision and acceptance checks. These constrain the proposal and its
  revisions, not later independent planning; use saved availability for persistence.
  Other hard restrictions report a limitation rather than becoming soft guidance.
- Transient workspace state contains preview/focus IDs only; TanStack Query owns
  proposal data. Calendar ghosts are labeled, cannot drag/resize or block manual
  placement, and task/block selections link across columns. Other zero-allocation
  outcomes are collapsed, while allocated/deadline-risk work remains prominent.
- No new migration or dependency. Phase 1's `20261024130000_planner_chat_scope`
  still needs normal deployment where not applied. No application DB migration,
  deployment, browser session or actual Ollama inference was performed here.
- Validation: full Jest 150 suites / 1,190 tests pass, five opt-in skips; final
  inline-preview focused run 63 tests and bounded-history/tool run 28 tests pass.
  TypeScript, production build and changed-file lint/style/format pass. Broad
  lint/format retain untouched baseline violations.
- See [workspace documentation](PLANNER_WORKSPACE.md) for tools, lifecycle, limits
  and live acceptance. Keep #37/#59 open pending actual model and authenticated
  desktop/mobile drag/resize/highlight/reload checks; #38/#39/#40 remain deferred.

## Planner workspace #59 — Phase 1

- Today retains candidate picker and DayView handlers, adds resizable Planner chat,
  and uses focused panes below `lg` without unmounting the chat.
- Shared AI Dev conversation/streaming factories and UI support separate Planner
  histories, `planner.conversation` model settings, streaming, retry and basic Markdown.
- Planner context is server-owned and bounded; chat has no mutation tools. Existing
  proposal generation/review/replan/acceptance controls are embedded in a planning
  card. See [workspace architecture and next steps](PLANNER_WORKSPACE.md).
- Additive migration `20261024130000_planner_chat_scope` must be deployed before
  runtime use. Prisma generated and schema validated; application DB not migrated.
- Full Jest passed: 1,165 tests, five opt-in tests skipped; the final Markdown
  rendering test also passed separately. TypeScript, Prisma schema validation,
  production build and changed-file lint/style/format checks pass. Repository-wide
  lint/format retain unrelated baseline failures. The build required running outside
  the sandbox after stopping a stalled sandbox build and removing its stale lock.
- Authenticated desktop/mobile drag/resize and live Ollama smoke checks remain
  manual; no browser automation is installed. Keep #59 open for later linked
  proposal highlighting and conversational tools. Do not close #37/#38/#73.

## Android manual synchronization #90 — 2026-10-24

- `/api/health/ingest` reuses scoped #93 authentication and bounds versioned JSON snapshots. `lib/health/ingestion.ts` validates local calendar intervals, units and capture times, and serializes owner/device/source/day snapshot upserts. Downward corrections replace prior values; equal retries and stale captures do not write.
- Additive migration `20261024100000_android_health_ingestion` adds ACTIVE_CALORIES and metadata to the existing store. Tested in an isolated PostgreSQL schema; **not applied to the application database**. Deploy it, regenerate Prisma and rebuild/restart before phone testing. No new dependencies or configuration secrets.
- Health shows separate total/active cards and Samsung query-capture/uncertainty labels. Calorie priority: manual override, Samsung Health, HA; active is excluded from balance. Owner/date series are never summed.
- Android Sync now uses existing Keystore credentials and HTTPS client, reads elapsed today plus the selected historical date, and reports progress/status/skips and persistent last-success time. No automatic retries/queue/background scheduler.
- Full Jest: 1,127 passed, four opt-in tests skipped. Separate isolated PostgreSQL ingestion test passed, including simultaneous retry, six-decimal precision, stale/corrected captures, owner isolation, HA/Samsung priority and manual override. Changed TS files pass lint/format and TypeScript passes. Repository-wide lint/format retain unrelated failures.
- Production `NODE_ENV=production yarn build` passed outside the sandbox. Inherited nonstandard NODE_ENV caused the initial prerender failure; restricted Turbopack stalled and its stale build lock was removed after confirming no build remained. No application deployment was performed.
- Android `assembleDebug`, `testDebugUnitTest` (17 tests), `lintDebug` (zero errors, ten advisory warnings), and `assembleDebugAndroidTest` passed offline with the existing temporary `/tmp/vela-android-toolchain`. Host `local.properties` restored. No connected tests or phone sync performed; rebuild on host to preserve Samsung signing identity.
- See [manual sync](ANDROID_MANUAL_SYNC.md) for deployment, full physical phone acceptance, API contract, calorie semantics and #91 recommendations. Stop for manual testing/review before #91.

## Device authentication #93 — 2026-10-24

- Generic account-owned hashed credentials and ten-minute, separate-secret pairing
  live in `lib/devices/`; external REST routes are under `/api/devices/`.
  Protected tRPC and Settings → Devices support review/approval/list/revocation.
  Android uses manual HTTPS pairing and AES-GCM Android Keystore storage.
- Apply `20261024000000_device_credentials` using `yarn prisma migrate deploy`,
  regenerate Prisma and restart. Only an isolated test schema was migrated during
  validation; the application database has not had this migration applied.
  Device issuance/verification requires canonical HTTPS `BETTER_AUTH_URL`; no new
  configuration secret. See [device authentication](DEVICE_AUTH.md) for contracts,
  rate budgets, recovery and complete verification steps.
- PostgreSQL tests prove concurrent redemption issues exactly one token, owner
  isolation, expiry, immediate subsequent-request revocation and atomic rate limits.
  Android device tests were compiled, not executed on a phone. Real pairing and
  Samsung calorie semantics must be verified before #90 ingestion work.
- Full Jest passed (1,104 tests before the final route/page tests); focused final
  route/settings checks pass. Changed files pass formatting/lint; repository-wide
  formatting/lint retain unrelated baseline failures; broad Stylelint also includes
  ignored generated Android test-report CSS. Normal production build and TypeScript
  pass outside the restricted sandbox. Webpack fallback encounters an existing
  Mantine schedule/rrule import error.

## Android #89 user acceptance — 2026-10-24

- User confirmed permission granting worked and calorie values looked good on the
  S25 FE, then explicitly requested closure of #89 and commit/push of the changes.
- ADB shell/install hangs resolved after disconnecting/reconnecting USB. No app
  logic fault was established; progress output and optional push install remain.
- No exact measurement values, elapsed/projected classification, or individual
  midnight/watch-delay/revoke/reboot outcomes were supplied. Record acceptance
  without inventing those results. Future ingestion must not assume semantics.
- Local Android build/JVM/lint/device-test-compilation and offline lock checks
  passed; connected device tests were not run by this agent. SDK AAR, local SDK
  paths, environment files, keys and private health readings remain outside Git.

## Phone deployment diagnosis — 2026-10-24

- User reports `deploy.sh` prints successful build/APK path but no visible phone
  change. Device listing works; install/launch success is not established.
- Added explicit installation/launch progress messages and opt-in `--no-streaming`
  for ADB push installation. Default install behavior is unchanged. Thirteen
  host-script Jest tests pass; shell syntax and diff whitespace checks pass.
- Subsequent shell test also hung. User disconnected/reconnected USB and confirmed
  communication worked, then confirmed successful Samsung permission/read access.

## Samsung Health diagnostic implementation (#89) — 2026-10-24

- Read #58/#88/#89, Android instructions/project and architecture/frontend/project
  documentation. Official Samsung docs currently list Data SDK 1.1.0, Samsung
  Health 6.30.2+, Android 10/API 29+, Java 17+, physical smartphones only.
- Added provider-neutral `HealthProvider`, typed query/result diagnostics and
  `SamsungHealthProvider` requesting only ACTIVITY_SUMMARY READ. Total and active
  calories remain separate; no missing-to-zero conversion, uploads, backend,
  persistence or background jobs. Samsung SDK imports stay in the adapter.
- Manual refresh queries today-to-captured-time, today's full calendar day and a
  selected completed historical day, with local/derived UTC bounds, raw returned
  aggregate rows, request/response instants, platform source filter and versions.
  Permission/manage action, resume recheck, partial query errors and actionable
  SDK errors/resolution are visible. Revoke/authorization failure discards data;
  explicit clipboard copy is the only export. Aggregate intervals are explicitly
  not measurement/last-sync timestamps; observed semantics stay UNVERIFIED.
- User supplied SDK archive's library as
  `android/app/libs/samsung-health-data-api-1.1.0.aar` (Git-ignored). Embedded version
  1.1.0/code 1010004 verified; SHA-256 recorded/enforced in Gradle. Samsung AAR
  contributes normal INTERNET permission; Vela has no backend client or upload
  path. Gradle prerequisite and CI missing-secret failures explain local setup.
  CI needs a privately supplied
  `SAMSUNG_HEALTH_DATA_SDK_AAR_URL` private HTTPS download URL repository secret, subject to SDK license.
- Kept #88 host scripts/devcontainer/web workflow; minSdk raised 28→29 for Samsung
  Health compatibility. Added documented Gson/Parcelize and explicit coroutines,
  regenerated only the six existing debug/test dependency locks. No unrelated
  web or local environment changes.
- Validation: 11 Kotlin/JUnit domain tests passed in a temporary JVM harness using
  the actual provider-independent production/test sources, Kotlin 2.3.10,
  coroutines 1.10.2 and JDK 17.0.21 under `/tmp/vela-android-toolchain`. Covers DST
  23/25-hour days, captured-time/midnight boundaries, completed dates, missing/null/
  multirow data, total/active separation, denial/revocation, query failure,
  authorization failure and cancellation. Nine existing Jest host-script tests
  passed. Dependency graph resolution and lock regeneration passed.
- Full Gradle `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug
  :app:assembleDebugAndroidTest --write-locks` passed (81 tasks) using the actual
  supplied Samsung AAR; offline rerun with enforced locks also passed. Temporary
  JDK/Android SDK under `/tmp` used without changing
  the devcontainer or ignored host local.properties. All 12 Android JVM tests pass
  (11 domain + manifest test). Lint: zero errors/seven warnings (six dependency/
  tool update notices and existing Android 12 backup-rules advisory). APK manifest
  verifies INTERNET from Samsung and AndroidX internal receiver permission only;
  no health runtime/write permissions. SDK binary stays ignored; no health data
  logged. Connected UI test and actual Samsung reads are not run here.
- See [validation guide](ANDROID_HEALTH_VALIDATION.md) for licensed SDK setup,
  host deployment, test commands and physical comparison/revoke/midnight/
  watch-delay/reboot gates. Rebuild on Ubuntu before installing so the host
  debug signing key is used; a container-built APK may have a different key.
- User subsequently accepted #89 for closure; see the acceptance checkpoint above.
  No server ingestion/sync (#90/#91) changes are included.

## Android completion confirmation — 2026-10-24

- User confirmed the build/deployment scripts work and the app launches on the
  S25 FE. This meets #88 acceptance; debugger, connected smoke test and layout
  checks remain explicitly unverified.
- Development port 3000 is now published on the LAN; Next.js development origins
  include hostnames from `BETTER_AUTH_TRUSTED_ORIGINS`. Deployment documentation
  covers LAN origin configuration. Android README clarifies ADB reverse is optional
  when the phone can access the desktop LAN address. Local environment files are
  excluded from the commit.

## Android host shortcuts — 2026-10-24

- User confirmed successful Ubuntu host build and USB installation/launch on the
  S25 FE. Added executable `android/scripts/build.sh` and `deploy.sh`, with shared
  JDK 17/SDK/ADB discovery. Java 25 remains the user's system default. Build accepts
  extra Gradle options/tasks; deploy checks device access before building, updates
  via `install -r`, then launches. `--no-build`, `--serial` and `ANDROID_SERIAL`
  support existing APKs and explicit devices. No automatic tooling installation,
  uninstall, network changes or devcontainer changes.
- README documents shortcuts and custom tool locations. Nine focused Jest tests
  pass with mocked Java/Gradle/ADB: path/argument handling, default SDK discovery,
  device selection, sequencing, incompatible JDK and failure propagation. Bash
  syntax and diff whitespace checks pass. Actual `build.sh --offline --no-daemon`
  with the temporary JDK/SDK succeeded; Gradle reported the expected inaccessible
  host SDK path in ignored local.properties, then used the temporary ANDROID_HOME.
  That local configuration was not modified. Deploy script itself is mocked here;
  the user's earlier manual phone install/launch is confirmed. Android Studio
  debugger, connected smoke test and layout acceptance remain manual gates.

## Android Companion Phase 1 (#88) — 2026-10-23

- Read #58/#88, root instructions, architecture/frontend/project docs and all
  existing devcontainer configuration. Follow the updated phase split: #88 is
  bootstrap/workflow only; Samsung Health feasibility is #89, secure device
  pairing/ingestion/manual sync #90, background synchronization #91.
- Added independent `android/` Kotlin DSL single-app Compose/Material 3 project,
  unconnected status screen, native vector from the existing Vela favicon,
  JVM manifest-permission test and compiled Compose device smoke test. No Samsung
  SDK, health/network/runtime permissions, credentials, API or schema changes.
  AndroidX injects its own signature-protected internal receiver permission.
- Pinned Gradle 8.13 (official generated wrapper/JAR and distribution checksum
  verified), AGP 8.13.2, Kotlin/Compose compiler 2.3.10, Compose BOM 2025.12.00,
  Activity Compose 1.12.4, API 36 and Build Tools 35.0.0, JDK/JVM 17, min API 28.
  `android/app/gradle.lockfile` locks resolved debug/test dependency versions.
  Separate path-scoped Android CI compiles APK/device tests, runs JVM tests/lint;
  its YAML was parsed locally, but the hosted workflow has not been executed.
- [Android README](../android/README.md) documents the shared host/container
  checkout, JDK/SDK setup, host build fallback, optional container tooling,
  local.properties path conflicts, signing identity, S25 FE USB authorization,
  install/launch/debug commands, connected tests and physical acceptance steps.
  Host `adb reverse tcp:3000 tcp:3000` uses existing Ubuntu-loopback publication;
  no dev-server LAN exposure or host ADB/USB sharing with the container.
- Validation: temporary JDK 17.0.17+10, SDK command-line tools 19.0 and SDK packages
  under `/tmp/vela-android-toolchain`, without modifying the devcontainer image.
  Wrapper `clean :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
  :app:assembleDebugAndroidTest --write-locks` passed; a second clean build with
  `--offline` and enforced lockfile also passed (81 tasks). JVM test: one pass.
  APK metadata verifies app ID, launcher, min/target SDK, and absence of network/
  health permissions. Online lint: zero errors/five warnings (four deliberate
  older-version notices and one Android 12 backup-rule advisory); offline lint:
  zero errors/one backup-rule warning. No app data is stored in this shell.
  XML parsing, wrapper shell syntax, ignore rules, web `yarn typecheck` and
  tracked-file whitespace checks passed. Existing devcontainer, package.json,
  yarn.lock and web runtime code are unchanged; no service restart or deployment.
- Remaining gate: use **host** Android Studio/ADB to install and launch on the
  real Galaxy S25 FE, check rotation/font size/light-dark behavior, hit the
  `MainActivity.onCreate` debugger breakpoint and run
  `./gradlew :app:connectedDebugAndroidTest`. Device test APK compilation does
  not establish physical-device success. The same README records recovery and
  networking checks. No issue/PR comments, commits, publishing or merges made.

## Discover URL metadata (#75) — 2026-10-22

- Implemented on `feat/discover-personal-backlog` for existing [PR #74](https://github.com/aarondewindt/vela/pull/74).
  Quick URL add opens the saved editor; explicit metadata retrieval previews
  individually selected title/description/cover replacements. Refresh leaves
  manual and unsaved fields intact; ordinary versioned save applies selections.
- Protected `refreshMetadata` delegates to the owner-scoped service. Network
  work runs outside transactions and checks version/URL again on snapshot write.
  Nullable JSONB `sourceMetadata` retains provider/source/final URL, site name,
  fetched values and retrieval time separately from editable fields. Existing URL
  identity/deduplication and manual creation remain authoritative.
- Server HTML extraction supports title, OG, Twitter, simple microdata and JSON-LD.
  Fetches pin public DNS answers on each hop, block private/reserved/transition
  addresses, allow standard HTTP/S ports, use fresh connections and bound redirects
  (3), total time (8s), headers (16 KiB) and HTML (1 MiB). No scripts/resources run
  or load. Failures preserve the last successful snapshot; empty/partial results,
  loading and retry remain explicit. See [Discover](DISCOVER.md).
- Migration `20261022140000_discover_metadata` adds only nullable JSONB.
  **It has not been applied to the running database.** Prisma Client regenerated;
  schema validation and live database diff confirm exactly the new column. A
  temporary-table PostgreSQL transaction verified existing-row preservation,
  nullable defaults, JSONB round trip and unchanged manual title, then rolled back.
- Validation: all 1,068 Jest tests / 138 suites; focused Discover 105 tests / six
  suites; TypeScript, scoped Oxlint/formatting, Stylelint and production build pass.
  Repository-wide lint/format retain failures in unchanged Planner/auth/UI files.
  No public restart/deployment or merge. Provider-specific integrations remain
  follow-ups; web metadata is UTF-8 HTML only and retains the latest successful
  snapshot rather than retrieval history.

## Planner meals, AI default and routine review — 2026-10-22

- Review PR: [#72](https://github.com/aarondewindt/vela/pull/72), unmerged.
  #55/#41 received implementation/evaluation comments; #17 was revised directly
  to overnight sleep and routine boundaries. All three issues remain open.
- Dedicated branch `feat/planner-meals-ai-default`, based on master after merged
  PR #65. Implements #55 with opt-in versioned breakfast/lunch/dinner preferences
  on existing PlannerGenerationSettings and unique per-plan DailyBlock.mealKind.
  AI and deterministic proposal generation/replanning place continuous meals before
  optional work; explicit adjustments become fixed and skipped/cancelled identity
  prevents regeneration. Meal progress hides task completion/estimate controls.
- AI remains Today's default; omitted generate API mode now also defaults to AI.
  Existing deterministic selection is the model-free rollback through the same
  validator/proposal path. Reports add meal outcomes and safe timing/count diagnostics;
  model errors expose finite codes without provider bodies/prompts.
- See [meals](PLANNER_MEALS.md), [evaluation](PLANNER_EVALUATION.md) and
  [routine review](PLANNER_ROUTINES_REVIEW.md). Retain/revise #17 for overnight sleep;
  no generalized routines, Nutrition integration, #69/#70 or category migration.
- Additive migration `20261022010000_planner_meals` applied to the application
  database at the user's request on 2026-10-22, after a fresh private backup in
  ignored `.local/backups`. Archive listing and a full restore into a temporary
  database passed; the temporary database was removed and a private SHA-256 checksum
  saved. All 32 migrations are applied, database-to-schema diff is empty and Prisma
  Client regenerated. Old previews may need regeneration.
- All 962 Jest tests / 132 suites, TypeScript, scoped lint/format, Stylelint and
  production build pass.
  Global lint/format retain baseline errors in untouched source portions.
  Repeatable `scripts/evaluate-planner.ts` passed real PostgreSQL/qwen3:8b checks:
  version races, concurrent acceptance, task-writer lock/stale rejection, owner isolation,
  deferred recurrence, uniqueness, manual meal identity/fixing and zero-churn replan.
  Disposable databases removed. Three successful model runs: 2.0–9.0 s, three meals,
  3–5 of five tasks received time; overload remainder explicit in every run.
- Keep #41 open for broader daily-use/explanation review. Browser tooling is not
  installed; desktop/mobile interaction remains manual testing. Greedy ordering varies;
  PTO/NO_WORK availability and existing REST semantics remain unchanged. Public application
  server was not restarted. The application database migration is applied as noted above.

## Settings PR #65 feedback — 2026-10-21

- Current branch remains `feat/restructure-settings`. Follow-ups on #46, #30,
  #27 and #23 plus #66 are implemented in the same PR. Settings sections are
  nested in the main navbar; the dashboard uses the live Nutrition summary,
  including fiber. Fiber has no default target and can be cleared.
- Nutrition and Health histories use shared Mantine goal lines and shaded finite
  bands; separate nutrient charts keep references clear. Settings → Health adds
  optional weight/body-fat/sleep targets with shared semantics and owner/version
  fencing. Existing Health readings and missing-data behavior are retained.
- Food picker/catalog and Tasks list default to semantic search (honoring saved
  catalog opt-outs). Tasks retain view filters/sorts and combine conventional
  matches with up to 50 related tasks. Published collection models and maintainer
  setup remain authoritative; expected inference/configuration failures fall back
  with a notice, empty queries skip inference. No automatic model download/rebuild.
- Created #67 for calculated lean mass as requested in #23; calculation and
  lean-mass goals remain deferred.
- Migration `20261022000000_health_metric_goals` passed a rolled-back temporary
  table check, then was applied after a private database backup. All 31 migrations
  are applied; database/schema diff is empty; Prisma Client regenerated. Live
  service checks verified metric goal persistence/clearing, owner isolation,
  version conflicts, older-caller preservation, history propagation and fiber
  defaults/clearing. Synthetic users/data and temporary script removed.
- Validation: all 910 Jest tests / 129 suites, TypeScript, production build,
  changed-file Oxlint/format, Stylelint and whitespace checks pass. Global lint
  and format still report baseline failures in untouched files. No browser
  automation was available; React tests cover navigation, dashboard, charts,
  goal editing and default/fallback search. Public application was not restarted.

## Compact task recurrence settings (#51 follow-up) — 2026-10-21

- Task View's Recurrence row now shows a short saved cadence/weekday summary and
  an Edit button; disabled recurrence leaves the summary blank. Settings open in
  a modal using the existing validated editor, including enabled state, rule,
  anchor and timezone preference behavior.
- Cancel discards local edits, save failures remain visible, cancellation is locked
  during saving, and successful saves close the modal. Refetching updated task
  timestamps does not remount the editor before its completion callback.
- Validation: all 31 Task View tests (7 suites), TypeScript, scoped Oxlint/format
  and whitespace checks passed. No migration or application restart is required.

## Goal milestones and fiber (#47 follow-up) — 2026-10-21

- Added shared optional preferred targets inside ranges (fat and signed calorie
  balance), and minimum/preferred/excellent milestones (protein and fiber).
  Decimal boundary validation checks ordering; bars/labels use red below minimum,
  orange after minimum, green at preferred, and cyan at excellent, with expanding
  scales and marked thresholds. Minimum goals have no overage failure.
- Fiber now has a nullable persisted goal, settings, daily summary card, macro
  history series and daily history column. Unknown fiber stays unknown; partial
  known intake remains separately labelled. No dietary amounts are prescribed.
- Migration `20261021230000_goal_thresholds_fiber` adds fiber and converts legacy
  protein exact goals without tolerance to minimum semantics, retaining amounts
  and advancing optimistic versions. Explicit ranges/maxima/nonzero tolerance
  bands remain intact. Older callers retain saved fiber and semantic options.
- A fresh private backup was created and its archive verified. Migration SQL passed
  fixture checks on temporary tables in a rolled-back transaction, then was applied
  locally. All 30 migrations are applied and database-to-schema diff is empty.
  Prisma Client regenerated; no application process was restarted.
- Validation: full Jest suite passed (852 tests / 116 suites), then the final
  milestone/range persistence additions passed focused UI/service tests. TypeScript,
  Prisma validation, scoped Oxlint/format and whitespace checks passed.

## Health, recurrence, goals and shell (#48/#51/#47/#9/#5) — 2026-10-21

- Branch `feat/health-recurrence-goal-improvements`. Health carries only body
  composition forward, including pre-window readings, with original date/source/
  entity/timestamp/identity and explicit carried labels. Charts show actual samples;
  sleep, daily burn and missing balances remain date-specific/unknown.
- TaskView exposes recurrence rule, enabled flag, timezone metadata and lead time.
  Rule validation reuses the scheduler's supported subset. Calendar recurrence
  supports an editable anchor date with task creation as the fallback; timezone is stored but not interpreted by the
  scheduler. Changing/disabling recurrence retains existing occurrences and plans.
  Conversational recurrence edits remain excluded from the interpreter schema.
- Shared goal evaluator and controls support minimum, maximum, target/tolerance and
  range semantics. Existing amounts retain exact target semantics until configured.
  See [goal semantics](GOAL_SEMANTICS.md) for compatibility and follow-up scope.
- Planner conversation and goal semantics migrations were subsequently applied to
  the local app database after a verified private backup. All 29 migrations are
  applied; Prisma Client regenerated. No application process was restarted.
- A follow-up aligns `TaskIndexJob` with its existing SQL: keep the trigger-required
  `updatedAt` database default alongside Prisma `@updatedAt`, and declare the existing
  `ON UPDATE NO ACTION` relation explicitly. No migration or persisted-data change
  is needed; Prisma's database-to-schema diff is now empty. A fresh backup and a
  rolled-back temporary-table check verified the actual enqueue trigger creates and
  refreshes jobs with timestamps. The five worker tests and TypeScript passed.
- Global primary text is softer; dimmed text meets 4.5:1 contrast on dark surfaces.
  Desktop header height/offset is zero at `sm`; the mobile menu remains available.
- Validation: route type generation, TypeScript, Prisma validation, all 807 Jest
  tests (113 suites), Stylelint, and scoped lint/format checks passed. Full lint
  and format checks still fail on existing repository issues, including untouched
  portions of `lib/planner/service.ts`; no new lint errors remain.
- Follow-up feedback on #47 restores nutrient bars across goal types, with markers
  near 90% initially, expanding overage scales, desired range/tolerance bands and
  semantics-aware colors. Screen readers receive actual amounts/bounds/status.
- #62: unset task recurrence timezones default to the user's saved preference.
  Saved task timezones, manual edits and explicit clearing take precedence; opening
  the editor does not persist a value. Loading/errors remain visible and retryable.
- #48, #51, #9 and #5 were closed at the user's request; #47 and #62 remain linked
  to PR #61 for review. No new migration is required for these UI follow-ups.
  Validation: all 825 tests (115 suites), TypeScript, Stylelint, scoped Oxlint/format
  and diff whitespace checks passed.
- Recurrence anchor follow-up: TaskView exposes a calendar anchor date; clearing it
  restores the UTC creation-date fallback. Legacy generation and proposal validation
  share the same resolver; task-review sources include the anchor. Existing
  occurrences/plans are retained. Migration `20261021220000_task_recurrence_anchor`
  adds a nullable DATE column without rewriting existing task dates. It was applied
  after a fresh verified backup; the live database-to-schema diff is empty.
  Latest validation: all 839 tests (116 suites), TypeScript, Prisma validation,
  scoped lint/format and whitespace checks passed.
- Dynamic goals, non-daily periods and recurrence occurrence reconciliation
  are follow-ups. No deployment/restart or automatic merge is part of this batch.

## Planner conversation (#37/#38) — 2026-10-20

- Added authenticated **Planner → Conversation** with saved turns, reference/date/time
  clarification, follow-up corrections and application-owned plan/record previews.
  Shared proposal generation/review/edit/progress services handle plans. Task/theme
  mutations reuse existing record services, with extracted shared patch schemas and
  optional transaction clients. Theme deletion retains tasks with no theme.
- Classification and interpretation use centralized `planner.conversation`; explicit
  relative due dates resolve against the user's timezone. Pending creations retain
  earlier fields during correction; pending plan additions can move/resize/replace
  in place. Superseding/discarding previews does not apply changes.
- Owner scope, stable message IDs, revisions, expiring generation tokens, source
  fingerprints and durable acceptance receipts cover ambiguity, stale edits, retry
  duplication and concurrent acceptance. Deletion requires a separate checkbox/button.
  Short transactions share existing proposal table-lock ordering; model calls run
  outside locks. See [Planner conversation](PLANNER_CONVERSATION.md) for supported
  properties, bounds and concurrency costs.
- Migration `20261020180000_planner_conversations` and DBML updates are included;
  client generated. **Migration is not applied to the daily-use database.** Apply
  through the documented backup/deploy procedure before using the new page there.
  No public restart/build, existing-user mutation, commit or GitHub issue change.
- Validation: all 748 Jest tests (105 suites), TypeScript, scoped new-code
  lint/format, Prisma validation and an isolated Turbopack production build passed. Twenty synthetic PostgreSQL/
  `qwen3:8b` assertions cover actual rollback on receipt failure, concurrent acceptance,
  replay after deletion, stale rejection, timezone-aware creation and follow-up.
  Desktop/390px production-browser checks passed task acceptance, regular Tasks view
  refresh and shared plan preview/apply without runtime errors. Temporary databases,
  servers and fixture users were removed. Full lint still fails on pre-existing
  curly-brace/unused-import errors, including unchanged lines in planner/service.ts.

## Semantic task search (#7) — 2026-10-20

- Today now offers debounced hybrid task search with a semantic toggle, conventional
  fallback and loading/empty/retry states. AI guidance uses shared
  `retrievePlanningTasks`; future review/replacement consumers can use the same service.
  Eligibility filters apply before semantic top-k; all important candidates bypass
  match limits. Placement/acceptance still revalidate deterministic constraints.
- Task insert/update triggers transactionally enqueue coalesced owner refresh jobs,
  covering editor, review and planner writers. Cascading deletion removes vectors.
  `yarn tasks:index` supplies renewable leases, revision fencing and retry/backoff;
  Planner → Fuzzy task search queues retries and shows job status. Settings retains
  published model configuration and maintainer controls.
- Additive migration `20261020090000_task_index_jobs` applied after a private backup;
  client generated. Eight synthetic PostgreSQL assertions passed in a rolled-back
  transaction. Existing users’ task/plan records and published embedding configuration were
  unchanged; no private queue was processed. Worker runtime setup and limits: [semantic task search](SEMANTIC_TASK_SEARCH.md).
- Validation: all 692 tests (97 suites), TypeScript, scoped Oxlint/format, Prisma
  validation, worker startup and an isolated default Turbopack production build passed.
  Optional Webpack compilation fails on the Mantine schedule/rrule default export;
  dependencies were unchanged. No live browser automation was run.
- Worker is not started as a persistent process; deployment has no repository supervisor.
  Queued refreshes persist until `yarn tasks:index` runs; conventional search remains available.
  No public build/restart or GitHub mutation performed.

## Remaining-day replanning (#36) — 2026-10-20

- Added deterministic `planningProposals.replan` and `lib/planner/proposals/replan.ts`:
  extend, finish, postpone, skip, cancel, replace and replan remaining flexible work.
  The pure bounded placement search runs outside database transactions; saving and
  acceptance recheck the existing owner fingerprint. No migration or model call.
- New finish/extend/skip operations preserve identity/history. Actual finish records
  whole-minute duration once and keeps the task/occurrence open by default. Explicit
  completion closes only the selected recurring occurrence, or a nonrecurring task.
  Future flexible allocations of completed work are released; protected/other-day
  commitments require explicit resolution. Extension can include an explicitly reviewed
  increased total task estimate, applied in the same transaction.
- Downstream work keeps order, duration and valid original times where practical.
  Necessary moves leave ten minutes to review; imminent future blocks can move too.
  Started/calendar/resolved work stays protected. Future manual/fixed edits require
  explicit selection. Unfit allocations become explained cancellations retaining tasks
  and unfinished effort. Optional pull-forward fills earlier gaps. Reservations stay.
- Today adds **Adjust remaining day**; its inspector now opens **Progress & replan**
  with the selected block instead of using legacy direct outcome/removal shortcuts.
  Preview shows statuses, estimate/completion changes, downstream moves and omissions.
  Unresolved preview requests retain their retry ID; a successful preview permits a
  fresh request with the same form values, including after placement expiry.
  See [Replanning](REPLANNING.md) for semantics, limits and legacy API differences.
- Validation: 669 tests in 94 suites, TypeScript, scoped proposal/UI lint/format and
  an isolated Turbopack production build passed. Thirty-four synthetic PostgreSQL
  assertions passed, including concurrent acceptance, request/receipt replay, owner
  isolation, partial/explicit/recurring completion, stale rejection and real rollback
  after an injected receipt failure. Fixture users/data were removed.
  Existing TodayView curly-brace lint failures remain; no browser automation was run.
  No public build/restart, migration, existing-user plan mutation, commit or GitHub
  issue mutation was performed. The isolated build used a temporary source copy.
- Limits: preserve whole downstream blocks rather than splitting, reordering or adding
  backlog work. Generate plan can fill remaining capacity afterward. Legacy outcome,
  unskip, drag/drop removal/time edits and clear-plan APIs retain earlier behavior;
  clear-plan still deletes history and the old outcome API closes an occurrence per
  completed segment. New progress/replan controls do not use those paths.

## Task reviews (#32) — 2026-10-19

- Implemented saved task reviews in `lib/task-reviews/` and the task inspector:
  explained summary, priority/size/total effort, definition-clarity focus scale,
  due risk, next steps and blockers. Facts, inferences and missing information
  are displayed separately. Centralized `planner.taskReview` inherits Balanced/default.
- Reviews now also suggest Theme, Category, Brief and Tags, with explicit clearing/
  inheritance and replacement-tag semantics. New generation restricts theme references
  to active owner-scoped choices; acceptance revalidates theme ownership/activity.
  Source v2 includes available theme versions and prompt v2 requires all assessments;
  saved v1 reviews remain readable and require regeneration before acceptance.
- Review snapshots capture task/theme/dependency versions, notes, occurrences,
  blocks, check-ins and the owner's current local date. Source/prompt changes
  invalidate acceptance. Selective one-time acceptance applies only selected
  properties in a short locked transaction; inference cannot mutate task properties.
  Day planning can reuse bounded fresh review summaries as advisory context.
- Migration `20261019230000_task_reviews` applied after `yarn db:backup`; generated
  Prisma Client updated. See [task reviews](TASK_REVIEWS.md) for source bounds,
  assessment semantics and table-lock concurrency limits.
- Full Jest, TypeScript, scoped lint/format and Prisma validation passed. Seventeen
  synthetic PostgreSQL/Ollama checks with `qwen3:8b` passed; test users/data removed.
  The four-field extension passed 53 focused tests and a further synthetic
  PostgreSQL/Ollama generation/acceptance check; its temporary user/data were removed.
  Existing users' planning records were not changed. No production build or browser
  automation was run. Earlier uncommitted scheduler work was preserved; all issue
  #32 changes remain uncommitted.

## Scheduler sparse-day correction

- User reported the October 20 plan containing only five blocks. A read-only,
  owner-scoped inspection matched the shared task names and confirmed the actual
  standard windows: 08:00–08:45, 12:00–13:00 and 17:15–24:00 (510 minutes).
  The accepted AI proposal had no guidance, scheduled 165 task minutes and left
  twenty eligible candidates unattempted. Existing private planning data was not changed.
- `generation/intent.ts` now makes unguided planning try the AI shortlist first,
  then remaining eligible candidates in urgency order, without an unrequested model
  work cap. Guided focus/light-day selection and caps remain preserved. Actual
  placement still uses the same availability, remaining effort, reservations, rest,
  preservation and application validator. The UI reports the goal, budget, additional
  candidates and actual windows. No availability setting is changed.
- A read-only simulation around the five accepted blocks fits 330 additional task
  minutes. No proposal was saved or applied for the existing user. Regeneration can
  fill remaining open time without moving the already accepted blocks.
- Unguided schema output uses an empty omission list. One repeated-reference
  correction is allowed within a shared 120-second inference deadline, followed by
  strict reference validation; this addresses a duplicate exposed by live fill testing.
- Focused tests cover broad fill despite a small model shortlist/cap, explicit light
  and zero-work requests, standard weekday capacity, visible availability and bounded
  correction. All 601 tests (86 suites), TypeScript, scoped lint/format, an isolated
  production build and desktop/390px browser checks pass. Twenty-seven synthetic
  PostgreSQL/Ollama checks pass with `qwen3:8b`, including default fill and explicit
  light-day guidance. Fixture users/data were removed; public builds/server and the
  existing user’s planning records were not changed.

## Scheduler preview, fragmentation and explanation correction

- User authorized fixing the expired preview, tiny partial blocks and misleading
  day-part explanations shown in their pasted late-evening plan.
- Generation now leaves ten minutes after placement calculation (rounded up) for review.
  Reports save an optional earliest-start `reviewBy`; pending previews display it,
  update expiry from a local clock, disable Apply after expiry, and offer regeneration
  with the saved method/guidance. The server still rejects past starts with an explicit
  fresh-preview error. No accepted plan or saved preview is shifted automatically.
- Intact placement across all compatible windows precedes partial packing. Generated
  partial task blocks and their remaining work are at least ten minutes; short gaps
  stay unused. Whole short tasks and manual edits retain existing validation.
- `generation/report.ts` computes the displayed summary and per-task explanations from
  actual blocks/minutes/times. Raw AI selection summary/reasons are saved in additive
  optional fields and displayed under a collapsed pre-scheduling assessment. The prompt
  includes the future review cutoff/clipped availability and forbids placement claims.
  Existing proposal JSON remains readable; no migration is required.
- Focused validation: 108 tests passed, covering the pasted evening pattern, ten-minute
  review with subsequent expiry rejection, intact later slots, tiny remainders, short
  whole tasks, factual reporting and UI expiry/regeneration. Existing 23 synthetic
  PostgreSQL/Ollama checks passed with `qwen3:8b`; desktop/390px browser preview/apply
  passed without runtime errors, and temporary fixture users/data were removed.
  All 591 tests (85 suites), TypeScript, scoped lint/format and an isolated production
  build passed. Public builds/server and existing private planning data were untouched.

## Scheduler reference-handling correction

- User reported "unknown, repeated or missing task references" during real AI generation.
  The initial implementation required copying full task/occurrence UUID keys and exhaustively
  accounting for every candidate, so a useful subset selection could fail because some
  other candidates were unmentioned.
- `lib/planner/generation/selection.ts` now provides short request-local C1/C2 aliases,
  an output schema enum restricted to the current pool, exact server-side identity mapping,
  and explicit unscheduled outcomes/warnings for unmentioned candidates. Unknown,
  duplicate and contradictory references still fail. No task selection is inferred for
  unmentioned work. Dependency context uses the same aliases instead of competing UUIDs.
- Validation: all 580 Jest tests (84 suites), including 58 focused generation tests,
  TypeScript and scoped Oxlint/format passed.
  A live `qwen3:8b` run on 32 synthetic tasks selected two and left some other candidates
  unmentioned, successfully reproducing the old rejection case and verifying the fix.
  No existing user's tasks/plans were read for that live check or changed.

## Completed task: AI day planning (#34)

- User authorized #34 on 2026-10-19. `lib/planner/generation/` and protected
  `planningProposals.generate` now provide AI selection/order with optional guidance,
  application-owned placement, explanations/omissions/remaining work/deadline risks,
  and an explicit deterministic alternative. [AI day planning](AI_DAY_PLANNING.md)
  records usage, limits and validation. Today generates proposals instead of legacy drafts;
  planning settings remain separate, and previously saved legacy drafts can be accepted.
- Model feature `planner.dayPlan` inherits centralized Balanced / Default LLM settings.
  Due/important candidates bypass semantic top-k exclusion. Guidance uses owner-scoped
  fresh-vector semantic search with explicit pending/unavailable warnings and current-data
  fallback; no private index was rebuilt or processed. Context is bounded to 60 candidates
  including every due/important occurrence; excess mandatory candidates require explicit
  deterministic planning. Overall candidate bound is 1,000. Reports identify all remaining
  eligible work, unsupported recurrence/blockers and defaulted estimates.
- Existing proposal JSONB stores actual model attribution and generation reports; no migration.
  Validated new LEISURE reservations are previewed and inserted inside existing atomic
  acceptance. Supported selected-day recurring candidates stay virtual until acceptance;
  RECURRENCE origin and task/date uniqueness prevent duplicate occurrence creation. No
  backfill or closed-occurrence resurrection. Existing blocks/reservations stay unchanged
  during generation; explicit movement/replanning remains #36.
- Saved generation request replay precedes model/current-input resolution. Changed request
  inputs conflict. No-change reports return `id: null` without persistence. Model/schema
  failures leave the plan unchanged. Application placement validates task-boundary finishes,
  rest after busy meetings, category/session continuity, DST and current work budgets.
- Validation: 23 synthetic PostgreSQL/Ollama checks passed with actual `qwen3:8b`, including
  light-day guidance, preview isolation, deferred recurrence, atomic leisure reservations,
  owner isolation, stale rejection and duplicate acceptance. Real desktop/390px browser
  checks passed for unavailable-model errors, deterministic generation, preview/apply and
  overflow, without runtime errors. Fixture users/data were removed. All 570 Jest tests
  (83 suites), TypeScript, scoped Oxlint/format, repository Stylelint and isolated
  production Turbopack build pass. The same seven pre-existing TodayView curly-brace
  lint failures remain (verified against HEAD); that unrelated code was preserved.
  No public build/server or GitHub issue mutation was performed.

## Scheduler replacement checkpoint (#18 / #31 / #33)

- User confirmed #31–#41 are native sub-issues of #18, authorized #31, then explicitly
  authorized continuing with #33. [Scheduler policy](PLANNER_SCHEDULER_POLICY.md) separates
  current generator behavior from the replacement contract. The user chose up to 30 extra
  minutes beyond the session target only to finish the current task.
- #33 is delivered through `lib/planner/proposals/`, protected `planningProposals` procedures,
  `PlanningProposals` and Today → Plan changes. [Planning proposals](PLANNING_PROPOSALS.md)
  documents API, persistence, limitations and setup. The #34 checkpoint above supersedes
  the original generation deferral.
- Proposal creation persists typed JSONB operations/preview without changing the plan. Acceptance
  checks owner/current-input fingerprint and revalidates under short table locks covering legacy
  writers, then atomically writes changes and a replayable receipt. Locks currently serialize
  planner writes across users; reads continue. This conservative tradeoff is documented.
- Add/move/resize/remove/replace and REST blocks are supported; UI composes single changes,
  API supports batches. Protected manual/fixed/active/history/calendar blocks cannot be changed;
  #36 will add explicit protected-work adjustments. Moves retain identity; removals/replacements
  cancel old blocks and retain history/task linkage. Remaining budgets, session/rest limits,
  earliest starts, ownership and availability/category constraints are validated.
- Additive migration `20261019190000_planning_proposals` is applied locally and client regenerated.
  Private backup completed first. Existing tables/data were not rewritten. Legacy APIs retain their old behavior; Today now uses #34 proposal generation.
- Validation: 539 Jest tests (81 suites), TypeScript, scoped Oxlint/format and production build
  pass. Thirty-three synthetic PostgreSQL/service checks cover owner isolation, creation/discard,
  replay, concurrent acceptance, competing proposals, legacy concurrent writes and real rollback
  after an injected receipt-save failure. Desktop/390px browser preview/apply checks pass with
  no runtime errors; temporary fixture accounts/data are removed and browser sessions signed out.
- Legacy gaps remain outside the proposal path: clear deletes completed blocks and completion of
  one segment closes its occurrence. The #34 path above defers new recurring occurrences
  until acceptance; broader retrieval remains #7.
  The new path protects historical blocks and never implicitly completes work.
- Native issue dependency corrections: #34 uses #33; #38 depends on #37. #7 includes semantic
  retrieval/index freshness/fallback requirements. #18 owns the overall work breakdown.
- Existing UI changes for #8/#1/#6 and #31 policy/tests are still in the working tree; preserve them.
  No public build/restart or GitHub issue mutation was performed.

## Completed task: user AI model settings

The user approved centralized per-user defaults, named profiles, per-feature overrides and chat/draft switching, then explicitly requested implementation. The profile label is **Vision language**. Inherited chats/drafts follow updated settings on their next generation; explicit overrides persist.

- **Settings → AI & models** (`/settings#ai-models`) centralizes Default LLM, Fast, Balanced / Medium, Reasoning, Vision language and Embeddings, plus feature choices for Nutrition meal interpretation, AI Dev chat and the embeddings playground. `lib/model-settings/` owns boundary validation, the feature/profile registry, PostgreSQL preferences and deterministic precedence. The low-level `lib/ai/` still receives explicit selections and remains independent of Prisma.
- New conversations/drafts start on **Use settings**. Existing ones retain their old model as an override; switching back to inheritance is explicit. Models can change between messages, with owner/lease/revision checks preventing changes during generation. Each response/interpretation stores its actual provider/model; historical replies keep their attribution. Completed request replay does not need a configured default or another model call. Incomplete retries use the current selection and replace the incomplete attempt.
- Migration `20261018192243_user_ai_model_settings` is applied locally and Prisma Client regenerated. It adds account model preferences, inheritance flags and reply/turn attribution, backfilling existing fixed selections. Normal manual Nutrition workflows have no new model dependency.
- Vision language settings require reported chat+vision capabilities. Fast/Balanced/Reasoning may inherit Default LLM; Embeddings never falls back to a text model. Profiles choose models; existing feature thinking policies stay explicit (meal interpretation disables thinking). There are still no image-upload features or automatic provider/model fallbacks.
- Shared task/food index model and instruction controls moved to Settings; feature pages retain status and owner indexing/retry actions with a Settings link. Published collection configuration and maintainer permissions remain authoritative. A personal Embeddings default can prefill setup/rebuild selection but never changes existing query vectors or initiates a rebuild. No private index queue was processed.
- Validation: all 400 Jest tests (58 suites), TypeScript, changed-code Oxlint/format, repository Stylelint, Prisma validation/empty schema diff and production build pass. Twenty-one isolated PostgreSQL/service checks and browser flows with synthetic fixtures cover inheritance, ownership, model snapshots/switching, completed replay without defaults, shared-index stability, actual chat/meal generation and inherited embedding output. Settled 390px Settings/Embeddings views have no overflow; browser runtime errors are empty. Temporary accounts/data are removed and the isolated browser is signed out/closed. Repository-wide lint retains existing errors in untouched planner/auth/UI files. See [AI settings](AI.md#user-model-settings).

## Active task: Nutrition

The user approved the [Nutrition architecture proposal](NUTRITION_PROPOSAL.md), explicitly authorized Phase 1 and subsequently Phase 2 on 2026-10-18. The supplied specification requires approval before the next major phase. The user subsequently authorized Phase 3, and on 2026-10-18 explicitly authorized continuing directly into Phase 4 while they are busy.

- The manual tracker is delivered at **Nutrition → Diary** (`/nutrition`), **Food products** (`/nutrition/products`) and **Daily goals** (`/nutrition/settings`). [Nutrition](NUTRITION.md) records current behavior, implementation, validation and limits.
- `lib/nutrition/` contains protected procedures, owner-scoped catalog/diary/goals services, conventional search, snapshot validation, decimal calculations, exact aggregation and calendar-date helpers. `components/Nutrition/` supplies responsive catalog/diary views, inline product creation, manual entry previews/editing, daily summary and nullable goal controls. No model/provider is required.
- Migrations `20261017233210_nutrition_products` and `20261017235835_nutrition_diary` are applied locally and Prisma Client regenerated. Models: unified Product/Serving, reserved recursive Component, historical LogEntry and one current Goals row per owner. Custom SQL enforces numeric/reference/source/snapshot/date invariants and default-serving/request uniqueness. Schema/database comparison reports no differences.
- Explicit gram/millilitre/named-serving bases, physical sizes/density and estimated flags avoid invented conversions. Decimal strings cross the API; isolated Prisma Decimal arithmetic persists half-up at eight places. Display formatting uses one decimal without changing stored values. Product/serving IDs are stable across edits; catalog writes are atomic and versioned, preserve provenance and respect component dependencies.
- A diary entry captures the complete direct definition/conversions and source in versioned JSONB (`schemaVersion: 1`, `calculationVersion: direct-v1`), plus decimal nutrient totals and original quantity/unit. Editing quantity/date/meal never fetches mutable Product/Serving data. Product deletion uses SetNull; the saved serving ID deliberately has no live FK. Deleted/archived sources remain historically editable. Unsupported snapshots fail safely. Recipe support needs an explicit compatible snapshot extension in Phase 5.
- Logging uses a per-owner request UUID/hash to deduplicate concurrent submissions and replay completed requests. New entries check a locked product version before capturing a consistent source; entry/goal versions reject stale writes. Foreign references are denied server-side. Removal is explicit and confirmed in the UI.
- Diary dates are validated `YYYY-MM-DD` strings and PostgreSQL DATE values. Today uses saved user timezone; date URL parameters survive navigation/reload and goals round trips. Goal fields are nullable positive user-entered values; none are prescribed. Current goals apply to every date; date-effective goal history is deferred.
- Validation: all 253 Jest tests (33 suites, including 56 Nutrition tests), TypeScript, changed-file Oxlint/format, repository Stylelint and final production build pass. Phase 2 added 39 live API/PostgreSQL checks covering snapshot immutability after serving/product edits, archival and physical deletion, duplicate/concurrent writes, goals, dates, authorization and constraints. Phase 1 previously passed 37 live checks. Browser checks cover inline product creation without premature logging, entry create/edit/meal move, date navigation/reload, goals/return date, removal and totals; desktop/390px layouts have no horizontal overflow, and runtime diagnostics are clean.
- Repository-wide `yarn lint` retains existing Oxlint errors in untouched auth/planner/UI files. Production builds were run with `NODE_ENV=production` outside the restricted sandbox. All temporary users/products/entries/goals were removed and the isolated browser signed out/closed; no credentials or verification routes were committed.
- Phase 3 is delivered: opt-in hybrid search in catalog/picker, dedicated `nutrition.products.semantic` / `product_embeddings`, relevant-field source timestamp, immediate archive cleanup, shared maintainer checks, durable revision-coalesced owner jobs and `yarn nutrition:index` worker with lease/retry recovery. Migration `20261018001956_nutrition_product_search` is applied and client regenerated. Product staging bounds were originally 1,000 active documents / 2,000,000 vector values; the authorized NEVO workflow now uses 10,000 / 12,000,000. All 271 tests, TypeScript, scoped lint/format, Stylelint, production build and 21 synthetic-only PostgreSQL/Ollama checks pass; mobile fallback UI and runtime diagnostics pass. Existing private queue remains untouched following an auto-review rejection of unrestricted startup; `--check` passed and synthetic-only indexing was approved. Maintainer model selection and a supervised worker are explicit operational setup, documented in NUTRITION.md.
- Phase 4 is delivered: shared `lib/ai/structured.ts` bounded schema generation; Nutrition-owned typed correction operations, persisted revisioned JSONB draft items/snapshots and saved turn rows; conservative exact matching and unresolved candidate/unit/quantity handling; manual review/correction, URL/list resumption and transactional confirmation via the shared diary insertion helper. Three-minute generation leases, stable request IDs and revision checks protect retries, expired work, manual edits and late replies. Changed products refresh the preview and require another confirmation; confirmed status replays saved entry IDs without duplicate logging. Migration `20261018015500_nutrition_meal_drafts` is applied and client regenerated.
- Final validation: all 301 Jest tests (44 suites), TypeScript, scoped lint/format, repository Stylelint, Prisma validation/empty schema diff and production build pass. Phase 4 added 30 synthetic-only live model/PostgreSQL checks, plus browser flows for meal parsing/correction, saved reload, manual 3.5-slice quantity, confirmed totals, changed-source renewed review, immutable history, unavailable model and discard. Desktop/390px layouts fit, runtime diagnostics are clean, all fixture users/data removed and browser sessions signed out/closed. Initial llama3.1:8b replies could omit foods/category despite valid schema; operation-first output, explicit multi-food instructions and non-thinking generation passed the end-to-end qwen3:8b fixtures. No model is silently selected/switched; review stays mandatory. Product search now forwards a 12-second cancellation signal through the shared engine; task defaults stay unchanged.
- The user explicitly authorized NEVO upload/update after Phases 1–4, using `docs/datasets/NEVO2025_v9.0.csv`: 2,328 foods, 53 per 100 ml, seven unknown fiber values. Delivered catalog upload/preview/apply with English primary names and full Dutch/synonym aliases; stable owner/source/code updates; unchanged-file no-ops; protected manual edits by default with explicit replacement; preserved servings/density/archive/manual products; retained absent codes and immutable diary history. Food aliases support 240 characters. `Product.sourceSnapshot` stores all original source columns separately from user overrides, with RIVM source/version attribution in calculation displays. Migration `20261018070046_nevo_source_snapshot` is applied and client regenerated. [NEVO](NEVO.md) describes the workflow and constraints.
- NEVO validation: all 330 tests (48 suites), TypeScript, scoped lint/format, repository Stylelint, Prisma validation/empty diff and production build pass. Thirty-four full-file PostgreSQL checks cover owner isolation, idempotence, release updates, original snapshots, edit protection, retained conversions/archive/missing codes, history, concurrent/stale plans and forced rollback. Real browser file upload/import, English/Dutch search, repeat no-op, explicit edited-field replacement, stale-preview recovery, invalid-file errors and mobile layout pass; runtime diagnostics are clean. The supplied CSV and user-created `docs/.gitignore` are untouched. All temporary data is removed; no existing user account was populated or indexed.
- The user explicitly authorized Phases 5 and 6 together on 2026-10-18. Recipe editing/calculations, graph consistency and recipe snapshots, 7/30-day history, recent/frequent foods and snapshot-preserving meal copying are implemented. Migration `20261018074350_nutrition_recipes_history` is applied and client regenerated. All 360 Jest tests (53 suites), TypeScript, scoped lint/format, repository Stylelint, Prisma validation/empty schema diff and production build pass. Thirty-nine isolated PostgreSQL/service checks cover nested recipes, concurrent cycles, source-change review, historical edits after source deletion, copy retries/stale sources, ownership, history/suggestions and NEVO updates. Browser checks cover recipe creation, fractional logging, copying original snapshot values, recent/frequent selection, 7/30-day charts and signed-out access. Settled 390px history and picker layouts have no horizontal overflow, runtime diagnostics are clean, fixture accounts/data are removed and the isolated browser is signed out/closed. Repository-wide lint/format retain failures in untouched files. Existing shared task indexing remains manual. Maintainer product model setup and the documented supervised `yarn nutrition:index` process remain explicit operational steps; no existing private food queue was processed.
- The previous AI implementation checkpoint below is retained as context; its validation describes earlier work.

## Objective and scope

Phases 1–4 delivered shared Ollama infrastructure, saved chat and a temporary embeddings playground. Subsequent authorized work added pgvector, reusable persistent collections, a task adapter and a separate Planner fuzzy-search test page. Existing task pages and services were intentionally left unchanged. Indexing is manual and this is an experiment, not final task-search integration.

## Relevant files

- `lib/ai/`: shared server-only discovery, resolution, errors and embedding model identity/digest resolution.
- `lib/ai-dev/`, `components/AiDevView/`, `components/EmbeddingsView/`: saved chat and temporary embeddings playground.
- `lib/embeddings/`: reusable collection adapter contract, validated configuration, batching, inference, leases and atomic rebuilds.
- `lib/task-search/`: task text preparation, dedicated vector persistence, owner-scoped exact search, maintainer checks and protected tRPC procedures.
- `app/planner/task-search/page.tsx`, `components/TaskSearchView/`: authenticated experiment, index status, manual incremental indexing, semantic search and maintainer model/rebuild controls.
- `prisma/migrations/20261017211829_task_embedding_collection/`: additive collection metadata and task vector table; applied locally, client regenerated.
- `.devcontainer/postgres/`, migration `20261017210033_enable_pgvector`: pinned pgvector 0.8.7 on PostgreSQL 18 Alpine, repeatable SQL dimension tests and extension activation. Existing data volume retained.
- `docs/AI.md`: current APIs, configuration, persistence, collection semantics, operational limits and validation.

## Decisions and invariants

- One active model/configuration per dedicated vector table, independently configured across collections. No global embedding model or mixed-model rows. `tasks.semantic` owns `task_embeddings`; source `tasks` remains separate.
- Configuration is stored once in `EmbeddingCollectionConfig.configuration` (validated JSON), with revision and lease metadata. Task vectors contain source FK/hash/timestamps, not per-row model choices.
- Unconstrained pgvector column supports collection-wide dimension changes without schema migrations; common inference validates configured dimensions and finite/nonzero float32 values. Exact cosine search supports larger vectors without approximate-index dimensional limits.
- Full rebuilds generate all users' vectors in memory outside transactions, verify digest/source consistency, and replace vectors plus configuration in one short transaction. Failed attempts retain the previous index. Five-minute renewable leases fence concurrent and abandoned publishers; searches check the configuration revision before querying vectors.
- Ordinary indexing and search are owner-scoped. Only server-designated maintainers may switch models and rebuild the shared collection across users. The user explicitly chose this scope and authorized the provided test account as maintainer.
- `EMBEDDING_MAINTAINER_USER_IDS` is a comma-separated server-only allowlist. The authorized test account was added to ignored `vela.env` and `.env.local`; no IDs/credentials were committed. Missing configuration denies maintenance operations.
- Task text includes title, brief, first step, sorted tags and extracted BlockNote text. Style/URL/editor metadata is ignored. Manual indexing reuses hashes; metadata-only updates refresh the source timestamp without inference. Search excludes timestamp-stale rows before ranking. Task deletion cascades to vectors.
- Query instruction is collection configuration, editable by a maintainer only through a full rebuild. Raw queries are available by leaving it empty. Model digest is checked before/after inference; mutable-tag replacement requires rebuilding.
- Existing chat persistence/authorization, stable IDs and lease/retry behavior remain intact. See `docs/AI.md` for its protocol.

## Current local state

The shared task index contains the original 32 tasks with `qwen3-embedding:0.6b` and 1,024 dimensions. A complete switch to installed `qwen3-embedding:4b` (2,560 dimensions) was verified and then restored to 0.6b. Temporary verification routes, fixture users/tasks and their vectors were removed. The dedicated test browser was signed out and closed.

## Limits and next scope

Indexing is synchronous and full rebuilds stage vectors in server memory. There is no durable worker, cancellation guarantee on browser close, automatic indexing from existing task edits, approximate index or calibrated matching threshold. New/changed tasks require **Index my tasks**. Future work needs explicit scope: more collection adapters, retrieval-quality evaluation, automatic indexing or a durable large-collection rebuild strategy.

Keep the ignored Ollama and maintainer settings aligned between `vela.env` and `.env.local`; container environment changes require recreation unless Next.js loads a local override. Repository-wide lint retains pre-existing errors in untouched planner/UI/auth files.

## Validation

- All 197 Jest tests (21 suites), TypeScript, scoped Oxlint/Stylelint/format, Prisma schema/migration checks and production build pass.
- Twelve live PostgreSQL checks: owner indexing/search, unchanged reuse, stale exclusion, semantic/metadata update handling, non-maintainer denial, concurrent claim fencing, rollback on forced publication failure, digest mismatch and cascade cleanup.
- Browser: authenticated maintainer controls and confirmation; 32-task rebuild; actual 1,024 → 2,560 dimension model switch with no mixed stored dimensions; synthetic dental task ranks first for a meaning-based query; desktop/mobile layout without horizontal overflow. Initial model restored and fixtures/session cleaned up.
- Previous phases additionally verified chat cross-owner denial, persistence, interruption/retry deduplication, stale lease recovery and deletion. pgvector SQL checks cover 1,024, 2,560 and 4,096 dimensions.

## Experimental daily-use deployment checkpoint (2026-10-19)

Repository implementation and validation are complete; external activation remains.
See `docs/DAILY_USE_DEPLOYMENT.md` for exact startup, account, tunnel and recovery
instructions. `yarn public:build` / `yarn public:start` run a public Next production
build inside the same dev container/database; keep `yarn dev` private because its
internal debugging endpoints are outside Vela auth. Desktop LAN origin observed
at 192.168.0.106; target public port is 3001. Existing Pi tunnel should point
straight there, with HTTP Host Header vela.aarondewindt.space, no Access or Caddy.
No remote gateway or Cloudflare changes were made.

Outer Compose mappings require a dev-container rebuild (3001 published; 3000 and
5050 desktop-loopback only); the currently running outer container retains its
old mappings. Do not publish 3000. Both Docker/containerd storage mounts are
already persistent desktop volumes. A pre-change database dump is in ignored
`.local/backups`; restore into a fresh temporary database succeeded and the
temporary database was removed. No live DB was reset or migrated. The public
process was left running on container port 3001 after successful HTTP checks;
a rebuild will stop it and requires `yarn public:start` again.

Validation: production build and TypeScript passed, 63 Jest suites / 422 tests
passed, Compose configs validated, focused deployment lint/format passed. Global
lint still has pre-existing planner/UI failures. Live HTTP checks verified secure
login cookies, private-data and upload rejection without auth, disabled debugging
paths, food logging and two-user isolation; temporary test users were removed.
Pi-to-desktop connectivity, actual firewall policy, Cloudflare route/cache/HTTPS
settings and an external browser check remain operator steps. Existing unrelated
nutrition/model-settings/UI edits were preserved; deployment changes are uncommitted.


## Health and Home Assistant — 2026-10-19

User authorized implementing the reusable per-user Home Assistant connector and Health app for weight, body fat, lean mass, sleep and Nutrition-based calorie balance with a configurable signed daily goal.

- Implemented `/health` and `/settings/home-assistant`, navigation, protected `health`/`homeAssistant` tRPC routers, owner-scoped services, encrypted tokens bound to owner IDs, operator origin allowlist, sensor discovery/mapping, normalization and manual readings/deletion. Health history combines Nutrition snapshot aggregation with daily latest health records; missing intake/burn stays unknown. Balance is intake minus total burn; current goal applies to all displayed dates.
- Generic server-only REST/WebSocket read transport is in `lib/integrations/home-assistant/client.ts`. `yarn home-assistant:sync` runs the supervised worker: selected entity subscriptions, compact state reconstruction, independent lease heartbeats, revision/owner fencing, retries, seven-day bounded history recovery, per-minute reconciliation and graceful shutdown. No actual account connection was opened and no real worker was left running.
- Migration `20261019090000_health_home_assistant` applied locally after `yarn db:backup`; generated Prisma Client updated and schema/database diff empty. New tables only. Backups are private under ignored `.local/backups/`.
- Setup remains account/operator work: configure `HOME_ASSISTANT_ALLOWED_ORIGINS` and stable `INTEGRATION_ENCRYPTION_KEY` in the app/worker runtime, save each user's HA URL/token, map actual sensors, and supervise the worker. No secrets were created or changed in local environment files. See [Health](HEALTH.md) for upstream setup, recovery limits, timestamp semantics, timezone assumptions and key backup.
- Validation: full existing+new Jest run passed (451 tests, 72 suites); a subsequent first-save conflict test passed in the four-test connection-service suite. TypeScript, changed-code Oxlint/format, Stylelint, Prisma validation/schema diff and production build passed. Initial sandboxed production build stalled; it was stopped and rerun successfully outside the sandbox with `NODE_ENV=production`. A temporary HA REST/WebSocket simulator plus real PostgreSQL verified worker imports, unit conversion, daily-total deduplication, Nutrition balance/goal comparison, manual retries and cross-user isolation; synthetic users/data removed. Browser automation was unavailable; the Health goal UI was verified with React Testing Library.
- Repository-wide `yarn lint` still fails on pre-existing errors in untouched planner/auth/UI files. Pre-existing deployment/auth edits and a concurrently modified `docs/NOTES.md` were preserved.

## Day plan reviews — #35 — 2026-10-20

- Implemented `lib/planner/review/`, protected `planningProposals.review` and the Today proposal workspace's **Review day plan** panel. Review current or selected pending plans; current owner/date/fingerprint/status checks protect proposal projection. Reviews are transient and do not write planning state.
- Deterministic findings identify blocks/tasks for overlaps, busy calendar conflicts, invalid intervals, effective availability, category/leisure reservations, eligibility/hard prerequisites, earliest starts, excess allocations and session policy. The existing validator now exposes session-violation IDs so review uses the same break/finish-extension rules.
- Optional `planner.planReview` AI setting inherits Balanced/default model selection. Bounded schema output resolves request-local references into advisory concerns. Guidance and recorded task context inform contextual assessment; invalid references and unavailable models retain verified findings with an explicit error.
- Independently validated release/whole-remaining-effort replacement options preserve protected work and show displaced minutes, recorded deadlines and conservative deadline risk. Pending-plan accounting considers projected allocations, and corrections compose against original operations/reservations. Preview uses existing create/fingerprint/idempotency; explicit acceptance retains existing locking, revalidation and receipts. No schema migration or deployment was performed for #35. Existing semantic-search work and environment files were preserved.
- Documentation: [Day plan review](PLAN_REVIEWS.md); proposal API and architecture notes updated. Limits: transient reviews, 100 occupied blocks for AI, three replacement options per adjustable block, no combined repair optimizer or deadline-completion prediction. Manual/fixed/started/calendar/history corrections remain in the explicit existing workflows.
- Validation: full Jest run passed (709 tests / 100 suites). Two subsequent pending-projection/delegation tests also passed in the final focused review/router run (20 tests / three suites). TypeScript, scoped Oxlint/format, diff whitespace check and production build passed. The restricted build stalled; it was stopped, its stale generated build lock removed after confirming no build remained, and production compilation succeeded outside the sandbox. No live browser, actual model inference or new live PostgreSQL integration checks were run for #35; React/domain/service/router tests cover new behavior, and the full run includes existing proposal acceptance tests. Shared public server was not restarted.

## Discover MVP — #42 — 2026-10-22

- Implemented `/discover` and its main navigation entry on
  `feat/discover-personal-backlog`. Responsive cards, title/URL quick add, complete
  detail editing, inline statuses, confirmed deletion, conventional search,
  type/status/tag/priority filters and six sorts use protected tRPC and existing
  Mantine/TanStack Query patterns. See [Discover](DISCOVER.md) for API, limits and
  decisions.
- One owner-scoped `DiscoverItem` model stores all manual fields, extensible string
  content types, a shared status enum and optimistic versions. Nullable per-owner
  canonical URL hashes enforce duplicates under concurrent writes; title-only
  duplicates remain allowed. No metadata fetching, AI, embeddings or Planner
  integration was added.
- Additive migration `20261022120000_discover_items` was applied locally after a
  successful private `yarn db:backup`; Prisma Client regenerated and schema/database
  diff empty. The backup and synthetic verification scripts/screenshots remain
  ignored under `.local/`. Temporary PostgreSQL and browser users, sessions and
  items were deleted. The shared public server was not restarted or deployed.
- Validation: 1,017 tests across 136 Jest suites passed; final focused run passed
  56 tests across five suites. TypeScript, Prisma validation, changed-file
  formatting/Oxlint, repository Stylelint, database drift check and production
  build passed. Live PostgreSQL checks covered CRUD, every status, combined
  filtering, all sorts, pagination, two-user isolation, cascading deletion,
  duplicate create/edit races and stale-write races (28 checks). Browser checks
  covered quick add, notes/tags/rating editing, persistent status, duplicate
  feedback, search, desktop/mobile layouts and cancel/confirm deletion (14
  checks). Repository-wide lint and formatting retain failures in unchanged files.
- [PR #74](https://github.com/aarondewindt/vela/pull/74) is open for review and
  unmerged. [Issue #42 was updated](https://github.com/aarondewindt/vela/issues/42#issuecomment-6329639737)
  with implementation, validation, limitations and future work; it remains open.
  Do not merge automatically. Future metadata integrations should preserve
  editable fields separately from provider snapshots and reuse existing shared
  AI/embedding infrastructure when requested.

## Issue #91 — Android background sync (2026-10-24)

Implementation is in the current working tree alongside existing #90 changes.
WorkManager 2.10.1 adds hourly unique connected/battery-not-low work; `HealthSync`
shares the manual/worker mutex and durable outbox, rereads today plus seven days,
and replays original capture timestamps. Permanent failures pause automatic sync;
UI supports recovery, pause/resume and single-day historical backfill. Credentials
remain Keystore encrypted. See `docs/ANDROID_BACKGROUND_SYNC.md` for design and
physical-phone acceptance. Do not close #91 without device cadence/reboot/offline/
revision and battery checks. No device execution or deployment performed here.

#91 validation: `assembleDebug`, `testDebugUnitTest` (21 passed), `lintDebug`
(zero errors, 21 advisories) and `assembleDebugAndroidTest` passed offline with
locks enforced. Seventeen focused ingestion/route Jest tests passed. Recovery
instrumentation test compiled but was not run. Host local.properties restored.

## Issue #92 review — 2026-10-24

Completed scoped code review and available automated verification. See
`docs/ANDROID_END_TO_END.md` for findings, source/security review, setup/recovery,
manual S25 FE acceptance and proposed follow-up issue scopes. Fixed clearing the
outbox without a complete server acknowledgement, silent skipping of unexpected
SDK aggregate cardinality, misleading post-pairing messaging and Stylelint scanning
native generated reports. No new health permissions/integrations or #94 work.

Checks: Android build/25 JVM tests/lint (zero errors)/device-test compilation pass;
full Jest 1,131 pass and opt-in isolated PostgreSQL four pass; TypeScript/production
build pass. Stylelint passes after generated-report exclusion. Broad Oxlint and
format retain unrelated baseline failures. Connected tests, exact calorie semantics,
unattended cadence/reboot/offline phone flows and battery remain unverified; no
issue closure, deployment, application migration or Samsung registration performed.
Stop after #92 and await user review before expanding integrations.

## #92 required source-matrix continuation — 2026-10-24

Implemented steps and Samsung sleep-date duration plus actual optional SDK BMR in
the existing Android HealthSync/outbox/API. SDK BMR is BodyCompositionType's
BASAL_METABOLIC_RATE (100–12000 kcal/day), not a derived burn value. It retains
point ID/time and optional modification time; bounded raw-record pagination and
latest-point bootstrap allow older BMR to carry forward with original date.
Sleep filter explicitly uses [date,next date), verified against the pinned SDK.
Four READ types now required: activity summary, steps, sleep, body composition.

HA settings/diagnostics/worker and normalization permit only Withings weight,
body fat and lean mass. Old mappings are inert until replaced; historical rows
remain. Samsung beats manual/legacy HA for its five metrics. General HA client,
connections, discovery and Withings worker behavior are retained. Health adds
steps/BMR and total/active charts/history, sleep date labels, source-zone/point
provenance; balance continues to use only intake minus total burned.

Migration `20261024120000_companion_source_matrix` adds STEPS/BMR enum values,
bumps HA revisions and resets recovery cursor without deleting data/mappings.
Not applied to app DB. Deploy backend/migration and restart HA worker before
updating phone and regranting consent. See `docs/ANDROID_SOURCE_MATRIX.md`.

Final checks: 29 Android JVM tests; debug build/lint (zero errors)/device test APK
compile; full Jest 1,141 pass; isolated PostgreSQL five pass; Prisma generation/
validation, typecheck, production build and changed-file lint/format pass. Broad
lint/format unrelated baseline failures persist. No phone/production deployment,
connected test execution, live Withings/Samsung validation or issue closure.
Stop after this continuation for user review; #12/#94/heart-rate/Health Connect
were excluded. Remaining live-device, cadence, BMR availability and calorie
semantics checks are in the source-matrix guide.

## Planner continuation eligibility — 2026-10-24

User acceptance trace exposed unfinished SoLocos work disappearing from generation:
all dates' planned/active minutes consumed the effort estimate, and future occurrence
dates were rejected. BACKLOG/IN_PROGRESS one-off tasks can now reuse open occurrences
on either side of their original date. DONE effort plus selected-local-day commitments
consume the day budget; other dates' unfinished blocks remain intact. If completed
effort exhausts an unfinished task's estimate, use a labelled 25-minute continuation
allowance without modifying the estimate. Shared proposal validation/acceptance applies
the same accounting; recurrence dates, prerequisites, earliest starts, actual history,
explicit completion and session-extension protections remain. Future move-versus-add
confirmation is deferred; continuation currently adds a reviewed block.

The trace also supplied a bare task UUID instead of a composite candidate ID.
Conversation replacement/addition now resolves unique task IDs and clarifies multiple
eligible occurrences. Prior uncommitted replacement-tool/result-detail changes from
this session remain in the working tree. The model still failed the requested Vela
one-hour preference in the pasted trace; eligibility correction does not demonstrate
that the model will select or allocate the requested work correctly. Live Ollama/UI
acceptance remains required. No saved user schedule was modified or deployed.


## Guided allocation correction — 2026-10-24

Latest trace restored SoLocos eligibility/selection but allocated 186 minutes to
Vela, starving video and cleaning. Guided selection previously allowed omitted/null
plannedMinutes, which fell back to the full task estimate. The model contract now
requires positive numeric allocations for every guided selection, with explicit
approximate-duration examples. Missing allocations reject the proposal; unguided
fill behavior stays compatible. Allocation targets persist in generation outcomes
and display separately from actual placement under the AI assessment. Proposal
card headings use a concise summary; detailed actual results still reach chat.

Synthetic real qwen3:8b selection plus application placement passed with Vela
estimated at 9,999 minutes: 60 Vela / 30 cleaning / 96 video / 30 guitar minutes,
plus dinner/breaks/leisure. Repeatable no-user-record/no-proposal check:
`node --conditions=react-server --import tsx scripts/evaluate-planner-allocations.ts`.
Full Jest: 154 suites, 1,239 tests passed; five opt-in tests skipped. TypeScript,
scoped lint/format and whitespace passed. This verifies one synthetic model case;
actual authenticated chat/UI acceptance and general guidance compliance remain
unverified. No deployment, user schedule edits or commits in this turn.

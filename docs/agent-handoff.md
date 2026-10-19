# Shared Agent Handoff

This Git-tracked checkpoint records significant unfinished work between agents; it is not chat history. Keep credentials and private user content out of it.

**Status:** Scheduler #31, #33, #34 and remaining-day replanning #36 implemented; richer retrieval remains in #7
**Last updated:** 2026-10-20

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

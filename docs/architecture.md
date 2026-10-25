# Vela Architecture

Vela is a Next.js App Router application for private daily planning. PostgreSQL is the source of truth, accessed through Prisma. The application uses tRPC for ordinary web-client requests and an authenticated HTTP route for AI Dev chat streaming. Scoped device pairing/verification REST APIs are implemented; other integration APIs and a Vela-owned MCP API remain future directions in [the project plan](PROJECT_PLAN.md), not alternate current persistence paths.

```text
Next.js pages and Mantine components
        |
        v
 tRPC client / TanStack Query <---- Zustand for transient UI state
        |
        v
 app/api/trpc -> lib/trpc/root -> feature routers
        |                         (planner, settings, dev tools)
        v
 Feature services and deterministic domain logic
        |
        v
 lib/prisma -> PrismaPg adapter -> PostgreSQL
```

## Code map

- `lib/storage/` defines private file storage and its configurable local filesystem backend. `lib/attachments/` owns validated, owner-scoped images and retryable upload/deletion lifecycle; authenticated binary `/api/attachments` routes expose upload/retrieval/deletion. Prisma stores only metadata, while original files live on persistent storage outside public directories. Future saved consumers must retain IDs transactionally. See [attachment storage](ATTACHMENTS.md) for configuration, cleanup and the #114 contract.

- `app/` contains App Router pages, layouts and API route handlers. `app/client_layout.tsx` installs the tRPC provider and application shell; `app/api/trpc/[trpc]/route.ts` dispatches tRPC requests. Better Auth is exposed through `app/api/auth/[...all]/route.ts` and configured in `lib/auth.ts`.
- `components/` contains feature and shared UI, including `TodayView`, `TasksView`, `ApplicationShell` and settings components. Mantine's shared theme is in `theme.ts`; component styles are colocated CSS modules and global styles are in `app/globals.css`.
- `lib/trpc/` contains the client, provider, context and root router. Feature routers and services live under `lib/planner/`, `lib/settings/` and `lib/dev-tools/`. Keep transport procedures small and reusable behavior in services.
- `lib/prisma.ts` constructs Prisma Client with `@prisma/adapter-pg`. The Prisma schema and migrations are in `prisma/`; generated client code is written to `generated/prisma/` and is not source-controlled.
- `lib/ai/` contains shared server-only Ollama model discovery and AI SDK model resolution. `structured.ts` supplies bounded, cancellation-aware, caller-schema-validated generation through the AI SDK. Configuration, timeouts and usage are documented in [AI infrastructure](AI.md). It does not depend on AI Dev or perform application state changes.
- `lib/model-settings/` owns the finite profile/feature registry, validated per-user model preferences and deterministic selection precedence. Protected settings procedures and `components/ModelSettings/` centralize defaults, feature overrides and shared index maintenance in Settings. Application services resolve inherited models once per turn; overrides remain conversation/draft scoped and actual model attribution is stored per reply. Shared embedding collections keep their published configuration independently of account defaults. See [AI settings](AI.md#user-model-settings).
- `lib/ai-dev/` contains the AI Dev service, text-only request schema, owner-scoped conversation persistence and protected tRPC router. `/ai-dev` checks the Better Auth session before rendering `components/AiDevView`; `/api/ai-dev/chat` authenticates and validates requests before delegating streaming to the service. AI SDK UI owns the active stream; tRPC/TanStack Query loads saved conversations and model discovery. `AiConversation` and `AiMessage` persist owner/model selection, structured parts and generation status. Short transactions serialize turns and enforce stable message IDs; model calls run outside database transactions.
- `/ai-dev/embeddings` checks the session before rendering `components/EmbeddingsView`. Protected tRPC procedures delegate temporary embedding generation and cosine comparison to `lib/ai-dev/embeddings.ts`, which reuses shared model resolution and the AI SDK. Playground results remain temporary.
- `lib/embeddings/` contains reusable collection configuration validation, model identity checks, batched inference, indexing leases and atomic rebuild publication. Each collection adapter owns a dedicated vector table and one collection configuration. `lib/task-search/` supplies deterministic task text extraction, persistence and exact cosine search over `task_embeddings`. Configuration lives once in `embedding_collection_configs`, independently for each collection.
- `/planner/task-search` renders the authenticated `components/TaskSearchView` experiment. Protected `taskSearch` tRPC procedures expose owner-scoped status, incremental indexing and semantic search. Only server-designated embedding maintainers may switch models or rebuild the full shared task collection. Today and AI day planning reuse hybrid retrieval with deterministic eligibility and conventional fallback. Task writes transactionally queue durable refreshes; `yarn tasks:index` processes them. Stale vectors are excluded. See [semantic task search](SEMANTIC_TASK_SEARCH.md).
- `/nutrition/products` renders the authenticated food catalog in `components/Nutrition/`. Protected `nutrition` procedures delegate product/serving management, archival, hybrid product search and decimal quantity previews to `lib/nutrition/`. `Product`, `ProductServing` and recursive `ProductComponent` models keep reusable food definitions separate from diary consumption records. Direct products and nested recipes share the catalog; see [Nutrition](NUTRITION.md) for units, provenance, constraints and phase boundaries.
- `/` renders an authenticated timezone-based daily Nutrition summary, including fiber, through the existing diary API and shared marked goal bars.
- `/nutrition/history` renders 7/30-day calorie and macro charts with explicit missing-day gaps. `lib/nutrition/history.ts` aggregates historical scalar snapshots in PostgreSQL; recent/frequent food suggestions use owner-scoped grouped queries. `meal-copy.ts` transactionally copies reviewed snapshots and persists a per-owner request receipt for retries, including after entry deletion.
- `lib/nutrition/recipes.ts` calculates bounded recursive nutrition against explicit prepared yields. `product-graph.ts` batches graph reads, calculates current recipe definitions and fingerprints all dependencies for review. Catalog writes, NEVO imports and final snapshot capture share an owner advisory lock; mutations validate dependent recipes before committing. Recipe snapshots (v2) freeze the resolved reference plus composition and source provenance, while v1 direct snapshots remain readable.
- `/nutrition` renders the authenticated manual diary, and `/settings/nutrition` exposes user-entered daily goals and related-food search setup; `/nutrition/settings` redirects there, preserving valid diary dates. `lib/nutrition/diary.ts` owns date-scoped entries, immutable reference/conversion snapshots, idempotent logging and versioned edits; `goals.ts` owns nullable targets. `NutritionLogEntry` persists calendar dates and decimal nutrient snapshots independently of mutable Product/Serving records; physical source deletion nulls the product FK without deleting history. Shared calculations handle previews, historical quantity edits, totals and goal progress. There is no AI dependency in these paths.
- `lib/goals/semantics.ts` owns shared decimal goal evaluation for Nutrition and Health: inclusive minimum, maximum, target/tolerance and range semantics, with unknown observations distinct from zero. Additive JSONB options retain existing scalar targets and optimistic versions; see [goal semantics](GOAL_SEMANTICS.md).
- `lib/nutrition/product-index-worker.ts` processes durable coalesced owner refreshes via `yarn nutrition:index`; relevant product writes enqueue transactionally, while inference reuses the shared collection engine outside transactions. A dedicated Product vector table/configuration, source timestamp, archive cleanup, explicit maintainer setup and conventional fallback keep manual workflows independent of model availability.
- `lib/nutrition/drafts.ts`, `draft-items.ts`, `draft-matching.ts` and `draft-generation.ts` own persistent meal drafts, typed conversational corrections, conservative matching and deterministic previews. `NutritionMealDraft` holds a revisioned JSONB item document and generation lease; `NutritionDraftTurn` holds saved messages/replies. The diary review UI resumes drafts by URL/list, permits manual resolution and confirms them through the same transactional logging path as manual entries. Product-version checks require renewed review after source changes; confirmed draft status prevents duplicate insertion.
- `lib/nutrition/nevo-csv.ts` and `nevo.ts` validate, preview and transactionally apply user-uploaded NEVO datasets through protected Nutrition procedures. Stable per-owner source codes support updates; preview revisions, advisory/product locks and default manual-edit protection prevent lost changes. `Product.sourceSnapshot` retains original source rows separately from editable catalog fields. Catalog/diary/draft calculation displays include source/version attribution; see [NEVO](NEVO.md).
- `/health` provides owner-scoped body composition, sleep and calorie-balance history, manual readings and a signed daily balance goal. One persisted range drives all eight plots through server-aggregated `health.chartHistory`; the main dashboard reuses daily Health queries for compact body/sleep summaries and the balance gauge. `lib/health/` combines Nutrition diary snapshots with normalized total-burn records; missing values remain unknown. `/settings/home-assistant` configures private encrypted connections and health entity mappings. The reusable read adapter lives in `lib/integrations/home-assistant/`; a supervised `yarn home-assistant:sync` worker handles live subscriptions, bounded history recovery and database leases/revision fencing. See [Health](HEALTH.md) for configuration, timestamp semantics and upstream limits.
- `/planner/today` retains the candidate-task picker and Mantine DayView in a responsive three-column workspace with Planner chat. `lib/planner/chat/` supplies bounded owner-scoped day context and specialized advisory instructions; shared AI Dev conversation/streaming factories persist histories separately by scope and use the existing `planner.conversation` model setting. The chat renders application-owned proposal/review controls through the existing proposal workspace. See [Planner workspace](PLANNER_WORKSPACE.md).
- `/planner/conversation` (#37/#38) renders saved owner-scoped planning and task/theme conversations. `lib/planner/conversation/` interprets bounded structured instructions, resolves references and delegates to existing proposal/generation/review and record services. Plan changes use the shared proposal workspace; record previews apply through a version-checked transaction with explicit deletion confirmation and durable receipts. Dedicated conversation/turn tables keep this separate from AI Dev chat. See [Planner conversation](PLANNER_CONVERSATION.md).
- `lib/task-reviews/` owns saved AI task assessments, complete source fingerprints, freshness checks and explicit selective acceptance. The task inspector exposes owner-scoped reviews; day planning can reuse bounded fresh summaries as advisory context. Centralized model settings resolve `planner.taskReview`. See [task reviews](TASK_REVIEWS.md) for the focus scale, provenance, migration and acceptance locking limits.
- `/settings` is a directory of account, app and integration subpages with shared responsive navigation. Profile, appearance, AI defaults/feature overrides, Planner timezone/planning defaults/task-search setup, Nutrition goals/food-search setup, Health calorie balance/body/sleep goals and Home Assistant each have one configuration screen. Settings sections are also nested in the main navbar. Existing APIs and maintainer permissions are preserved. See [Settings](SETTINGS.md) for the inventory and routes.
- `store/` contains Zustand UI stores. Use tRPC/TanStack Query for persistent server state rather than copying it into these stores. See [FRONTEND_API.md](FRONTEND_API.md) for the state ownership rules.
- `/discover` renders the authenticated personal content backlog in `components/Discover/`. Protected `discover` procedures delegate manual CRUD, conventional search/filter/sort and optimistic owner-scoped writes to `lib/discover/`. One `DiscoverItem` model uses extensible string content types, shared statuses, nullable per-owner URL deduplication and a separate retrieved web metadata snapshot. Explicit bounded URL retrieval previews selected replacements while preserving manual edits; metadata and AI remain optional. See [Discover](DISCOVER.md).
- Jest tests are colocated with relevant components and services. `test-utils/` contains shared render helpers.

Task recurrence stores an optional calendar `recurrenceAnchorDate`. Both legacy
occurrence materialization and proposal eligibility resolve it through
`lib/planner/recurrence.ts`, falling back to the original UTC creation date for
existing tasks. TaskView edits the anchor through the owner-scoped task service;
existing occurrences and plans are retained when recurrence settings change.

## Android companion

`android/` is an independent single-module Kotlin/Material 3 Compose Gradle project.
Phase 1 (#88) establishes the host/container workflow. Phase 2 (#89) adds manual,
read-only Samsung Health activity-summary calorie diagnostics behind a small
`HealthProvider` interface; only `SamsungHealthProvider` imports Samsung SDK types.
`ReadCalorieDiagnostics` owns day ranges and refresh coordination. Missing readings
remain unknown and total/active calories are never added together. Diagnostics
stay in memory, with explicit clipboard copy and no automatic health logging.

Samsung Health Data SDK 1.1.0 is a locally supplied, Git-ignored AAR. Debug reads
require Samsung Health Data Read developer mode plus user consent. The user accepted the
S25 FE read diagnostics for #89; detailed elapsed/projected semantics are not
classified in the recorded evidence; manual ingestion is implemented in #90; background synchronization is implemented in #91 with physical-device acceptance pending.

Issue #93 adds generic account-owned device credentials, separate-secret one-time
pairing, protected Settings → Devices management and Android Keystore-backed
credential storage. `lib/devices/` owns deterministic issuance, verification, scope
checks, revocation and database-backed rate limits; `/api/devices/` exposes the
external protocol. Browser authentication remains Better Auth. See
[device authentication](DEVICE_AUTH.md) for migrations, HTTPS, pairing and tests.

VS Code/Codex edits and builds the shared checkout in the Node devcontainer with
a headless JDK 17/Android SDK. Gradle/signing volumes persist; SDK packages remain
in image layers. Android Studio and USB ADB stay on Ubuntu; a private Unix socket
and container-loopback TCP relay share its loopback ADB server. See
[Android devcontainer setup](ANDROID_DEVCONTAINER.md). Android CI remains separate
from web checks. See
[Android setup](../android/README.md) and [calorie validation](ANDROID_HEALTH_VALIDATION.md)
for the licensed SDK setup, signing/developer-mode limits, deployment and tests.

Manual sync (#90) uses `/api/health/ingest` and `lib/health/ingestion.ts` to authenticate scoped device uploads, validate bounded versioned snapshots and upsert the existing Health records. Total/active calories remain separate. The #92 source matrix selects Samsung Health before manual and legacy HA for companion metrics, and HA before manual for body metrics on the same date. Query interval/timezone and unverified calorie semantics persist as metadata. See [Android source matrix](ANDROID_SOURCE_MATRIX.md).

## Daily meal requirements

[Meal scheduling](PLANNER_MEALS.md) uses versioned finite preferences on existing
PlannerGenerationSettings and nullable DailyBlock.mealKind identities. Enabled
meals are generated/replanned through the shared proposal validator before optional
work, independently of tasks and Nutrition. See [scheduler evaluation](PLANNER_EVALUATION.md)
for AI defaults/fallback/evidence and [routine architecture review](PLANNER_ROUTINES_REVIEW.md)
for deferred sleep and cross-day considerations.

## Conversational Planner orchestration

Phase 2 Planner chat uses typed AI SDK tools in `lib/planner/chat/tools.ts`, bound
to the authenticated owner. Generation invokes the existing AI scheduler; edits,
review and replanning reuse their existing services. Conversation overrides never
select the scheduler model. Compact typed message parts restore application-owned
proposal/review cards; workspace UI state stores references and highlights only.
The shared validator enforces requested free intervals throughout proposal revisions
and acceptance. See [Planner workspace](PLANNER_WORKSPACE.md) for tools, lifecycle,
limits and pending live acceptance. No second scheduling engine is introduced. Issue #38 adds bounded task/theme
lookup and durable record-preview tools to the same conversation.
`PlannerRecordProposal` links previews/receipts to the streaming conversation;
acceptance reuses the existing record validator and normal task/theme services.
See [workspace record management](PLANNER_WORKSPACE.md#task-and-theme-management-38).

## Scheduler replacement policy

The current generator remains available. The replacement scheduler policy under
GitHub #18 starts with [constraints and planning policies](PLANNER_SCHEDULER_POLICY.md)
from #31. The [planning proposal workflow](PLANNING_PROPOSALS.md) from #33 now exposes
owner-scoped context/create/preview/accept/discard services and Today review UI.
Proposals save without changing planning state and apply atomically after fingerprint
and constraint revalidation. Acceptance briefly locks planner source tables to cover
legacy writers; see the proposal documentation for the current concurrency tradeoff.
[AI day planning](AI_DAY_PLANNING.md) (#34) now selects tasks through centralized model
settings and computes valid placements through application code. Today generates reviewed
proposals, with an explicit deterministic alternative. [Remaining-day replanning](REPLANNING.md) (#36) adds deterministic progress actions,
actual block duration, explicit task completion and estimate increases, and reviewed
downstream moves/removals through the same proposal and acceptance boundary.

`lib/planner/review/` (#35) reviews current or pending plans, separates deterministic conflicts from bounded advisory AI concerns, and builds independently validated release/replacement corrections. The Today proposal workspace previews these through the existing create/accept boundary; reviews themselves are transient. See [Day plan review](PLAN_REVIEWS.md).

## Persistence and behavior

The Prisma datasource is PostgreSQL, configured through `prisma.config.ts`; connection settings come from the runtime environment. Prisma 7 uses the `prisma-client` generator and PostgreSQL driver adapter in this repository. Review the schema and migrations before changing persistent models.

The development database uses `.devcontainer/postgres/Dockerfile` to add pinned pgvector source to PostgreSQL 18 Alpine. Compose builds the image and retains the existing PostgreSQL data volume; a Prisma migration enables the `vector` extension per database. Synthetic storage and exact cosine search checks cover 1,024, 2,560 and 4,096 dimensions. Persistent task vectors and collection metadata are added by `20261017211829_task_embedding_collection`. Model calls run outside transactions; vector replacement and configuration activation commit together. Build, migration, indexing and maintainer setup are documented in [AI infrastructure](AI.md).

Keep business rules deterministic and testable in feature services. Validate untrusted inputs at the tRPC boundary with existing Zod patterns, scope reads and writes to the authenticated user, and use existing typed error handling. AI, REST, background jobs and Vela-owned MCP integrations may be added as interfaces over the same service behavior; none should bypass it to mutate the database directly.

Important future product goals and deployment assumptions are documented in [PROJECT_PLAN.md](PROJECT_PLAN.md). This file describes current code organization and distinguishes implemented paths from planned ones.

## Experimental desktop deployment

The initial daily-use deployment runs the app and PostgreSQL in the existing Ubuntu desktop dev container, with the Pi retaining gateway services. Public `yarn public:build` / `yarn public:start` commands serve an optimized Next.js build on port 3001 with a fixed HTTPS auth origin; local `yarn dev` is available on desktop LAN port 3000. Both processes share the database. The existing Cloudflare Tunnel points directly from the Pi to the desktop, without Caddy or Access. See [daily-use deployment](DAILY_USE_DEPLOYMENT.md) for setup, account provisioning, Docker volume retention, tested database backup/restore commands and operational limitations.

Background sync (#91) schedules unique hourly WorkManager work with connectivity
and battery constraints. `HealthSync` shares manual/worker serialization and a
durable bounded outbox; SDK reads reconcile today and seven completed days. See
[Android background sync](ANDROID_BACKGROUND_SYNC.md) for retries and acceptance.

The #92 source-matrix continuation adds Samsung steps, SDK sleep-date totals and
optional body-composition BMR through the same Android outbox and ingestion service.
HA health mapping/worker normalization now permits only Withings weight/body fat/
lean mass. Legacy health rows remain preserved; Samsung is authoritative for its
metrics. BMR retains actual point provenance and carries forward without entering
calorie balance. See [source matrix](ANDROID_SOURCE_MATRIX.md).

## Companion diagnostics

Dev Tools separates preserved Planner controls (`/dev-tools/planner`) from private
Companion diagnostics (`/dev-tools/companion`). `lib/companion` owns strict snapshot
schemas, independent ingestion auditing, protected paginated queries, correlation
and retention. `CompanionEvent` distinguishes server requests from uploaded local
attempts; `CompanionUpload` stores explicit report snapshots. Android checkpoints
shared sync execution into bounded private preferences separate from its durable
outbox; optional IDs/headers do not change measurement identity or receipt handling.
See [Companion diagnostics](COMPANION_DIAGNOSTICS.md) for visibility limits, bounds,
migrations, maintenance, verification and signing-safe phone testing.

Calorie projection Phase 1 (#110) retains real SDK calorie captures by cutoff in
`HealthMetric` while daily queries select one authoritative total. A shared pure
BMR baseline service supplies Today observed lines plus a dotted projection and
the balance gauge's second marker. See [calorie projection](CALORIE_PROJECTION.md)
for source semantics, DST behavior, timestamp limits and correction handling.

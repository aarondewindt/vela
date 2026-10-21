# Semantic task retrieval (#7)

Today’s task picker combines current text matches with semantic neighbors. Type a query,
including an intent such as “something useful around the house”. The **Search by meaning
too** switch leaves conventional search available independently of embeddings. Queries
are debounced; loading, empty, fallback and retry states appear in the picker. Results
remain draggable and open the existing task inspector. The picker intersects returned
IDs with its current task list, so tasks already hidden by Today stay hidden.

`lib/task-search/retrieval.ts` exposes `retrievePlanningTasks` for day planning and future
review/replacement consumers. It loads an owner-scoped repeatable-read planning snapshot,
or accepts the caller’s matching owner/date snapshot. It reuses `planningCandidates` for
status, hard dependencies, recurrence/occurrence eligibility and remaining effort. Tasks
whose earliest start is beyond the selected local day are excluded. Text matching covers
title, brief, BlockNote notes, tags and first step. Semantic search uses the published
shared task collection, with eligible task IDs filtered in SQL **before** ranking/limiting.
Owner and source timestamp filters also apply before the limit. Source versions are
checked again after inference, excluding changed/deleted semantic matches.

The returned picker IDs are bounded text-first matches, followed by semantic neighbors.
The separate candidate list starts with **every** due/important occurrence, then matched
work, then remaining work in urgency order. Semantic relevance never removes important
work. The AI generator uses this shared list with its existing 60-candidate prompt bound;
more than 60 important candidates still requires explicit deterministic planning. Placement
and acceptance retain deterministic validation and source fingerprint checks. Retrieval
never changes tasks, occurrences or plans. The separate `semanticIds` attribute describes
semantic matches, including those outside the bounded text-first result list.

Missing/stale vectors are reported through pending counts and excluded from semantic
results. Model/configuration/collection failures produce a visible conventional fallback;
unexpected database failures remain errors. Conventional matches use current task content
without an embedding dependency. The collection’s exact cosine search still returns
nearest neighbors without a relevance threshold. Configuration, maintainer permissions,
model identity and atomic whole-collection rebuilds remain in Settings → AI & models;
account defaults never silently change published query vectors.

## Durable index refreshes

Migration `20261020090000_task_index_jobs` adds coalesced owner jobs and an insert/update
trigger on `tasks`. A trigger covers the existing task editor, review acceptance, planner
estimate updates and future writers in their source transaction. This avoids missing a
writer or coupling task saves to inference. Every update queues a pass; unchanged text
reuses its vector while refreshing metadata. Deletes cascade immediately to task vectors;
status/archival edits invalidate old timestamps and planning retrieval excludes closed
work. Existing owners receive an initial queued pass.

`lib/task-search/worker.ts` follows the established product-index worker lifecycle:
`SKIP LOCKED` claims, renewable five-minute leases, revision/token acknowledgement,
recovery after crashes and safe failures with 15-second to one-hour retry delays. Changes
arriving during inference retain a pending revision. The shared collection lease also
serializes full rebuilds and owner indexing. No HTTP request launches unawaited inference.

Run a worker beside the Node server, with the same environment files:

```sh
yarn tasks:index --check            # startup only; no jobs or model requests
yarn tasks:index                    # continuously poll durable jobs
NODE_ENV=production yarn tasks:index
# One pass restricted to an explicitly selected owner:
yarn tasks:index --once --user <user-id>
```

Use the deployment’s process supervisor for restart-on-failure; the repository has no
supervisor configuration. Without a running worker, jobs persist and text search remains
available. **Planner → Fuzzy task search → Queue index refresh** queues an owner retry
and shows pending/running/failure status. The legacy `taskSearch.index` endpoint remains
available for synchronous owner maintenance. Full rebuilds still stage vectors in memory;
this change does not introduce streaming or approximate vector indexing.

## Validation

Focused Jest coverage includes ownership/authentication, all text fields, status and hard
prerequisites, remaining work, earliest starts, stale/deleted matches, fallback, important
candidate retention, UI debounce/toggle/retry/loading/empty states and worker revision,
lease and retry behavior. Eight synthetic PostgreSQL assertions verified the migration’s
transactional trigger, coalescing with an active lease, owner/freshness/eligible-ID filters
and cascade deletion, with all fixture data rolled back. No existing private queue was
processed and no published embedding configuration was changed.

All 692 Jest tests (97 suites), TypeScript, scoped Oxlint/format, Prisma validation,
worker startup and an isolated default Turbopack production build passed. The optional
Webpack build fails on the Mantine schedule/rrule default export; dependencies were
unchanged. No live browser automation was run.

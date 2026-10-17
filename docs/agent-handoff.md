# Shared Agent Handoff

This Git-tracked checkpoint records significant unfinished work between agents; it is not chat history. Keep credentials and private user content out of it.

**Status:** AI infrastructure, pgvector, reusable collections and task search experiment implemented
**Last updated:** 2026-10-17

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

# Shared Agent Handoff

This Git-tracked checkpoint records significant unfinished work between agents; it is not chat history. Keep credentials and private user content out of it.

**Status:** AI Phases 1–4 and pgvector infrastructure complete
**Last updated:** 2026-10-17

## Objective

Build reusable Vercel AI SDK infrastructure, AI Dev chat, conversation persistence and an embeddings playground. The user subsequently authorized a PostgreSQL Dockerfile and pgvector enablement. These changes are implemented and verified; persistent collection/application features need a new scope discussion.

## Relevant files

- `lib/ai/`: shared server-only Ollama discovery, model resolution and typed errors.
- `lib/ai-dev/conversations.ts`: owner-scoped conversation/message persistence, retry semantics and generation leases.
- `lib/ai-dev/`: service, protected tRPC router, request schema, error mapping and focused tests.
- `app/ai-dev/page.tsx`, `app/api/ai-dev/chat/route.ts`, `components/AiDevView/`: authenticated chat and saved-conversation UI.
- `app/ai-dev/embeddings/page.tsx`, `components/EmbeddingsView/`, `lib/ai-dev/embeddings.ts`: authenticated temporary embeddings playground and service.
- `prisma/schema.prisma`, `prisma/migrations/20261017183136_ai_dev_conversations/migration.sql`.
- `docs/AI.md`: configuration, APIs, persistence protocol and embedding constraints.
- `.devcontainer/postgres/`: PostgreSQL 18 Alpine Dockerfile with checksum-pinned pgvector 0.8.7, plus repeatable temporary-vector SQL verification. Compose builds it; `postStartCommand` includes `--build`.
- `prisma/migrations/20261017210033_enable_pgvector/migration.sql`: enables the extension without creating application tables.

## Work completed

Shared Ollama infrastructure, streamed chat and saved conversations are implemented. The additive Phase 3 migration was applied locally and Prisma Client regenerated. Users can create, reopen, continue and delete conversations. Partial replies and completion status persist; retries preserve stable message IDs. Temporary verification routes and database fixtures were removed. Credentials were read only for authorized test login, never copied into source or logs.

Phase 4 adds explicit embedding model selection, single-text dimensions/preview and two-text cosine comparison. Protected tRPC mutations use the shared resolver plus AI SDK `embed`/`embedMany`; full vectors stay on the server and only the first 16 values are returned. Text is preserved as entered, model truncation is disabled, inference is bounded to 120 seconds with no automatic retries, and invalid comparison vectors are rejected. Results are temporary; no migration or dependency changes were needed. The sidebar now groups Chat and Embeddings under AI Dev.

The custom PostgreSQL image was built, tested in an isolated database, and used to recreate only the development database container on its existing `vela-postgres-data` volume. The extension migration was created with Prisma's normal create-only workflow and applied with `yarn prisma migrate dev`. PostgreSQL 18.6 / pgvector 0.8.7 passes storage and exact cosine tests at 1,024, 2,560 and 4,096 dimensions. All application table counts match the pre-replacement snapshot. The temporary test container and fixtures were cleaned up.

## Decisions and rationale

- Shared AI infrastructure remains independent of AI Dev. Dependencies: `ai@7.0.142`, `@ai-sdk/react@4.0.146`, `ollama-ai-provider-v2@4.0.1`; the SDK patch satisfies Yarn's quarantine policy.
- Conversation provider/model selection is fixed at creation. Streaming requests send only a conversation ID and latest user UI message; the server loads authoritative history and model settings.
- Stable user IDs, one assistant reply per user message, and composite database constraints prevent duplicate rows. Completed retries replay saved text; incomplete retries replace the same assistant row. Different content cannot reuse an existing user ID.
- Short transactions claim generation leases; inference runs outside transactions. Three-minute expiry recovers abandoned placeholders. Finalization checks owner and generation token, protecting newer attempts and deleted conversations from late callbacks.
- Structured text/step parts are stored as JSONB. Cancellation/disconnection saves available partial text. A process crash can lose unsaved partial output; lease expiry makes the saved user turn retryable. No per-token writes or background jobs.
- tRPC/TanStack Query owns saved data; AI SDK UI owns the active stream. Private cached conversation data is hidden until a fresh successful authorized read. Failed local sends are preserved for retry when saved history refreshes.
- Each future embedding collection/vector table gets one configuration, independently of other collections. Model/configuration changes require a full reindex. No mixed-model rows or global embedding-model requirement. No vector storage/configuration system is implemented yet.
- Dimensions are collection-specific, with no global 1,024-dimension cap. pgvector stores vectors up to 16,000 dimensions, but standard vector approximate indexes stop at 2,000 and half-precision indexes at 4,000. Exact search is the initial direction; any later approximate-search representation must explicitly account for larger dimensions.

## Outstanding issues

- Keep the Ollama setting in ignored `vela.env` aligned with any ignored `.env.local` override. The host PC uses its router-reserved LAN address; localhost inside the container is not the host.
- Repository-wide lint has pre-existing failures in untouched planner/UI/auth files. Changed AI files pass lint and formatting.

## Next steps

Discuss persistent embedding collection storage, configuration/full-reindex workflow and the first application feature that needs it. No further implementation is authorized yet. pgvector is installed and enabled; persistent collection tables, configuration records and reindex services remain future work. The playground sends raw text without task-specific instructions; retrieval quality still needs evaluation for each consuming feature.

## Validation performed

- All 154 Jest tests (15 suites), typecheck, scoped Oxlint/Stylelint/format checks and production build (`NODE_ENV=production yarn build`) pass after Phase 4.
- 13 live PostgreSQL checks passed: foreign read/delete/list/stream rejection, concurrent generation, stable retry rows/IDs, completed replay, content immutability, authoritative history, abandoned lease recovery, stale callback protection and cascading deletion. Synthetic fixture users/conversations were cleaned up.
- Browser with authorized test account and `llama3.1:8b`: messages restored after reload and continued using saved context; cancellation saved partial text; retry kept the same six message rows and assistant ID; completed replay returned a complete SDK stream without duplicates; confirmed deletion returned 404 on a subsequent read. Test conversation removed and browser signed out/closed. No browser runtime errors were reported.
- Phase 4 browser with `qwen3-embedding:0.6b`: 1,024 dimensions and a 16-value preview, identical-text cosine 1.000000, unrelated-text comparison, result invalidation after edits and responsive layout at 390 pixels without horizontal overflow. Signed-out APIs returned 401; invalid/oversized text, missing/chat-only models and blank comparison input returned 400. No database fixtures or temporary routes were needed; browser signed out/closed after testing.
- pgvector: Docker build/Compose validation, fresh isolated database and live development database SQL checks, normal Prisma migration/shadow workflow, existing volume/table-count preservation. `.devcontainer/postgres/verify.sql` tests storage, three cosine scores and exact nearest-neighbor search at each dimension using rolled-back temporary rows.

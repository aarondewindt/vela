# Shared Agent Handoff

This Git-tracked checkpoint records significant unfinished work between agents; it is not chat history. Keep credentials and private user content out of it.

**Status:** AI Phases 1–3 implemented; embeddings playground is next
**Last updated:** 2026-10-17

## Objective

Build reusable Vercel AI SDK infrastructure, AI Dev chat, conversation persistence and an embeddings playground. User approved through Phase 3; continue incrementally.

## Relevant files

- `lib/ai/`: shared server-only Ollama discovery, model resolution and typed errors.
- `lib/ai-dev/conversations.ts`: owner-scoped conversation/message persistence, retry semantics and generation leases.
- `lib/ai-dev/`: service, protected tRPC router, request schema, error mapping and focused tests.
- `app/ai-dev/page.tsx`, `app/api/ai-dev/chat/route.ts`, `components/AiDevView/`: authenticated chat and saved-conversation UI.
- `prisma/schema.prisma`, `prisma/migrations/20261017183136_ai_dev_conversations/migration.sql`.
- `docs/AI.md`: configuration, APIs, persistence protocol and embedding constraints.

## Work completed

Shared Ollama infrastructure, streamed chat and saved conversations are implemented. The additive Phase 3 migration was applied locally and Prisma Client regenerated. Users can create, reopen, continue and delete conversations. Partial replies and completion status persist; retries preserve stable message IDs. Temporary verification routes and database fixtures were removed. Credentials were read only for authorized test login, never copied into source or logs.

## Decisions and rationale

- Shared AI infrastructure remains independent of AI Dev. Dependencies: `ai@7.0.142`, `@ai-sdk/react@4.0.146`, `ollama-ai-provider-v2@4.0.1`; the SDK patch satisfies Yarn's quarantine policy.
- Conversation provider/model selection is fixed at creation. Streaming requests send only a conversation ID and latest user UI message; the server loads authoritative history and model settings.
- Stable user IDs, one assistant reply per user message, and composite database constraints prevent duplicate rows. Completed retries replay saved text; incomplete retries replace the same assistant row. Different content cannot reuse an existing user ID.
- Short transactions claim generation leases; inference runs outside transactions. Three-minute expiry recovers abandoned placeholders. Finalization checks owner and generation token, protecting newer attempts and deleted conversations from late callbacks.
- Structured text/step parts are stored as JSONB. Cancellation/disconnection saves available partial text. A process crash can lose unsaved partial output; lease expiry makes the saved user turn retryable. No per-token writes or background jobs.
- tRPC/TanStack Query owns saved data; AI SDK UI owns the active stream. Private cached conversation data is hidden until a fresh successful authorized read. Failed local sends are preserved for retry when saved history refreshes.
- Each future embedding collection/vector table gets one configuration, independently of other collections. Model/configuration changes require a full reindex. No mixed-model rows or global embedding-model requirement. No vector storage/configuration system is implemented yet.

## Outstanding issues

- Keep the Ollama setting in ignored `vela.env` aligned with any ignored `.env.local` override. The host PC uses its router-reserved LAN address; localhost inside the container is not the host.
- Repository-wide lint has pre-existing failures in untouched planner/UI/auth files. Changed AI files pass lint and formatting.

## Next steps

After user authorization, implement Phase 4: embedding model selection, single-text vector dimensions/preview, two-text cosine comparison, and meaningful errors. Reuse `lib/ai/`; `qwen3-embedding:0.6b` is installed and was verified to return 1,024-dimensional vectors. Persistent embeddings, pgvector, configuration storage and reindex machinery remain future work.

## Validation performed

- 117 Jest tests, typecheck, scoped Oxlint/Stylelint/format checks and production build (`NODE_ENV=production yarn build`) pass.
- 13 live PostgreSQL checks passed: foreign read/delete/list/stream rejection, concurrent generation, stable retry rows/IDs, completed replay, content immutability, authoritative history, abandoned lease recovery, stale callback protection and cascading deletion. Synthetic fixture users/conversations were cleaned up.
- Browser with authorized test account and `llama3.1:8b`: messages restored after reload and continued using saved context; cancellation saved partial text; retry kept the same six message rows and assistant ID; completed replay returned a complete SDK stream without duplicates; confirmed deletion returned 404 on a subsequent read. Test conversation removed and browser signed out/closed. No browser runtime errors were reported.

# Shared Agent Handoff

This Git-tracked file is a task checkpoint for handing significant unfinished work between Copilot and Codex. It does not synchronize or preserve chat histories. Keep it brief, update it only when another agent is likely to resume the task, and remove sensitive values before recording anything.

**Status:** AI Phases 1 and 2 implemented; persistence is the next phase
**Last updated:** 2026-10-17

## Objective

Build reusable Vercel AI SDK infrastructure, then AI Dev chat, persistence and an embeddings playground. User approved Phases 1 and 2; keep subsequent phases incremental.

## Relevant files

- `lib/ai/`: shared server-only Ollama discovery, capability-aware model resolution, typed errors and colocated tests.
- `lib/ai-dev/`, `app/ai-dev/page.tsx`, `app/api/ai-dev/chat/route.ts`, `components/AiDevView/`: Phase 2 chat consumer, model query, streaming route and focused tests.
- `docs/AI.md`: configuration, public API, dependencies and runtime verification details.
- `vela.env.example`, `package.json`, `yarn.lock`, `jest.setup.cjs`.

## Work completed

Implemented Phase 1 without AI Dev UI, API or database changes. Local ignored Ollama configuration now points to the host PC's router-reserved static LAN address, supplied by the user and verified reachable from the container; no private environment files are tracked. A temporary guarded Next.js verification route was removed after successful checks.

Phase 2 adds `/ai-dev`, navigation, authenticated model discovery and a text-only streamed chat with cancellation, retry and new-conversation reset. Messages stay in AI SDK UI memory and clear on navigation/reload. No database changes. The current development server lacked the Ollama environment setting; the ignored `.env.local` now contains only that setting copied from `vela.env` for normal Next.js loading. Test account credentials were read only for authorized browser login and were not added to source or logs.

## Decisions and rationale

- Shared infrastructure lives in `lib/ai`, independently of future `lib/ai-dev` services.
- Use `ai@7.0.142` and `ollama-ai-provider-v2@4.0.1`; the newer SDK patch was still quarantined by Yarn.
- Discover exact installed IDs and capabilities through Ollama metadata; do not infer capabilities from model names.
- User requires one embedding configuration per collection/vector table, independently selected for each collection. Store configuration at collection level; model or vector-affecting configuration changes require a complete reindex. No mixed-model rows or global embedding-model requirement. See `docs/AI.md` for the agreed future persistence constraints; no vector storage/configuration system has been implemented.
- Phase 0 proposal: tRPC for models/persistence/embedding requests, authenticated route handler for chat streaming, existing Mantine shell for AI Dev pages. No admin-role system exists; signed-in access was recommended.
- Phase 2 uses `@ai-sdk/react@4.0.146` with `ai@7.0.142`. Current model selection is sent per request to avoid stale transport configuration. New conversations remount chat state and cancel active generation. The streaming route checks the external Host header because Next.js can use an internal hostname in `request.url`.

## Outstanding issues

- `vela.env` is injected at container creation; keep its Ollama setting aligned with any `.env.local` override when configuration changes.
- Repository-wide lint has existing failures in untouched planner/UI/auth files. AI files pass scoped lint and formatting.

## Next steps

After user authorization, implement Phase 3 conversation persistence, owner-scoped reads/writes, stable message IDs, structured parts and interrupted-response handling. Read `docs/AI.md` and relevant Prisma skills before schema/query changes. Embeddings UI is Phase 4; persistent embedding storage remains outside those phases.

## Validation performed

- Live Next.js discovery, generation and streaming succeeded against Ollama 0.40.6 with `llama3.1:8b`; embedding resolution correctly rejected the chat-only model.
- After the user installed `qwen3-embedding:0.6b`, Next.js discovery, embedding resolution, single/batch embedding calls and cosine comparison succeeded. Observed output: 1,024 dimensions, all finite; identical-input cosine approximately 1. Temporary verification route removed.
- Phase 2: 93 Jest tests and TypeScript checks pass. Changed-file Oxlint, Stylelint and formatting checks pass; broad lint reports failures only in untouched planner/UI/auth files.
- Production build passes with `NODE_ENV=production yarn build`. The initial sandboxed build stalled; only its verified orphaned build process was stopped before the successful build outside the sandbox. The development server was left running.
- Browser: test-account login, chat-only model filtering, streamed generation, follow-up context, cancellation, new-conversation reset, simulated network error/retry and mobile layout passed. Anonymous model discovery and chat return 401. No browser runtime errors were reported.

# Shared Agent Handoff

This Git-tracked file is a task checkpoint for handing significant unfinished work between Copilot and Codex. It does not synchronize or preserve chat histories. Keep it brief, update it only when another agent is likely to resume the task, and remove sensitive values before recording anything.

**Status:** AI Phase 1 implemented; awaiting authorization for Phase 2
**Last updated:** 2026-10-17

## Objective

Build reusable Vercel AI SDK infrastructure, then AI Dev chat, persistence and an embeddings playground. User approved Phase 1 only; keep subsequent phases incremental.

## Relevant files

- `lib/ai/`: shared server-only Ollama discovery, capability-aware model resolution, typed errors and colocated tests.
- `docs/AI.md`: configuration, public API, dependencies and runtime verification details.
- `vela.env.example`, `package.json`, `yarn.lock`, `jest.setup.cjs`.

## Work completed

Implemented Phase 1 without AI Dev UI, API or database changes. Local ignored Ollama configuration now points to the host PC's router-reserved static LAN address, supplied by the user and verified reachable from the container; no private environment files are tracked. A temporary guarded Next.js verification route was removed after successful checks.

## Decisions and rationale

- Shared infrastructure lives in `lib/ai`, independently of future `lib/ai-dev` services.
- Use `ai@7.0.142` and `ollama-ai-provider-v2@4.0.1`; the newer SDK patch was still quarantined by Yarn.
- Discover exact installed IDs and capabilities through Ollama metadata; do not infer capabilities from model names.
- User requires one embedding configuration per collection/vector table, independently selected for each collection. Store configuration at collection level; model or vector-affecting configuration changes require a complete reindex. No mixed-model rows or global embedding-model requirement. See `docs/AI.md` for the agreed future persistence constraints; no vector storage/configuration system has been implemented.
- Phase 0 proposal: tRPC for models/persistence/embedding requests, authenticated route handler for chat streaming, existing Mantine shell for AI Dev pages. No admin-role system exists; signed-in access was recommended.

## Outstanding issues

- `vela.env` is injected at container creation; recreate the container or supply a Next.js local environment setting for future server starts.
- Repository-wide lint has existing failures in untouched planner/UI/auth files. AI files pass scoped lint and formatting.

## Next steps

After user authorization, implement Phase 2 chat using AI SDK UI and existing authentication conventions. Read `docs/AI.md` before using the shared layer. Persistence is Phase 3; embeddings UI is Phase 4.

## Validation performed

- Live Next.js discovery, generation and streaming succeeded against Ollama 0.40.6 with `llama3.1:8b`; embedding resolution correctly rejected the chat-only model.
- After the user installed `qwen3-embedding:0.6b`, Next.js discovery, embedding resolution, single/batch embedding calls and cosine comparison succeeded. Observed output: 1,024 dimensions, all finite; identical-input cosine approximately 1. Temporary verification route removed.
- All Jest tests and TypeScript checks pass. Scoped AI lint/format checks pass; broad lint reports pre-existing failures.

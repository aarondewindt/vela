# Vela Architecture

Vela is a Next.js App Router application for private daily planning. PostgreSQL is the source of truth, accessed through Prisma. The application uses tRPC for ordinary web-client requests and an authenticated HTTP route for AI Dev chat streaming. REST integration APIs and a Vela-owned MCP API remain future directions in [the project plan](PROJECT_PLAN.md), not alternate current persistence paths.

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

- `app/` contains App Router pages, layouts and API route handlers. `app/client_layout.tsx` installs the tRPC provider and application shell; `app/api/trpc/[trpc]/route.ts` dispatches tRPC requests. Better Auth is exposed through `app/api/auth/[...all]/route.ts` and configured in `lib/auth.ts`.
- `components/` contains feature and shared UI, including `TodayView`, `TasksView`, `ApplicationShell` and settings components. Mantine's shared theme is in `theme.ts`; component styles are colocated CSS modules and global styles are in `app/globals.css`.
- `lib/trpc/` contains the client, provider, context and root router. Feature routers and services live under `lib/planner/`, `lib/settings/` and `lib/dev-tools/`. Keep transport procedures small and reusable behavior in services.
- `lib/prisma.ts` constructs Prisma Client with `@prisma/adapter-pg`. The Prisma schema and migrations are in `prisma/`; generated client code is written to `generated/prisma/` and is not source-controlled.
- `lib/ai/` contains shared server-only Ollama model discovery and AI SDK model resolution. Configuration, timeouts and usage are documented in [AI infrastructure](AI.md). It does not depend on AI Dev or perform application state changes.
- `lib/ai-dev/` contains the AI Dev service, text-only request schema, owner-scoped conversation persistence and protected tRPC router. `/ai-dev` checks the Better Auth session before rendering `components/AiDevView`; `/api/ai-dev/chat` authenticates and validates requests before delegating streaming to the service. AI SDK UI owns the active stream; tRPC/TanStack Query loads saved conversations and model discovery. `AiConversation` and `AiMessage` persist owner/model selection, structured parts and generation status. Short transactions serialize turns and enforce stable message IDs; model calls run outside database transactions.
- `/ai-dev/embeddings` checks the session before rendering `components/EmbeddingsView`. Protected tRPC procedures delegate temporary embedding generation and cosine comparison to `lib/ai-dev/embeddings.ts`, which reuses shared model resolution and the AI SDK. Results contain dimensions and short previews; complete vectors are compared on the server. There is no persistent vector storage or global embedding model. See [AI infrastructure](AI.md) for the per-collection configuration direction.
- `store/` contains Zustand UI stores. Use tRPC/TanStack Query for persistent server state rather than copying it into these stores. See [FRONTEND_API.md](FRONTEND_API.md) for the state ownership rules.
- Jest tests are colocated with relevant components and services. `test-utils/` contains shared render helpers.

## Persistence and behavior

The Prisma datasource is PostgreSQL, configured through `prisma.config.ts`; connection settings come from the runtime environment. Prisma 7 uses the `prisma-client` generator and PostgreSQL driver adapter in this repository. Review the schema and migrations before changing persistent models.

Keep business rules deterministic and testable in feature services. Validate untrusted inputs at the tRPC boundary with existing Zod patterns, scope reads and writes to the authenticated user, and use existing typed error handling. AI, REST, background jobs and Vela-owned MCP integrations may be added as interfaces over the same service behavior; none should bypass it to mutate the database directly.

Important future product goals and deployment assumptions are documented in [PROJECT_PLAN.md](PROJECT_PLAN.md). This file describes current code organization and distinguishes implemented paths from planned ones.

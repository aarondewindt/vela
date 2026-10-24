# Vela Agent Instructions

Vela is a private personal planning app, separate from OpenClaw. The application owns validation, persistence, scheduling and state changes; AI may interpret, classify, summarize or suggest, but must not replace deterministic application logic.

## Architecture and conventions

- Read the relevant documentation before significant changes: [architecture](docs/architecture.md), [frontend API and state](docs/FRONTEND_API.md), [project plan](docs/PROJECT_PLAN.md), and [color palette](docs/COLOR_PALETTE.md) when changing UI colors.
- The current stack is Next.js App Router, React, TypeScript, Mantine, tRPC, TanStack Query, Zustand, Prisma 7 with the `prisma-client` generator and PostgreSQL. See [architecture](docs/architecture.md) for code locations.
- Keep tRPC routers thin: validate inputs, enforce authentication, and delegate business behavior to services. Keep Prisma access out of React components; use the existing service and persistence patterns.
- Use TanStack Query/tRPC for server-owned data and Zustand only for client/UI state. Preserve existing Mantine theme, component, CSS module, and shared palette conventions.
- Follow nearby TypeScript, Next.js, Mantine and Better Auth patterns. Validate at API boundaries with the existing Zod schemas and use the established tRPC/Better Auth error types. Do not swallow failures or log secrets/private data; do not introduce a logging abstraction without a concrete need.
- Add or update focused Jest tests for behavior changes. Keep tests near the implementation where that is the existing pattern.
- Keep changes scoped. Update architecture/decision docs only for meaningful design changes, and record significant decisions with evidence rather than invented historical rationale.

## Skills and MCP

- Shared project skills live in `.agents/skills/`; use a relevant `SKILL.md` when its task scope applies. Copilot and Codex both support this location. Claude and Windsurf skill paths are local symlink mirrors; do not replace them with copied skill trees.
- Prisma skills are managed by the `skills` CLI and `skills-lock.json`, not by a Prisma configuration option. Review skill changes when upgrading Prisma; see [agent workflow](docs/AGENT_WORKFLOW.md).
- VS Code MCP servers are defined in `.vscode/mcp.json`; Codex equivalents are in `.codex/config.toml`. Keep the definitions aligned and never commit credentials. Codex project configuration applies only to a trusted project.
- For Next.js changes, use `next-devtools` runtime diagnostics when the development server is available: discover with `nextjs_index`, verify the project with `get_project_metadata`, then use `nextjs_call` for routes, current errors and logs before and after the change. Exercise affected pages in a browser; empty errors do not prove unvisited routes work. Report unavailable diagnostics explicitly and retain focused tests/typechecks. See [Next.js DevTools MCP](docs/NEXT_DEVTOOLS_MCP.md).
- For a significant unfinished task likely to move between agents, update [the shared handoff](docs/agent-handoff.md). It is a Git-tracked checkpoint, not a copy or synchronization of chat history. Avoid simultaneous edits to the same working tree; use separate Git worktrees for concurrent work.

## Commands

Use Yarn 4 (`yarn@4.17.0`, declared in `package.json`). Common checks:

- `yarn dev` starts the development server; `yarn build` builds production output.
- `yarn lint` runs Oxlint and Stylelint; `yarn typecheck` runs TypeScript.
- `yarn jest --runInBand <test-file>` runs a focused Jest test; `yarn test` runs type generation, format check, lint, typecheck and Jest.
- `yarn format:test` checks formatting. Avoid formatting unrelated files.
- Prisma commands use the repository's `prisma.config.ts` and `prisma/schema.prisma`; use `yarn prisma generate` or `yarn prisma migrate dev --name <name>` when the change requires them. Do not commit secrets or local environment files.

Run the narrowest relevant checks first, then broader validation when the change warrants it. Report what was run and any unresolved failures.

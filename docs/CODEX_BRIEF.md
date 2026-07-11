# Vela implementation brief

We are building Vela as a standalone Next.js full-stack app, separate from OpenClaw.

Tech stack:
- Next.js App Router
- TypeScript
- Postgres
- Prisma
- Mantine
- Docker Compose
- REST API first
- MCP later
- Local-first AI later, with LLM/embeddings on the desktop, not the Raspberry Pi

Deployment assumptions:
- Raspberry Pi 5 runs always-on lightweight infrastructure: Vela app, Postgres, Caddy integration, Home Assistant integration jobs.
- Ubuntu desktop with Ryzen 7 7800X3D, 32 GiB RAM, RX 7900 XTX runs AI inference, embeddings, vector DB, and heavy jobs.

Security/auth direction:
- Web UI uses username/password login with secure HTTP-only session cookies.
- REST/MCP/scripts use scoped personal access tokens.
- Do not implement OAuth for v0.
- Store only hashed API tokens.
- Add audit logging for important actions.

First milestone:
Build the smallest vertical slice:
1. Scaffold Next.js + TypeScript + Mantine + Prisma.
2. Add Postgres-backed Prisma schema for users, sessions, api tokens, daily_plans, daily_blocks, audit_log.
3. Add `/api/health`.
4. Add login/logout.
5. Add protected `/today` page.
6. Add API endpoints to create/read today’s plan.
7. Add ability to add a block and mark it done.
8. Add token-based auth middleware with scopes.

Important principle:
AI may parse, classify, summarize, suggest, or embed, but deterministic TypeScript services must validate and apply all state changes.
# Vela Project Plan

_Last updated: 2026-06-18_

## 1. Project Vision

Vela is a standalone personal daily execution app, separate from OpenClaw. It should become a private, canonical system for planning and tracking daily life across tasks, groceries, health, exercise, nutrition, and finance.

The app should use AI where it is useful, but deterministic application code should remain responsible for validation, scheduling, calculations, storage, and state changes.

Core principle:

> AI helps interpret, classify, summarize, and suggest. Deterministic code decides, validates, stores, schedules, and mutates state.

## 2. Ultimate Goals

Vela should eventually support:

1. Day and task scheduling
2. Groceries planning
3. Kitchen inventory tracking
4. Recipe suggestions
5. Health tracking
6. Exercise planning
7. Health metrics tracking
8. Calorie burn versus intake tracking
9. Finance tracking
10. REST API access for scripts and clients
11. MCP access for external AI tools
12. Mostly local AI through local LLMs and embeddings, with optional online fallback for specific tasks

## 3. Technology Stack

Recommended stack:

- Next.js App Router
- TypeScript
- Postgres
- Prisma ORM
- Mantine UI
- Docker Compose
- REST API first
- MCP later as a thin wrapper over the same service layer
- Local LLM and embedding services later, preferably on the desktop

## 4. Deployment Assumptions

### Raspberry Pi 5

Recommended for always-on lightweight services:

- Vela Next.js app
- Postgres, at least initially
- Caddy reverse proxy route
- Home Assistant integration jobs
- Calendar sync jobs
- Normal background jobs
- MCP server if it only wraps the Vela API

Reason: these are network/edge, home automation adjacent, or lightweight utility workloads.

### Ubuntu Desktop

Recommended for heavy services:

- Local LLM runtime
- Embedding model service
- Vector database if it becomes large or compute-heavy
- AI classification batches
- Recipe similarity/search pipelines
- Finance import classification batches
- Other CPU/GPU-intensive jobs

Reason: the desktop has much better CPU/GPU resources and should handle AI inference and heavier processing.

## 5. High-Level Architecture

```text
Web UI: Next.js + Mantine
        |
        v
Vela App API: Next.js Route Handlers
        |
        v
Domain Services: deterministic planning, tasks, groceries, health, finance
        |
        v
Postgres: canonical state, accessed through Prisma
        |
        +--> Background jobs
        +--> REST API clients
        +--> MCP server
        +--> Home Assistant adapter
        +--> Discord/OpenClaw adapter later
        +--> AI gateway to local/online models
```

Important architectural rule:

- Do not put business logic directly in API routes.
- API routes should call domain services.
- Domain services should be testable and reusable by REST, UI actions, cron jobs, and MCP tools.

Suggested structure:

```text
daily-flow/
  app/
    (web)/
      today/
      tasks/
      groceries/
      health/
      finance/
      settings/
    api/
      plans/
      tasks/
      groceries/
      health/
      finance/
      ai/
      integrations/
  src/
    domain/
      planning/
      tasks/
      groceries/
      recipes/
      health/
      finance/
      ai/
      integrations/
    server/
      db/
      jobs/
      auth/
      mcp/
    ui/
      components/
      features/
  prisma/
    schema.prisma
    migrations/
  tests/
    unit/
    integration/
  docs/
    PROJECT_PLAN.md
    CODEX_BRIEF.md
    DECISIONS.md
    TODO.md
```

## 6. Product Modules

### 6.1 Day and Task Scheduler

This is the foundation and should be built first.

Goals:

- Task inventory
- Recurring tasks
- Task dependencies
- Due dates
- Daily plans
- Scheduled blocks
- Check-ins
- Done, skipped, delayed, rescheduled feedback
- Calendar-aware planning
- Workday and weekend planning profiles
- First-step generation for every planned task

Initial planning rule:

- Keep the day small by default.
- For weekdays: 1 P1 task, 2 P2 tasks, and up to 2 XS tasks.
- Every planned task should have a concrete first step of 5-15 minutes.

### 6.2 Groceries, Inventory, and Recipes

Goals:

- Track pantry, fridge, and freezer inventory
- Track expiry dates
- Generate shopping lists
- Store recipes
- Suggest meals based on inventory, nutrition goals, budget, and available time
- Convert meal plans into grocery lists
- Track bought and used-up events

AI use:

- Parse natural language grocery input
- Normalize item names
- Classify items into categories
- Suggest recipes from available ingredients
- Estimate missing ingredients

Deterministic logic:

- Inventory updates
- Expiry tracking
- Shopping list generation
- Recipe ingredient matching
- Cost and nutrition calculations

### 6.3 Health, Exercise, and Nutrition

Goals:

- Exercise planning
- Workout history
- Health metrics
- Weight/body metrics
- Calorie intake versus burn
- Meal logging
- Habit tracking
- Recovery/fatigue notes

AI use:

- Parse workout notes
- Suggest workout blocks based on schedule
- Summarize trends
- Help convert vague goals into concrete plans
- Classify meals from text, with manual confirmation

Deterministic logic:

- Store metrics
- Calculate trends
- Calculate planned versus actual exercise
- Calculate calorie balance
- Enforce configured targets

### 6.4 Finance Tracker

Goals:

- Track accounts, categories, and budgets
- Import CSV or bank exports
- Classify transactions
- Track recurring payments
- Forecast cash flow
- Connect shopping and groceries to budget
- Track project or event spending if useful

AI use:

- Suggest transaction categories
- Explain unusual spending
- Summarize monthly patterns
- Parse simple expense input

Deterministic logic:

- Ledger
- Balances
- Budgets
- Recurring transaction detection
- Reports
- Reconciliation

## 7. Database Approach

Do not design the perfect schema for all modules at once. Start with a stable planning core, then add modules.

### 7.1 Core Planning Tables

Initial core tables:

- users
- sessions
- api_tokens
- audit_log
- themes
- tasks
- task_dependencies
- task_occurrences
- daily_plans
- daily_blocks
- locations
- work_patterns
- day_overrides
- calendar_events
- checkins
- automation_runs

### 7.2 Groceries Tables

Later:

- inventory_items
- inventory_events
- food_products
- shopping_lists
- shopping_list_items
- recipes
- recipe_ingredients
- meal_plans
- meals
- nutrition_estimates

### 7.3 Health Tables

Later:

- health_metrics
- exercise_types
- workouts
- workout_sets
- activity_logs
- body_metrics
- nutrition_logs
- health_goals

### 7.4 Finance Tables

Later:

- financial_accounts
- transactions
- transaction_categories
- budgets
- budget_periods
- recurring_transactions
- transaction_imports
- merchant_aliases

## 8. Authentication and Authorization Plan

Vela will contain private personal data, so it needs real authentication before being exposed to the internet.

Recommended model:

1. Human login for the web UI
2. Scoped API tokens for scripts, embedded clients, REST clients, and MCP clients

Do not start with OAuth. OAuth adds complexity and makes simple scripts and embedded clients harder to build. A first-party login plus scoped personal access tokens is simpler and appropriate for a single-user or personal app.

### 8.1 Edge Layer

Use Caddy on the Raspberry Pi for:

- HTTPS
- Reverse proxying
- Security headers
- Optional IP restrictions later

Suggested route:

```text
daily.example.com -> daily-flow-app:3000
```

Caddy should provide TLS, but Vela itself should enforce authentication and authorization.

### 8.2 Web UI Auth

Use:

- Username/email + password login
- Secure HTTP-only session cookie
- Server-side session storage in Postgres
- Secure cookie settings
- Logout
- Later optional TOTP or passkeys

Session cookie settings:

- HttpOnly
- Secure
- SameSite=Lax or SameSite=Strict
- Reasonable expiration, such as 7-30 days

### 8.3 API Tokens

Scripts, embedded clients, MCP clients, and automation tools should use bearer tokens:

```bash
curl \
  -H "Authorization: Bearer df_pat_live_xxx" \
  https://daily.example.com/api/plans/today
```

Only store a hash of the token in the database. Show the raw token once when created.

Suggested token scopes:

```text
plans:read
plans:write
tasks:read
tasks:write
groceries:read
groceries:write
health:read
health:write
finance:read
finance:write
ai:parse
mcp:access
admin
```

Finance and health scopes should not be granted to MCP clients by default.

### 8.4 Token Types

Human session cookie:

- Used by the browser UI
- Not used by scripts

Personal access token:

- Used by local scripts and REST clients
- Scoped
- Revocable

MCP token:

- Used by MCP clients or OpenClaw
- Scoped
- Should usually avoid finance write access by default

Device token:

- Used by embedded clients
- Narrow scopes
- Optional IP restrictions later

### 8.5 Auth Tables

Suggested Prisma models:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  displayName  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  sessions     Session[]
  apiTokens    ApiToken[]
}

model Session {
  id           String   @id @default(cuid())
  sessionHash  String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  createdAt    DateTime @default(now())
  lastSeenAt   DateTime?
  expiresAt    DateTime
  revokedAt    DateTime?
}

model ApiToken {
  id              String   @id @default(cuid())
  name            String
  tokenHash       String   @unique
  prefix          String
  ownerUserId     String
  ownerUser       User     @relation(fields: [ownerUserId], references: [id])
  scopes          String[]
  createdAt       DateTime @default(now())
  lastUsedAt      DateTime?
  expiresAt       DateTime?
  revokedAt       DateTime?
  allowedIps      String[]
  notes           String?
}

model AuditLog {
  id          String   @id @default(cuid())
  actorType   String
  actorId     String?
  action      String
  resource    String?
  resourceId  String?
  metadata    Json?
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())
}
```

### 8.6 Authorization Policy

Public routes:

```text
/login
/api/auth/*
/api/health/public
```

All other routes require authentication.

API routes require one of:

- valid browser session
- valid bearer token with required scopes

Examples:

```text
GET  /api/plans/today              -> plans:read
POST /api/plans/:date/feedback     -> plans:write
GET  /api/finance/summary          -> finance:read
PATCH /api/finance/transactions/:id -> finance:write
```

Admin routes require:

```text
admin
```

Important helper:

```ts
const auth = await requireAuth(req, { scopes: ["plans:write"] })
```

## 9. AI Strategy

Use a local-first AI gateway.

### 9.1 Local AI Tasks

Use local models for:

- Natural-language task capture
- Feedback parsing
- Grocery input parsing
- Recipe suggestions
- Transaction category suggestions
- Embeddings
- Summaries
- Daily suggestions

### 9.2 Online AI Fallback

Use online models only for:

- Harder reasoning
- Occasional fallback
- One-off complex planning reviews
- Tasks where quality matters more than privacy or cost

### 9.3 AI Gateway

Do not call AI directly from random app code. Put all AI calls behind a service boundary:

```text
src/domain/ai/
  aiGateway.ts
  classify.ts
  embeddings.ts
  structuredOutput.ts
  prompts/
```

Every AI result should become one of:

- classification
- structured command
- summary
- embedding
- suggestion list

Then deterministic services validate and apply it.

### 9.4 AI Event Logging

Store:

- Raw user input
- Prompt version
- Model used
- AI output
- Validation result
- Applied deterministic command
- Final state mutation

This will make debugging much easier.

## 10. REST API Plan

### 10.1 Plans

```http
GET    /api/plans/today
GET    /api/plans/:date
POST   /api/plans/:date/init
POST   /api/plans/:date/run-morning
POST   /api/plans/:date/replan
POST   /api/plans/:date/feedback
```

### 10.2 Blocks

```http
POST   /api/plans/:date/blocks
PATCH  /api/blocks/:id
DELETE /api/blocks/:id
POST   /api/blocks/:id/done
POST   /api/blocks/:id/skip
POST   /api/blocks/:id/reschedule
```

### 10.3 Tasks

```http
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
POST   /api/tasks/:id/complete
POST   /api/occurrences/generate
```

### 10.4 AI

```http
POST   /api/ai/parse-feedback
POST   /api/ai/classify-task
POST   /api/ai/suggest-first-step
POST   /api/ai/embed
```

### 10.5 Groceries

```http
GET    /api/inventory
POST   /api/inventory/events
GET    /api/shopping-lists/current
POST   /api/shopping-lists/current/items
POST   /api/recipes/suggest
```

### 10.6 Health

```http
GET    /api/health/summary
POST   /api/health/metrics
POST   /api/workouts
POST   /api/nutrition/log
```

### 10.7 Finance

```http
GET    /api/finance/summary
POST   /api/finance/imports
GET    /api/finance/transactions
PATCH  /api/finance/transactions/:id
GET    /api/finance/budgets
```

## 11. MCP Plan

REST should be the stable product API. MCP should be a thin wrapper over the same service layer or REST endpoints.

Initial MCP tools:

```text
daily_flow_get_plan
daily_flow_run_morning
daily_flow_apply_feedback
daily_flow_parse_feedback
daily_flow_sync_calendars
daily_flow_project_to_ha
daily_flow_render_discord_preview
daily_flow_create_task
daily_flow_get_inventory
daily_flow_add_grocery_items
daily_flow_get_budget_summary
```

OpenClaw and other AI clients should never directly edit the database. They should call the API or MCP tools.

## 12. UI Plan

Suggested navigation:

- Today
- Tasks
- Calendar
- Groceries
- Recipes
- Health
- Finance
- Review
- Settings

### 12.1 Today Page

Most important screen.

Sections:

- Current block
- Next block
- Timeline
- P1/P2/XS tasks
- Quick feedback box
- Replan from now button
- Add task button
- Add check-in button
- Explanation of what changed

### 12.2 Task Inbox

Fields:

- Title
- Theme/project
- Priority
- Size
- Due date
- Recurrence
- First step
- Energy level
- Location/context
- Dependencies

### 12.3 Plan Review

Show:

- Why tasks were selected
- What was skipped
- What conflicts existed
- What calendar events constrained the plan
- What AI suggested
- What deterministic rules applied

Planner trust depends on explainability.

## 13. Deterministic Planning Model

Planner flow:

1. Load date profile
2. Load calendar busy intervals
3. Load day overrides
4. Materialize fixed blocks
5. Generate due task occurrences
6. Filter blocked tasks
7. Rank candidate tasks
8. Select small daily load
9. Find slots
10. Create blocks
11. Explain decisions
12. Persist plan and audit log

Feedback commands should be transaction-safe and should preserve completed or active blocks by default.

Initial feedback commands:

- done
- skip
- cancel
- delay
- reschedule
- replace
- break
- add-task

## 14. Testing Plan

Prioritize tests around trust-sensitive logic.

### 14.1 Unit Tests

- Recurrence generation
- Task dependency filtering
- Slot finding
- Replanning
- Delay/reschedule conflict resolution
- Calendar override parsing
- Grocery inventory events
- Recipe ingredient matching
- Finance category rules
- Budget calculations
- Token scope checking
- Session expiration

### 14.2 Integration Tests

- Prisma transactions
- Plan creation
- Feedback application
- API auth middleware
- HA projection ownership markers
- Import jobs
- REST endpoints

### 14.3 Golden Tests

Use fixtures for stable planner and parser behavior:

```text
tests/fixtures/plans/weekday_busy.json
tests/fixtures/plans/weekend_free.json
tests/fixtures/feedback/delay_block.json
tests/fixtures/groceries/basic_inventory.json
tests/fixtures/finance/transaction_classification.json
```

## 15. Milestones

### Milestone 1: App Exists

Deliverables:

- Next.js app
- TypeScript
- Mantine shell
- Prisma configured
- Postgres compose service
- Health endpoint
- Dockerfile
- `.env.example`
- Basic docs

Success criteria:

- App runs locally
- `GET /api/health` works
- Prisma migration runs
- App can connect to Postgres

### Milestone 2: Authentication Foundation

Deliverables:

- User model
- Session model
- Login page
- Logout
- Protected route middleware
- Secure session cookie
- API token model
- Token creation/revocation UI
- Scope checking middleware
- Audit log

Success criteria:

- Web UI requires login
- API routes require auth
- Scripts can use bearer tokens
- Tokens can be revoked
- Only token hashes are stored

### Milestone 3: Today Works

Deliverables:

- daily_plans table
- daily_blocks table
- Today page
- Create/read today’s plan
- Add block
- Edit block
- Delete block
- Mark block done

Success criteria:

- User can create today’s plan
- User can add a block
- User can mark it done
- State persists after refresh

### Milestone 4: Tasks Plan Into The Day

Deliverables:

- Task inventory
- Task occurrences
- Recurrence generation
- Planner service
- Replanner service
- First-step field
- Feedback commands

Success criteria:

- Morning planner creates a realistic day
- Every task has a 5-15 minute first step
- Delaying one block shifts later movable blocks safely
- Completed or active blocks are preserved during replanning

### Milestone 5: Calendar-Aware Planning

Deliverables:

- Home Assistant calendar import
- Calendar events table
- Day overrides
- Work schedule materialization
- HA projection to `calendar.daily_flow`
- Safe ownership markers for projected events

Success criteria:

- App imports external calendar context
- Vela output appears in Home Assistant
- Vela does not import its own output calendar as planner input
- Override calendar can mark WFH, PTO, custom work hours, or no-work days

### Milestone 6: AI Input Works

Deliverables:

- Local LLM connection
- AI gateway service
- Structured feedback parser
- Task classifier
- First-step suggester
- AI event log

Success criteria:

- Natural language feedback becomes proposed deterministic commands
- Invalid AI output is rejected
- User can approve before applying, at least initially
- State changes still go through deterministic services

### Milestone 7: Food Module

Deliverables:

- Inventory UI
- Shopping list UI
- Recipe storage
- Meal plan blocks
- Grocery parser
- Recipe suggestions

Success criteria:

- User can add groceries from text
- App can generate a shopping list from planned recipes
- App can suggest meals based on inventory
- App can add cooking blocks to the daily plan

### Milestone 8: Health Module

Deliverables:

- Workout planning
- Workout logs
- Health metrics
- Nutrition logs
- Calorie intake/burn overview

Success criteria:

- User can plan workouts
- User can log workouts
- User can track metrics over time
- User can compare calorie intake versus estimated burn

### Milestone 9: Finance Module

Deliverables:

- Transaction import
- Categories
- Category rules
- AI categorization suggestions
- Budgets
- Reports

Success criteria:

- User can import transactions
- Transactions can be categorized
- Budget summary is visible
- Spending patterns are explainable

### Milestone 10: MCP Integration

Deliverables:

- MCP server
- MCP auth token
- MCP tools wrapping service/API functions
- OpenClaw integration path

Success criteria:

- OpenClaw can read today’s plan
- OpenClaw can propose feedback
- Vela validates and applies feedback
- No external agent directly mutates database state

## 16. Initial REST Endpoints for Milestone 1-3

```http
GET  /api/health
GET  /api/plans/today
GET  /api/plans/:date
POST /api/plans/:date/init
POST /api/plans/:date/blocks
PATCH /api/blocks/:id
DELETE /api/blocks/:id
POST /api/blocks/:id/done
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/admin/tokens
POST /api/admin/tokens
DELETE /api/admin/tokens/:id
```

## 17. Immediate Next Step

Start with this narrow vertical slice:

1. Scaffold Next.js + TypeScript + Mantine + Prisma.
2. Add Postgres through Docker Compose.
3. Add `users`, `sessions`, `api_tokens`, `audit_log`, `daily_plans`, and `daily_blocks` to Prisma.
4. Add `/api/health`.
5. Add login/logout.
6. Add protected `/today` page.
7. Add create/read today’s plan.
8. Add the ability to add a block and mark it done.
9. Add bearer-token auth middleware with scopes.

This creates a secure, useful foundation without overbuilding the groceries, health, finance, or AI modules too early.

## 18. CODEX_BRIEF.md Suggested Companion File

Create a shorter file at `docs/CODEX_BRIEF.md` for Copilot/Codex:

```md
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
```

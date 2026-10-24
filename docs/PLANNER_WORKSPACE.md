# Planner Today workspace

Issue #59 Phase 1 adds candidate tasks, the existing Mantine DayView and Planner
chat, in that order, at `/planner/today`. The schedule starts with 48% of the
workspace; task and chat columns start with 22% and 30%. Mantine Splitter retains
resizing with minimum widths. Below Mantine's `lg` breakpoint, a surface selector
shows one pane at a time. CSS hides inactive panes without unmounting them, so
switching to the calendar preserves the chat stream, draft input and task filters.

The existing task picker and calendar handlers retain manual task scheduling,
block dragging, moving, resizing, editing and removal. Today’s toolbar keeps
Generate and Adjust remaining day. The chat’s application-owned planning card
expands the existing `ProposalWorkspace`, including generation, review,
replanning, saved previews and explicit acceptance/discard controls. These controls
also work before a conversation is started. No AI response can directly mutate a
schedule.

## Conversation and context

`ConversationChat` reuses the AI Dev UI lifecycle: model selection, saved
conversations, new conversation, deletion, response streaming, cancellation,
loading/error/retry states and interrupted-response recovery. Planner automatically
reopens its latest saved conversation after an authorized list read. Basic
Markdown supports headings, bold text, inline code and bullet markers; raw HTML
is escaped and links/images are not interpreted.

`createConversationService` and `createChatService` reuse the existing AI SDK,
Ollama resolution, transactional turn claims, stable message IDs, generation leases,
model attribution, owner checks and history bounds. The additive `AiConversation.scope`
column defaults old histories to `ai-dev`. Every Planner conversation operation
uses `planner` scope and the existing `planner.conversation` model setting;
AI Dev continues using its own scope and setting. These streaming histories remain
separate from the older structured PlannerConversation/PlannerTurn command records.

Protected `plannerChat` tRPC procedures handle conversation CRUD and model
changes. `/api/planner/chat` authenticates, checks same-origin requests, validates
text-only input and a calendar date, then delegates streaming to the Planner
service. The server verifies conversation ownership before reading context.

For each request, the transport reads the current workspace date. The server loads
fresh owner-scoped proposal context and day data through existing application
services. Only the selected date/timezone, up to 24 availability windows, 80 day
blocks and 40 eligible candidate summaries reach the model. Titles are capped at
240 characters and omitted record counts are explicit. Task descriptions, the
entire task inventory and arbitrary client-supplied planning context are not sent.
Source reads use the existing services; the proposal snapshot service still reads
the owner's wider planning data internally. This is bounded model context, not a
new optimized database retrieval path or an atomic snapshot across both services.

The specialized prompt treats application titles as data, says the selected date
is authoritative for this turn, and requires advisory answers. No model tools
are exposed in Phase 1. Existing history limits (100 messages / 64,000 characters)
require a new conversation rather than silently dropping history. Conversation
compression and token indicators remain deferred.

## Migration and verification

Apply `20261024130000_planner_chat_scope` through the normal migration deployment,
regenerate Prisma and restart/rebuild before using Planner chat. This change does
not apply migrations to the application database automatically. No new dependency,
provider configuration or secret is required.

Tests cover owner/scope isolation, model inheritance, streaming lifecycle,
selected-date changes without recreating the transport, bounded context,
authorization before context reads, HTTP authentication/origin/input/error handling,
and safe basic Markdown. Existing task-picker and proposal tests remain in place.
Authenticated desktop/mobile visual checks and live Ollama conversation testing
remain manual verification steps; browser automation is unavailable in the current
environment.

## Following phases on the same branch and PR

Keep #59 open: cross-linked task/block highlighting and conversational proposals
remain beyond this foundation. #73's full modal redesign and zero-allocation
cleanup are deferred; the permanent left candidate list remains available.

For #37, connect typed planning-command interpretation and existing generation,
review and proposal services to this conversation boundary. Persist typed result
references alongside turns, render application-owned proposal cards using
`ProposalWorkspace`, and coordinate selected date/proposal IDs and task/block
highlighting in Today. Store the date/context fingerprint with each actionable
turn; require fresh validation and explicit acceptance for state changes. Reuse
existing stale-proposal and idempotency checks. Then add #38 record operations
through their existing preview/confirmation services. Do not run a second command
chat or give the model unrestricted database access.

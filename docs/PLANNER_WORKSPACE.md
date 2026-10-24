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
were exposed in Phase 1; Phase 2 below adds the typed tool boundary. Existing history limits (100 messages / 64,000 characters)
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

The original Phase 1 continuation plan for #37 was to connect typed planning-command interpretation and existing generation,
review and proposal services to this conversation boundary. Persist typed result
references alongside turns, render application-owned proposal cards using
`ProposalWorkspace`, and coordinate selected date/proposal IDs and task/block
highlighting in Today. Store the date/context fingerprint with each actionable
turn; require fresh validation and explicit acceptance for state changes. Reuse
existing stale-proposal and idempotency checks. Then add #38 record operations
through their existing preview/confirmation services. Do not run a second command
chat or give the model unrestricted database access.

## Phase 2 — conversational planning (#37)

The same Planner chat now exposes a bounded AI SDK tool loop. It does not run the
older command conversation UI or a second scheduler. `lib/planner/chat/tools.ts`
is the authenticated-user-bound adapter; arguments use the existing Zod planning
schemas. Tools cannot approve changes, mutate task/theme inventory or query Prisma
arbitrarily.

| Tool | Application behavior |
| --- | --- |
| `getPlanningContext` | Bounded authorized day, availability, task and block summaries. |
| `generateDayPlan` | Existing `generation/service.ts::generateDayPlan`, including AI selection, placement, report and proposal creation. |
| `proposeScheduleChanges` | Existing `conversation/planning.ts::planInstruction`; edits, free intervals and #36 `proposalService.replan`. |
| `replaceScheduledBlocks` | Replace selected planned blocks with one eligible task in one validated proposal, retaining exact times and unrelated changes. |
| `reviewDayPlan` | Existing #35 review service, with verified conflicts separated from advisory AI concerns and validated correction previews. |
| `explainPlanningDecision` | Saved generation reports, omissions and change explanations; no additional scheduler/review inference. |

`planner.conversation` and conversation overrides select only the orchestrator.
The generator independently resolves `planner.dayPlan`; optional AI review resolves
`planner.planReview`. All retain existing Ollama/provider conventions. The ordinary
Generate, Review and Replan UI calls these same underlying services.

### Proposal lifecycle

Tools create canonical #33 proposals without applying them. Application-owned
cards reuse `ProposalWorkspace` and `PlanReview` inside messages. Inline cards show the saved preview without repeating generation/edit forms;
controls retain Apply/Discard and add Revise in chat. Allocated tasks and deadline
omissions stay prominent; other zero-allocation outcomes collapse into optional details. Revisions compose specific edits with
pending changes; full generation refinements regenerate through the existing
scheduler. A successfully revised preview discards its predecessor. Failed,
ambiguous or stale revisions retain the prior preview. Progress replanning of a
pending generated preview requires accepting/discarding it first; completed and
protected work retain the existing #36 policies.

Compact typed `data-planning` message parts persist proposal references, dates and
bounded review results. Selection-only provenance survives revisions without
reusing obsolete allocation counts. Provider-specific tool transcripts are not saved. Reloads
restore cards; retries replay completed replies and recover saved proposals using
stable owner/turn/argument request identities. Identical calls are idempotent;
changed arguments constitute a new proposal request. Calls within one agent turn
are serialized. The existing conversation generation lease fences simultaneous
turns. A late, interrupted tool can leave a pending preview in Saved proposals;
it cannot apply anything. Saved previews remain recoverable independently of chat.

The server verifies explicit workspace-selected proposal references against owner
and date. Otherwise it retrieves this conversation's latest reference for the
selected date. Accepting/discarding a proposal is reflected by fresh status reads.
Changing conversations clears the transient calendar preview. Changing dates
isolates the preview and pending reference by date; prior cards remain readable.
Manual calendar changes invalidate fingerprints; polling and mutation invalidation
remove invalid overlays and disable application. Acceptance still locks, rechecks
current inputs and validates all operations atomically; duplicate acceptance uses
the existing receipt. Reset/deletion does not silently discard or apply proposals.

The transient workspace store holds IDs and focus only. Proposal content stays in
tRPC/TanStack Query. Show preview navigates to its date and adds labeled blue
proposal events to the existing DayView. These events cannot be dragged/resized and
are excluded from manual placement collision checks. Selecting a proposal item
highlights its task and block; current task/calendar editing handlers remain.
Review findings can highlight affected blocks, and their corrections use the same
proposal/acceptance flow. A correction created from a review card becomes the
selected workspace proposal; after reload it is also available in Saved proposals.

### Scheduling guidance and diagnostics

The conversational generation tool accepts only a date and guidance. The chat
passes requests, hints, constraints, durations, ordering and priorities to the
existing scheduler instead of classifying or rejecting hard requirements itself.
The latest user message is preserved verbatim, with bounded conversation guidance
appended when space permits. The scheduler handles interpretation and reports the
actual placements and unmet requests. Saved availability, task eligibility,
placement rules, proposal validation and explicit approval remain deterministic.
Proposal cards use a short summary heading while keeping detailed results available
to chat and the saved preview. Older multiline results display their first line.
Generation tool replies include actual per-task allocated minutes, omission reasons and warnings so the chat can distinguish the result from requested preferences. For replacements across multiple blocks (for example Vela blocks after 20:30), chat selects exact preview/block IDs in the planning timezone and an exact eligible candidate ID; the application preserves the recorded intervals and validates the complete revision atomically. Ambiguous, protected or stale selections leave the prior preview available.

Guidance is not a guarantee that an arbitrary requested restriction was enforced.
Typed `freeTimes`/`taskLimits` remain available to application services, but chat
no longer has to extract them before requesting a plan.

Each assistant turn has a collapsed **Planner debug** inspector below its content.
It streams and persists selected model-request settings/context, structured tool
arguments (the observable interpretation), tool replies, argument/execution errors,
model step finish reasons and token counts, elapsed time and final status. It does
not expose raw reasoning, HTTP headers, environment values or arbitrary SDK error
objects. Details are rendered as escaped text; credential-shaped fields/messages
are redacted. Payloads cap at 8,000 characters, with at most 40 events / roughly
48,000 characters per response; omissions/truncation are explicit. Diagnostics use
existing owner/scope-protected message JSON and restore after reload/replay. They
are not sent back as model conversation context. Old responses cannot recover
previously discarded tool/error information; retrying records a new trace.

Planner orchestration disables Ollama thinking, allows 4,096 output tokens and
uses a 150-second total deadline within the existing 180-second turn lease. This
prevents a thinking model from spending the previous 2,048-token budget entirely
on hidden reasoning. Empty/length-limited responses, model startup errors and tool-only
failures get explicit user-visible failure text and a saved diagnostic trace;
cancellation remains distinct. Normal AI Dev chat keeps its existing behavior.
Successful tools can still leave recoverable pending previews if a later model
step fails; nothing is applied automatically.

Planner input is limited to 2,000 characters. Inference uses the most recent 12
text messages (at most 2,000 characters each), fresh bounded day context and a
pending preview summary. Review cards cap findings/blocks/corrections to a roughly
12,000-character result and indicate omitted options. No new migration or dependency
is needed; the Phase 1 scope migration still needs deployment where absent.

### Verification still requiring a live environment

Use a tool-capable Ollama conversation model and a separately configured scheduler
model. Verify desktop/mobile drag/drop/resize, inline preview highlighting, live
streaming/retry and the sequence Generate → Move → Keep free → Accept. Verify
model unavailability, switching dates/conversations, reload, and a manual edit
between preview and acceptance. Automated service/component checks do not replace
these authenticated browser and actual-model acceptance checks. Keep #37 open until
that acceptance is confirmed; #38/#39/#40 and the full #73 modal redesign remain
outside this phase.

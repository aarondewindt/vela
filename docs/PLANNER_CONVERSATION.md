# Planner conversation (#37 and #38)

Open **Planner → Conversation** and create or resume a conversation. Configure an
LLM through Settings; `planner.conversation` inherits Balanced / Default LLM.
The conversation classifies requests and interprets structured instructions using
shared bounded AI generation. Application code resolves records, validates fields,
computes relative deadlines, builds proposals and applies accepted changes.

## Supported requests

- Generate a day, carrying earlier guidance into a corrected generation; explain a
  current/pending day using saved selection reasons and the existing plan review.
- Add, move, resize, remove or replace task blocks. A correction can edit a pending
  addition in place while retaining unrelated operations. The revised preview
  supersedes the earlier one and is validated against the current source fingerprint.
- Extend, finish, postpone, skip, cancel or replace work and replan downstream blocks
  through the existing deterministic progress service. Additional minutes are added
  to the recorded block end in the saved timezone. Finishing only completes work
  when explicitly requested. A pending progress proposal must be applied/discarded
  before another progress adjustment.
- Reserve an explicitly timed free interval through a leisure reservation, releasing
  overlapping flexible allocations and keeping tasks. Protected commitments require
  clarification. Discard an existing preview before adding this reservation.
- Find tasks/themes; create, update or delete one record per turn. Exact names/IDs
  precede substring matching. Ambiguous or missing matches return a question and
  bounded record choices instead of choosing a match arbitrarily.

Task fields match the regular task API: title, brief, status, priority, size, due
calendar date, estimate, lead time, category, tags and theme assignment/clearing.
Theme fields are name, brief, color, category and active state. Rich content,
recurrence, locations, dependency editing, calendar imports and availability-profile
changes are outside this interpreter's schema. Requests for unsupported properties
are directed to the regular workflow rather than exposing unrestricted database tools.

“Keep the afternoon free” requires explicit interval clarification. “Something easier”
requires selecting a replacement rather than inferring an arbitrary record. The
interpreter receives authoritative today/tomorrow in the user's saved timezone,
selected date, recent turns and the pending preview. An explicit unquoted “due
[today/tomorrow/yesterday]” is normalized by application code. Invalid/ambiguous DST
wall times are rejected. A different saved-plan timezone requires using the regular
plan review for explicit time adjustments.

## Preview and acceptance

Messages never apply changes. Plan previews use `ProposalWorkspace` and the existing
proposal acceptance service, including stale checks, expiry, deterministic constraints
and receipts. Task/theme previews show the resolved record, requested fields and
before/after values and resolved theme names. Deletion additionally requires a checkbox and **Confirm deletion**;
writing “yes” in chat does not bypass acceptance. Theme deletion retains tasks with
no theme. Task deletion uses the existing deletion service: occurrences/dependencies/
reviews/index records cascade, while plan blocks retain their history with no task link.

Record acceptance rechecks a fingerprint of owner tasks/themes and related occurrence,
block and dependency versions inside the same short transaction as the existing
application service calls and receipt persistence. Concurrent acceptance replays the
receipt. Replaying after subsequent deletion does not recreate a task. A failed
receipt write rolls back domain changes. A new preview supersedes the previous one;
clarification/find turns leave the existing preview available for correction. Discard
explicitly retires a preview without applying it.

Conversation reads/writes are owner-scoped protected tRPC procedures. Accepted record
changes invalidate regular planner, proposal, search and task-review query caches.
Task writes retain the existing durable index refresh triggers. Planning changes
invalidate Today/Tasks through the shared proposal workspace.

## Persistence, retries and limits

`PlannerConversation` stores owner/revision and a generation lease.
`PlannerConversationTurn` stores a stable client request ID, input fingerprint, text,
structured result/model attribution, status and acceptance receipt. Retry IDs cannot
be reused with different inputs. A completed request replays before model resolution.
One generation runs per conversation; failed/expired generations can be retried, and
revision/token/expiry checks fence late results. Model calls and placement run outside
transactions. Classification and interpretation share a 150-second deadline; the
six-minute lease also covers subsequent day generation/review.

The implementation uses the proposal service's table-lock ordering, extended with
conversation tables, to cover legacy writers and inserts during short persistence
transactions. These locks serialize briefly across users and are a deliberate
concurrency cost; owner advisory locks alone would not cover existing writers.

Messages are bounded to 2,000 characters, inventories to 1,000 tasks/themes, recent
model history to eight turns, and find/ambiguity responses to 30/12 matches. The
pending preview is loaded independently of the history limit. The shared AI context
limit rejects oversized prompts without applying changes. Conversations persist
until owner deletion; there is currently no conversation deletion or history pagination
UI. Replies are request/response, not streamed.

Apply additive migration `20261020180000_planner_conversations` using the ordinary
[backup/migration procedure](DAILY_USE_DEPLOYMENT.md), then generate Prisma Client
and rebuild. This task's validation applied migrations only to temporary databases;
the daily-use database and public process were unchanged.

## Validation

Focused Jest coverage includes owner boundaries, ambiguous names, field validation,
relative deadlines, pending corrections, timezone conversion/DST, reservation safety,
revision/lease fencing, retries, receipts, stale edits, deletion confirmation and UI
retry identity. Isolated PostgreSQL checks prove concurrent acceptance, receipt replay
after deletion, stale rejection, theme/task relationship behavior and real transaction
rollback on receipt failure. Synthetic `qwen3:8b` turns exercise creation, timezone-aware
deadlines, follow-up correction and explicit acceptance.

The full Jest suite, TypeScript, Prisma validation, scoped new-code lint/format and
an isolated Turbopack production build passed. Full repository lint remains blocked
by existing curly-brace/unused-import errors in older planner and shell code.
Desktop and 390px production-browser checks passed record acceptance, regular Tasks
refresh and shared plan preview/apply without runtime errors. The temporary servers,
databases and synthetic users were removed afterward.

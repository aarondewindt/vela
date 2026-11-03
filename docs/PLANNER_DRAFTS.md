# Persistent Planner drafts

The November 2, 2026 requirements in #119, #59, #37 and #73 supersede the
proposal-card workflow described in earlier Planner documents.

## Persistence foundation (#119)

`PlannerDraft` is a complete intended schedule for one owner/local date, independent
of conversations. A PostgreSQL partial unique index allows only one OPEN draft per
date. Closed drafts, their base snapshots and request receipts remain available.
Existing DailyPlan/DailyBlock/PlanningProposal rows are retained by the additive
`20261102220000_planner_working_drafts` migration. A legacy current DailyPlan whose
status is DRAFT is treated conservatively as the current base, never discarded.

Protected `plannerDraft` procedures expose read, begin, applyChanges, undo, redo, refresh,
accept and cancel. Mutation inputs include draft identity, expected version and a
stable UUID request ID. The first apply can use null identity/version zero: it
copies current intended state (or an empty schedule) and applies the initiating
action in the same transaction. Failed validation rolls creation back. Read-only
questions need no draft. Persistent draft state belongs in TanStack Query, not
Zustand or the conversation history.

Each manual action or application batch produces one complete server revision.
The cursor and redo branch survive reload. New edits after undo discard the redo
branch. At most 100 snapshots are retained per draft, including the current
revision; the separate base and durable request receipts are never pruned by undo.
Request IDs cannot be reused with different payloads, including after cancellation
or acceptance. Successful retries return their original receipt. Reload after any
mutation to obtain the current server version rather than trusting an old receipt.

`drafts/state.ts` adapts snapshots for the existing proposal validator and scheduler.
It does not schedule independently. Validation has three explicit policies: strict
automatic scheduling, structurally permissive manual editing, and hard-consistency
acceptance. The existing operations remain validation primitives; `retime` represents
a combined move and resize without replacing block identity. Proposal cards are not
draft storage. Draft operations reject actual finish/skip/extend commands and never
write task progress, outcomes or estimates.
Manual origin, manual override and explicit lock are separate fields. A lock
prevents edits even with an explicit operation. Manual overrides protect AI-origin
blocks after a user moves or resizes them.

## Conflicts and acceptance

The draft stores the current base identity and a hash of relevant authoritative
inputs: current schedule, timezone, scheduled-task eligibility/recurrence/effort,
dependencies, availability, busy commitments and other allocations of those tasks.
Task descriptions, unrelated tasks and out-of-day calendar metadata do not stale
a draft. Read reports conflicts while keeping all saved revisions intact.
Explicit refresh is permitted only with an identical current base and successful
complete net validation. An active-base conflict requires preserving the draft for
comparison or cancelling and starting from the new active version. No automatic
merge can overwrite authoritative changes.

Manual edits enforce ownership, references, selected-day bounds, positive whole-minute
duration and protected/locked history. They intentionally permit temporary block,
busy-event and category-slot overlaps, placement outside availability, category or
leisure mismatches, and task-estimate overrides. These states are complete revisions,
so reload, undo/redo and input refresh do not erase them. Strict AI generation still
uses availability, task effort, categories, leisure reservations, protected blocks and
the other scheduler rules; normal generation cannot remove manual origins or overrides.

Acceptance revalidates the net schedule changes, not obsolete intermediate edits,
against current inputs and time. It rejects overlapping occupied blocks, busy calendar
events, overlapping category reservations, invalid day/duration bounds and protected
history or lock violations. Conflict messages identify block/event/slot IDs, titles and
local ranges where available. Non-busy calendar overlaps, availability, category/leisure
guidance and task estimates are not acceptance failures. Rejection leaves the OPEN draft
and every revision intact. Elapsed/started/completed/calendar history is preserved.
Unaccepted past-day drafts remain saved and cannot be promoted.

Acceptance atomically marks the previous plan non-current, creates the next ACTIVE
version and copies intended blocks/reservations. Previous blocks/check-ins remain
on their original version; existing occurrence IDs, outcomes, content and completed
instants are retained. Only new scheduled tasks materialize occurrences. Existing
task status/progress is never inferred from scheduling. The receipt maps draft
block IDs to new active IDs. A failure at any point rolls back the entire promotion.

Short transactions use the same ordered table locks as existing proposal acceptance
to fence legacy writers that lack owner-level locks. This is deliberately coarse
for the private app; inference must stay outside these transactions. The unique
draft index and expected versions protect multi-tab edits. Acceptance rejects an
ambiguous legacy current base rather than deleting data to repair it.

## Validation and remaining integration

Focused state and authenticated router tests cover manual intent, both-edge/combined
retiming, every permissive override, hard acceptance conflicts, net-empty edits,
history protection, progress rejection and DST. Opt-in real PostgreSQL tests create an isolated schema,
apply all migrations, exercise create/edit/history/retries/races/acceptance/staleness
and inject a late transactional failure to verify rollback:

```sh
NODE_OPTIONS=--experimental-vm-modules VELA_PLANNER_DRAFT_DB_TESTS=1 yarn jest --runInBand lib/planner/drafts/database.test.ts
```

The Today workspace, manual handlers, shared generator/review and conversational
tools now use this API. Legacy manual routes stage drafts; legacy proposal acceptance
is disabled so an old client cannot bypass whole-draft acceptance. Old data remains
stored. Draft-only task references travel in the snapshot adapter without fake or
premature occurrences. The adapter also counts their allocated effort, avoiding
duplicate allocation during regeneration. Chat-directed placements retain AI origin
with an explicit user-intent override; manual origin, override and lock stay distinct.

See [workspace workflow](PLANNER_WORKSPACE.md) and [verification evidence](PLANNER_DRAFT_VERIFICATION.md).

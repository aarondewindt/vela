# AI day planning

Implemented for #34 and updated by #69 to use the #126 effective-availability
foundation, the #31 [scheduler policy](PLANNER_SCHEDULER_POLICY.md), and persistent
working drafts from #123.

## Using it

Open **Planner → Today → Generate plan**, optionally enter one-off guidance, and
review the resulting working-draft revision before accepting the whole draft. One
bounded model call returns typed intent for every effective availability slot. The
application resolves categories, validates eligibility, places timestamps, enforces
constraints and saves the revision.

New same-day placements leave at least ten minutes after scheduling for review.
The preview shows **Apply before** using its earliest proposed task, break or leisure
reservation. A local clock disables acceptance when that start passes; the server
still revalidates on acceptance. An expired preview offers **Generate fresh preview**,
using the saved method and guidance. Planning input changes can require regeneration
before the displayed deadline. Generation never shifts an existing preview silently.

**Settings → AI & models → Planner · Day planning** chooses the model. It inherits
Balanced / Medium, then Default LLM, unless configured explicitly. An unavailable,
timed-out or invalid model response leaves the draft unchanged and produces an
actionable error. Vela does not invoke a deterministic fallback. The legacy explicit
Auto-fill surface remains temporarily until #124 and is not used as failure recovery.

Global one-off guidance outranks saved slot guidance as a soft preference. Slot
category policy is always a hard automatic-placement constraint. The model may
intentionally underfill or leave a slot empty; there is no application fill pass
that silently adds omitted tasks. Gaps between effective slots are unavailable,
and adjacent slots remain separate boundaries.

By default, regeneration replaces eligible future automatic placements while
preserving manual, locked, fixed, calendar-backed and meal blocks. Explicit rebuild
may also replace otherwise eligible manual placements, but never protected blocks.
Category reservations and the remaining legacy generator surfaces stay compatible
until #124 removes them; Today saves generated working-draft revisions.

## Responsibilities and persistence

Protected `plannerDraft.generate` delegates through
`lib/planner/drafts/generation.ts` to `lib/planner/generation/service.ts`; Planner
conversation uses the same path. Generation reads a consistent owner-scoped
snapshot, performs inference outside transactions, computes placements, and saves
one fenced draft revision. Invalid intent or changed inputs fail before the draft is
modified.

AI returns slot identity, target task minutes, ordered eligible task aliases and
bounded reasons—never timestamps or categories. Application code clamps slot and
task budgets, enforces remaining estimates and category policy, and owns splitting,
rest and final placement. A generated block never crosses a slot boundary; one task
may span slots only as independently eligible segments. Meals and generated breaks
are not task-category filtered. Manual draft edits and acceptance remain permissive
about availability and category advice under #123.
A busy meeting does not
count as rest; a WORK/LIFE category change does not reset a session.

The main summary and per-task placement explanations are calculated from actual
blocks, minutes and saved-zone times, including partial and zero placement. AI
selection notes are kept under **AI assessment before scheduling**; they are not
presented as statements about where tasks actually landed. The model prompt includes
the earliest planning start and clipped future availability, and prohibits claiming
placements or day-part timing before the application schedules work.

Each successful generated revision stores the effective-availability snapshot/hash
actually used. Acceptance independently stores the effective availability present
at acceptance, allowing generation and acceptance context to differ. Failed attempts
store bounded sanitized diagnostics for 30 days and at most 100 records per owner;
full prompts, raw model output and secrets are not retained.

A saved generation request replays its draft request receipt before resolving a
model. Reusing its request ID with changed generation inputs fails. Revision saves
recheck both draft version and the planning snapshot used before inference. Sparse
valid intent can still create a provenance-bearing revision; no-availability state
does not create or modify a draft revision.

## Candidates, context and limits

Eligibility uses current task/occurrence status, unresolved hard prerequisites,
selected date and earliest start. Due dates propagate through hard dependency
chains. BACKLOG and IN_PROGRESS tasks remain candidates when they have planned or
active blocks on earlier or later dates. Open non-recurring occurrences can be
continued before or after their original date; future recurring occurrences still
respect their recurrence date. Planning adds a block for the existing occurrence
and preserves other dates' blocks. Moving those blocks or asking whether to move
versus add is deferred.

Remaining work subtracts actual DONE effort across current plans and selected-day
PLANNED/IN_PROGRESS commitments, separately per recurring occurrence. Other dates'
uncompleted allocations do not consume today's effort budget. If completed effort
has exhausted a positive estimate while the task remains unfinished, a labelled
25-minute continuation allowance keeps it discoverable without changing its estimate.
Creation and acceptance use the same accounting and warn about retained blocks on
other dates. Session finish extensions still inspect all commitments, so continuation
cannot falsely qualify as completing the whole task. Missing effort uses the existing
25-minute default and is identified in the report. Blocked tasks are reported;
scheduling a prerequisite does not unlock its dependents.

When guidance is present, semantic retrieval uses the existing owner-scoped task
index with a 12-second inference deadline. Stale vectors are excluded; pending
index work and unavailable semantic retrieval produce warnings. Fresh task facts
and urgency ranking remain available. Generation never rebuilds or processes an
existing user's index. Index refresh and richer retrieval remain with #7.

The AI context includes every eligible due/important candidate independently of
semantic top-k, then semantic matches and urgency-ranked other work. It is bounded
to 60 occurrences with short title/brief/notes/first-step/theme/tag excerpts and
up to 200 dependency edges. More than 60 due/important occurrences rejects AI
planning explicitly and leaves manual planning available. Up to 1,000 eligible
occurrences are supported overall. Every candidate outside the AI context remains
reported and unscheduled. The model uses short request-local candidate aliases
(C1, C2, etc.); the server maps them back to owned task/occurrence references and
validates eligibility independently for each slot. Unknown, repeated, hard-ineligible
or contradictory references reject the single model attempt before persistence.
The shared structured generator bounds total prompt, output tokens and generation
time; provider failures preserve the draft.

Recurring work does not need the legacy generator to materialize occurrences.
Existing open occurrences through the selected date can be planned. A supported
recurring task due on the selected date can also have a virtual candidate when no
occurrence for that date exists. Acceptance creates it once with RECURRENCE origin;
preview and discard do not create occurrences. No missed dates are backfilled and
closed occurrences are not resurrected. Rules are limited to the legacy anchored
DAILY/WEEKLY/MONTHLY/YEARLY interval behavior, with BYDAY only for WEEKLY. Unsupported
syntax is reported. This is not full RRULE expansion or #32 task analysis.

Leisure reservations are best effort, distributed across unreserved future free
time using configured short/max block lengths. Existing leisure reservations count
toward the target; shortfall is reported. Task selections may fit only partially,
or fail placement; the application reports this instead of overbooking. This is
a bounded greedy scheduler, not a guarantee of a globally optimal packing.

## Daily meal requirements and default

AI is the default for both Today and omitted API modes. There is no automatic
model-free rollback after AI failure.
Enabled [daily meals](PLANNER_MEALS.md) reserve continuous blocks before optional
work/leisure and remain independent of the model's task budget or omissions.
Previews report each scheduled/preserved/skipped/unmet meal and bounded timing/count
diagnostics. See [evaluation and limits](PLANNER_EVALUATION.md) for test evidence,
real-model measurements and remaining manual review under #41.

## Verification

Colocated tests cover candidate eligibility/deadline propagation, per-slot intent,
semantic fallback, malformed model references, replay and input
validation, plus task-boundary sessions, preserved history, calendar rest,
category reservations, leisure, recurrence, minute rounding, DST, the review buffer,
small-gap/remainder avoidance and intact later placement. Component
checks cover generation guidance/method selection, displayed deadlines, expiry/regeneration,
separate AI assessments and explicit acceptance.

Live synthetic PostgreSQL/Ollama checks remain opt-in. Browser checks should cover
unavailable-model errors, unchanged drafts, preview/apply and desktop/390px layouts.
Temporary fixtures are removed after verification.

## Requested task durations

Chat planning uses saved availability and the existing current-time cutoff automatically.
Approximate durations, ordering and relative emphasis belong in guidance. The model
returns one target task-minute budget per slot, not per-task durations. Application
placement caps that slot budget at remaining effort, available time and existing
session constraints; it does not add an unguided fill pass.

Application callers can request an explicit maximum, such as “clean my room for max 30 minutes,” using typed
`taskLimits: [{taskQuery, maxMinutes}]`. The generation service resolves names/IDs
within the owner's snapshot and clarifies unknown/ambiguous matches before inference.
Canonical limits retain the owned task ID, title, a stable request-time boundary and
maximum. All remaining PLANNED/IN_PROGRESS minutes for that task after the boundary,
including preserved commitments and separate occurrences, count toward the maximum;
completed history is retained. Existing commitments already above the maximum require
explicit adjustment rather than silent removal. Generation, revision, correction and
acceptance use the same accounting function and validator. Limits survive regeneration,
are shown in previews, and do not alter task effort or future independent plans.

Conversational generation passes the original request and relevant context as
guidance; the chat does not classify hard requirements or reject the request before
calling the scheduler. Typed limits remain an application API feature. Guidance
alone is not represented as a verified arbitrary hard constraint. Scheduler reports
and validated proposals describe the actual result; chat must not ask users to
re-enter saved availability or reserve an empty interval for a task.


### Guided allocation regression check

`node --conditions=react-server --import tsx scripts/evaluate-planner-allocations.ts`
runs the selection contract and deterministic placement with synthetic tasks only;
it reads no user records and saves no proposals. It uses configured Ollama and
`PLANNER_EVAL_MODEL` (default `qwen3:8b`). It verifies that a real structured response
resolves through the bounded alias contract and that every generated operation stays
inside the supplied effective slot. This is one synthetic real-model case, not general
natural-language compliance evidence.

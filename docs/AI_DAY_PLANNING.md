# AI day planning

Implemented for #34, using the #31 [scheduler policy](PLANNER_SCHEDULER_POLICY.md)
and #33 [proposal workflow](PLANNING_PROPOSALS.md).

## Using it

Open **Planner → Today → Generate plan**. Choose AI task selection, optionally
enter guidance such as “focus on housework” or “keep today light,” and select
**Generate plan preview**. Review selections, omissions, remaining minutes,
deadline risks, breaks and new leisure reservations, then **Apply changes** or
**Discard proposal**. Saved proposals can be reopened in the same dialog.

New same-day placements leave at least ten minutes after scheduling for review.
The preview shows **Apply before** using its earliest proposed task, break or leisure
reservation. A local clock disables acceptance when that start passes; the server
still revalidates on acceptance. An expired preview offers **Generate fresh preview**,
using the saved method and guidance. Planning input changes can require regeneration
before the displayed deadline. Generation never shifts an existing preview silently.

**Settings → AI & models → Planner · Day planning** chooses the model. It inherits
Balanced / Medium, then Default LLM, unless configured explicitly. An unavailable
or unconfigured model produces an error; choose **Deterministic · urgency order**
for an explicit model-free alternative. Deterministic mode does not interpret
natural-language guidance. **Planning settings** saves work-session, break and
leisure targets used by either method.

With blank guidance, generation attempts to fill eligible future open time: it uses
the AI shortlist first, then tries other eligible candidates in urgency order. A
model-suggested work cap does not restrict an unguided day. With guidance, the AI
selection and its work budget remain authoritative preferences, so “keep today
light” and narrow focus requests do not trigger the fill pass. The report shows
the planning goal, any work budget, additional candidates considered, and actual
availability windows. The standard weekday windows are 08:00–08:45, 12:00–13:00
and 17:15–24:00; the gaps between them are unavailable, not unfilled capacity.

Generation preserves all existing blocks and category
reservations. It does not rebuild the day or move existing commitments. Protected
work adjustment and replanning remain with #36. Previously saved legacy drafts
can still be accepted; the old generator API remains for compatibility, but Today
now generates proposals instead of calling it.

## Responsibilities and persistence

Protected `planningProposals.generate({requestId,date,mode,guidance})` delegates to
`lib/planner/generation/service.ts`. Generation reads a consistent owner-scoped
snapshot, performs inference outside transactions, computes placements, and calls
the existing proposal creation service with that snapshot's fingerprint. Input
changes during generation require a fresh preview. Nothing updates planning
records before acceptance.

AI chooses candidate order, explains selections/omissions, and may suggest a
smaller work-minute budget when guidance was supplied. Unguided generation tries
remaining eligible candidates after the AI shortlist, without a model-imposed
work cap. It cannot supply placement timestamps, alter task
properties, waive constraints, complete prerequisites, or apply changes. The
application calculates availability, remaining estimates, category compatibility,
leisure reservations, task splitting and rest. Trial placements use the shared
proposal validator, including downstream existing sessions. Task-boundary finish
extensions apply only to completing the current task. Intact placements, including
later windows, are tried before splitting. Generated partial-task segments and the
remainders they create are at least ten minutes; smaller gaps are left unused.
Genuinely short whole tasks still fit, and manual proposals retain their existing
positive-minute validation. These are placement preferences, not new task facts.
A busy meeting does not
count as rest; a WORK/LIFE category change does not reset a session.

The main summary and per-task placement explanations are calculated from actual
blocks, minutes and saved-zone times, including partial and zero placement. AI
selection notes are kept under **AI assessment before scheduling**; they are not
presented as statements about where tasks actually landed. The model prompt includes
the earliest planning start and clipped future availability, and prohibits claiming
placements or day-part timing before the application schedules work.

Generation reports, guidance and actual model attribution are saved in the
proposal document and preview JSONB. Acceptance reuses the existing locked,
transactional fingerprint check and validation. New LEISURE reservations are
validated against availability, busy events, preserved blocks and other
reservations, then inserted atomically with blocks and the acceptance receipt.
No schema migration is needed.

A saved generation request replays its proposal ID/report before reading current
inputs or resolving a model, even after application/discard. Reusing its request
ID with changed generation inputs fails. Concurrent requests cannot create two
proposals for one owner/request; competing completions may need a retry. If no
blocks or reservations can be added, the service returns an unsaved report with
`id: null`; retrying that no-change result recalculates it.

## Candidates, context and limits

Eligibility uses current task/occurrence status, unresolved hard prerequisites,
selected date and earliest start. Due dates propagate through hard dependency
chains. Remaining work subtracts completed effort and commitments in all current
plans, separately per recurring occurrence. Missing effort uses the existing
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
planning explicitly; deterministic planning remains available. Up to 1,000
eligible occurrences are supported overall. Every candidate outside the AI context
is still reported. In guided mode it stays unscheduled; in unguided fill mode the
application can try it after the AI shortlist. The model uses short request-local candidate aliases
(C1, C2, etc.), constrained by the output schema; the server maps them back to
owned task/occurrence references. Unknown or repeated references fail generation.
Candidates the model leaves unmentioned receive an explicit unassessed warning
and no invented AI omission reason. Guided planning leaves them unscheduled;
unguided planning considers them in its application fill pass. Unguided output
requires an empty AI omission list. A repeated-reference response permits one
correction attempt within the same 120-second inference deadline; unresolved
invalid references still reject generation before persistence. The shared structured generator bounds total prompt,
output tokens and generation time; provider failures preserve the plan.

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

## Verification

Colocated tests cover candidate eligibility/deadline propagation, model-free
planning, semantic fallback, malformed model references, replay and input
validation, plus task-boundary sessions, preserved history, calendar rest,
category reservations, leisure, recurrence, minute rounding, DST, the review buffer,
small-gap/remainder avoidance and intact later placement. Component
checks cover generation guidance/method selection, displayed deadlines, expiry/regeneration,
separate AI assessments and explicit acceptance.

Live synthetic PostgreSQL/Ollama checks exercise real generation with `qwen3:8b`,
light-day guidance, preview isolation, deferred recurrence creation, atomic leisure
insertion, owner isolation, stale inputs and duplicate acceptance. Browser checks
exercise unavailable-model errors, explicit deterministic fallback, preview/apply
and desktop/390px layouts. Temporary fixtures are removed after verification.

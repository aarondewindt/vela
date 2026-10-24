# Scheduler constraints and planning policies

Status: policy baseline for [#31](https://github.com/aarondewindt/vela/issues/31),
2026-10-19. Parent: [#18](https://github.com/aarondewindt/vela/issues/18).
The existing generator remains active. This document distinguishes its behavior
from the replacement contract. #33 now implements proposal persistence, validation
and atomic application; see [Planning proposals](PLANNING_PROPOSALS.md) for its
boundaries and verification. [AI day planning](AI_DAY_PLANNING.md) (#34) now uses
the proposal path; the legacy generator remains available through its API. The session finish
extension reflects the user's explicit choice on 2026-10-19; other new policies
are implementation defaults for this work.

## Responsibility and scope

The first replacement plans one calendar day in the user's saved timezone. AI
retrieves and understands tasks, chooses candidates and sequences, interprets user
guidance, and explains tradeoffs. Application services determine eligibility,
calculate placements, validate proposals and apply accepted changes. Constraints
must hold regardless of model output, semantic relevance or instructions in task
notes. The current manual and deterministic workflows remain available.

Source of current behavior: [service.ts](../lib/planner/service.ts),
[scheduling.ts](../lib/planner/scheduling.ts),
[recurrence.ts](../lib/planner/recurrence.ts), and
[router.ts](../lib/planner/router.ts). The older project plan's small daily quota
and mandatory first steps are aspirations, not current generator constraints.

## Current behavior and intended treatment

| Area | Current behavior | Replacement policy |
| --- | --- | --- |
| Day/time | Calendar dates use UTC-midnight storage; wall times resolve through saved user timezone. Next local midnight defines the end, including DST. Nonexistent local times fail; repeated-hour selection is implicit. | Preserve calendar-date semantics and actual elapsed minutes. Explicitly disambiguate repeated local times before accepting input. |
| Availability | Enabled weekday windows, replaced by CUSTOM windows (legacy start/end fallback); NO_WORK/PTO produce no ordinary availability. Standard availability has hardcoded weekday/weekend defaults. | Preserve effective windows and overrides. Do not infer that LIFE/LEISURE is allowed on PTO: current behavior disables all ordinary generation. Changes to that meaning belong in a separate policy change. |
| Calendar | Busy events exclude time. Non-busy events are displayed and may overlap generated work. Calendar display copies are clipped to local day. | Preserve busy/non-busy distinction and avoid counting a calendar event and its display block as two constraints. |
| Dependencies | An unfinished hard prerequisite excludes its dependent. DONE and ARCHIVED prerequisites are treated as resolved. Earliest dependent due date propagates through hard dependency chains. | Preserve initially, including the ARCHIVED convention. Scheduling a prerequisite is not evidence it is complete; no assumed same-day completion to unlock a dependent. Report cycles/unresolved chains. |
| Eligible tasks | Recurring materialization excludes DONE/ARCHIVED/PAUSED. Pending/scheduled occurrences on or before the selected date are candidates; backlog includes non-recurring BACKLOG/IN_PROGRESS tasks without open occurrences. | Preserve status/occurrence rules; apply earliestStartAt consistently to every candidate and its actual proposed start. |
| Recurrence | FREQ, INTERVAL and BYDAY subset; DAILY/WEEKLY/MONTHLY/YEARLY. Anchor is task creation UTC date. Materializes selected date plus seven days with duplicate skipping; no full RRULE implementation or past backfill. | Preserve supported subset and stable occurrence identity. Do not invent missed occurrences or add RRULE support silently. Surface unsupported input. |
| Remaining work | Estimate defaults to 25 minutes. Subtract durations of PLANNED/IN_PROGRESS/DONE blocks in current plans, by occurrence for recurring work and task for backlog. No separate actual-work ledger. | Use the existing estimate fallback initially. Compute completed effort, protected commitments and replaceable allocations separately; exclude blocks being replaced before allocating their minutes again. Never count superseded plan versions or another occurrence's work. |
| Urgency | OVERDUE, DUE_SOON, IMPORTANT, FILLER; size-based lead times, extra lead time for P1. Then due proximity, priority, size descending and ID. Long filler tasks are promoted. No daily quota. | Treat ranking and lead times as explainable defaults, not inviolable ordering. Mandatory candidate inclusion for due/important work survives semantic top-k; explain omissions and deadline risks. |
| Categories | Task category, else theme category, else WORK. Matching tasks fill category slots; unused slot time is reserved. Non-leisure leftovers can spill into open time, with unreserved categories first. LEISURE stays in leisure slots. | Preserve category inheritance and matching. Keep manual reservation boundaries; allow unfilled reservations. Spillover order is a preference; LEISURE placement stays reserved unless the user changes the reservation. |
| Category containment | Explicit slots are scheduled independently of ordinary availability and are not intersected with it. Existing slots can therefore generate work on PTO or outside availability. | Correct this gap: generated task time must fit effective availability AND its reservation. Report incompatible reservations; never silently move/delete them or use them to bypass availability. |
| Leisure | Default 60 minutes, distributed before ordinary work; default short/max blocks 30/90. Existing leisure slots reduce the generated target in fill mode. Placement can underfill fragmented days. | Preserve user reservations; optimize flexible leisure placement and distribution. Target is best effort, with an explicit shortfall, not permission to overbook or erase leisure for urgency. |
| Breaks/splitting | Default work session 90, break 15. Category slots accumulate session time and cut exactly at the cap. Open time applies gaps between task segments and may skip a short gap when larger blocked time intervenes. Leisure uses its max block as a session cap. | Replace with the single task-boundary policy below (#11). |
| Persistence | generateDraft creates a new current DRAFT, supersedes the old current plan, copies protected blocks and mutates occurrence/task scheduling state. acceptDraft changes status to ACTIVE. | Intentional change under #33: generation only saves a proposal; accepting an atomically revalidated proposal changes current planning state. |

## Hard constraints for the replacement

These are application-enforced rejection conditions, not AI scoring penalties.

1. **Ownership and references:** resolve every task, occurrence, reservation and
   block under the authenticated owner. Reject missing/stale/foreign references.
2. **Valid intervals:** finite positive durations, minute-based scheduling and
   start < end. Intervals are half-open: a block ending at 10:00 permits another
   starting at 10:00. Generated work/rest must fit the local day and effective
   availability; no hardcoded 24-hour day or scheduling before the replanning
   cutoff. Calendar display may still show events outside availability.
3. **No new conflicts:** no overlap with busy events, protected occupied blocks,
   another generated occupied interval, or incompatible category reservations.
   A task inside its own matching reservation is not a reservation conflict.
   An existing conflict among protected records is reported and preserved; it
   does not authorize AI to move them. New allocations must avoid the conflict.
4. **Eligibility:** honor statuses, earliest starts and unresolved hard
   dependencies. Task text cannot create an exception. Deadlines indicate risk;
   a late task can still be scheduled, rather than becoming ineligible forever.
5. **Work budget:** allocate no more than remaining estimated work after completed
   work and preserved commitments. Report unfinished minutes, including partially
   placed tasks. Extending the estimate requires a separate accepted task change;
   AI cannot hide an overrun by changing it implicitly.
6. **Preservation:** retain protected identity, time, source, linkage and outcome
   unless the user explicitly requests an allowed change. Creating a plan cannot
   mark work complete, delete a task, or resurrect a cancelled occurrence.
7. **Session/rest limits:** enforce the configured target, bounded finish extension
   and qualifying rest below. AI may propose where to take a break, not waive it.
8. **Application:** validate again at acceptance against current inputs, reject
   stale proposals, and apply once transactionally. Generation failure leaves
   the accepted plan unchanged. Implemented by #33 for the new proposal path;
   legacy generateDraft still has its old behavior.

## Existing block preservation

| Block or slot | Current fill mode | Current rebuild mode | Replacement default |
| --- | --- | --- | --- |
| Manual PLANNED block | Copied | Copied | Protected; move only on explicit request |
| Fixed PLANNED block | Copied | Copied | Protected; no implicit move or resize |
| IN_PROGRESS block | Copied | Copied | Preserve actual start/progress; explicit overrun request may propose a new end |
| DONE block | Copied | Copied | Immutable completion history; explicit outcome correction is separate |
| Other PLANNED block | Copied | Replaced | Fill preserves; explicit replan may move future unprotected work |
| SKIPPED block | Copied; occurrence excluded in fill | Omitted | Keep outcome/history; don't reinsert that occurrence automatically |
| CANCELED block | Omitted | Omitted | Keep cancellation history; don't reinsert automatically |
| Manual category slot | Copied | Omitted | Protected in both modes; explicit edit needed |
| Generated category slot | Copied | Omitted | Fill preserves; explicit replan may regenerate future flexible slots |

Protected PLANNED/IN_PROGRESS/DONE occupied time constrains new placement. Skipped
and cancelled blocks remain historical annotations and do not occupy time. Non-busy
calendar display blocks are also annotations. A move of an entire plan cannot
implicitly authorize changes to fixed/manual/active work. An explicit request may
produce a reviewed exception for an identified editable block; busy external events
and completed history are never moved by the scheduler.

Current clearDayPlan deletes **all** blocks, including DONE/IN_PROGRESS, while keeping
category slots. It is not a safe replanning primitive. Current completion of one
segment marks its occurrence DONE even when completeTask is false. The replacement
must distinguish block completion, occurrence completion and whole-task completion;
#36 now distinguishes those outcomes in the proposal workflow and Today inspector;
see [Replanning](REPLANNING.md). Legacy API callers retain their previous behavior.

## Adjustable planning preferences

AI may optimize priority/urgency, due risk, semantic relevance, explicit user focus,
related-task batching, switching cost, first-step quality, task fragmentation,
flexible leisure distribution, and how full the day should be. These are not new
persisted task facts. Missing context/estimates stay identified as missing or defaulted.
Do not invent location, travel time, energy scores or dependencies from guesses.

Due/important tasks must enter the candidate pool even if semantic retrieval misses
them. Inclusion does not guarantee enough time to schedule them. Explain capacity
shortfalls and why lower-ranked work was chosen; offer alternatives. No mandatory
P1/P2/XS quota is introduced. AI may recommend a small day without rewriting priority.
Prefer minimal changes to unaffected work during replanning and avoid tiny fragments;
there is no newly imposed minimum task length in this baseline.

## Task boundaries, breaks and splitting (#11)

**User choice:** the configured work session is a target, with at most **30 extra
minutes to finish the current task**. For default target 90, the ceiling is 120.
The allowance is fixed for this first policy, not an additional 30 minutes per task.
For leisure, use the configured maximum leisure block as a hard ceiling; the finish
allowance does not expand a user's leisure reservation or its maximum length.

- Count contiguous task execution across task boundaries. A category-slot boundary
  or switching from WORK to LIFE does not itself reset the session clock.
- A continuous unoccupied gap or explicit REST/LEISURE interval at least as long as
  the configured short break resets the work-session clock. Busy events and other
  tasks are not assumed restorative. Short gaps do not reset it. Known completed
  and active task time contributes; unknown activity is not invented.
- Prefer boundaries between tasks. Before starting a task that would cross the
  target, take the break early if the task cannot finish by target + 30. If it can
  finish by that ceiling, it may run to completion. Once the target is reached,
  do not start another task until a qualifying break.
- A task unable to finish within the ceiling is split at or before the target;
  the extension is only for completing a task, not arbitrary extra partial work.
  Availability, calendar and protected boundaries can force an earlier split.
- Prefer natural boundaries around tasks longer than 45 minutes where practical;
  this suggestion from #11 is a preference, not a mandatory break after every task.
- No work or break may cross a hard time boundary. When adequate rest cannot fit,
  leave work unplaced and explain it. Do not add a trailing break just to fill time.
- Splitting preserves the same task/occurrence identity, total allocated minutes,
  and explicit unfinished remainder. Task content changes cannot silently make
  an existing task non-splittable; such a capability needs an explicit future field.

Examples (15-minute break, 90-minute work target, no other constraints):

| Work | Expected replacement behavior |
| --- | --- |
| 60 then 45 minutes | Finish the second task at minute 105, then break before more work |
| 70 then 55 minutes | Break at minute 70; 125 would exceed the ceiling |
| Single 110-minute task | Finish at 110, then break before more work |
| Single 150-minute task | 90 work, 15 rest, 60 work; no extension just to do partial work |
| 90 then a new 10-minute task | Break before starting the new task |
| 60 then 45, but busy event at minute 100 | Cannot use extension across the event; break earlier or split/reposition |
| 45 WORK then 45 LIFE | Combined session is 90; the category change does not reset it |

## Time, conflict and progress corrections

The current timezone helper rejects a nonexistent spring-forward wall time but
implicitly picks one occurrence of a repeated autumn hour. New proposals must
store unambiguous instants and the planning timezone. Ambiguous natural-language
input needs clarification/explicit offset selection; never silently change the
calendar date. Future work should decide whether existing plan timezone or new
user timezone wins during a timezone change and require renewed preview when it
changes placements (default: retain the accepted plan's timezone).

Earliest-start validation is currently only a day-level backlog filter and is
missing for occurrences. Existing fixed blocks can conflict with new calendar
busy data. There is no generation-time cutoff for today and no complete stale
input/replay protection. These are gaps to correct in #33/#34/#36, not historical
rules to preserve. Existing overlap in protected data should be visible without
making unrelated, non-conflicting additions impossible.

## Verification and issue boundaries

- `generation-policy.test.ts` exercises the real current generator with synthetic
  mocked persistence: timezone/DST boundaries, overrides, recurrence materialization,
  eligibility query boundaries, dependency urgency, remaining minutes, preservation
  matrix and current draft side effects. It does not claim database isolation or
  concurrency coverage from mocks.
- `scheduling-policy.test.ts` records placement invariants and legacy edge cases:
  half-open busy boundaries, capacity limits, categories, current out-of-availability
  reservation behavior, and the task split that #11 should intentionally replace.
- Existing `scheduling.test.ts` covers ranking, busy windows, leisure allocation,
  partial tasks and category placement; `service.test.ts` records legacy clear behavior.
- New-policy examples above are acceptance scenarios for #11/#33/#34/#36, not
  passing claims about an unimplemented replacement. Convert them to executable
  validator/generator tests as those issues implement the behavior. Do not change
  legacy expectations just to make the new scheduler look compatible.

#31 supplies this baseline and current-behavior regression fixtures. #33 implements
proposal storage, validation, atomic acceptance and preservation. #7 supplies fresh,
owner-scoped retrieval. #34 implements AI selection/placement using this policy;
#35 reviews conflicts and replacements; #36 handles progress and replanning. #41
adds comparative quality evaluation and rollout. Task analysis in #32 is advisory.
The #31 baseline itself required no production scheduling/database change. The
subsequent #33 proposal implementation is documented separately; its validator tests
now exercise availability, preservation and session rules, including the finish extension.

## Generation review and fragmentation preferences (#34 correction)

Generated placements begin no earlier than ten minutes after placement calculation,
rounded up to a whole minute. This gives a same-day preview time for review without
relaxing the acceptance cutoff. The earliest proposed start is its displayed apply
deadline; once that time passes, regenerate rather than silently shifting saved times.
Future-day plans still begin within that day's availability.

The first generator prefers an intact placement in any eligible window before
splitting into earlier gaps. Partial segments and any remaining work they create
are at least ten minutes; smaller gaps are left unused. Whole tasks shorter than
ten minutes remain valid, as do manual positive-minute edits. This is a generator
packing preference, not a new hard eligibility or validator constraint.

The application describes the actual placements and unscheduled totals. AI selection
intent is labeled separately because the model does not know placement results when
it supplies its reasons.

Without planning guidance, generation now tries to fill eligible available time: AI
shortlist/order first, then remaining candidates by application urgency ranking,
without an unsolicited model work cap. With guidance, AI selection and any light-day
work cap remain planning preferences. This default does not override eligibility,
reservations, availability or protected work. Standard weekday availability remains
08:00–08:45, 12:00–13:00 and 17:15–24:00. The preview displays these windows, the
planning goal and any guided work budget so unavailable gaps are distinguishable
from time left unallocated.

## Cross-day unfinished work correction (2026-10-24)

BACKLOG/IN_PROGRESS tasks remain eligible when scheduled on earlier or later dates.
For the selected day's effort budget, count DONE effort across current plans and
PLANNED/IN_PROGRESS blocks on that local day. Other dates' unfinished allocations
remain intact and do not consume today's budget. Reuse an open non-recurring
occurrence regardless of its original date; keep future recurring occurrence gates.
An exhausted estimate does not imply completion: expose a labelled 25-minute
continuation allowance and request estimate review, without rewriting task facts.
Future UX may ask whether to move an existing future block or add work; currently
continuation adds a block through the ordinary reviewed proposal workflow.
All commitments still constrain explicit completion and finish-extension claims.

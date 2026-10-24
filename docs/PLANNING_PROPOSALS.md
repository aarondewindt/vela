# Planning proposals

Implemented for [#33](https://github.com/aarondewindt/vela/issues/33), under #18.
This is the shared review/application workflow for the replacement scheduler.
It follows [Scheduler policy](PLANNER_SCHEDULER_POLICY.md). [AI day planning](AI_DAY_PLANNING.md)
(#34) now generates through this workflow. [Remaining-day replanning](REPLANNING.md)
(#36) adds explicit progress and protected-work adjustments. [Day plan reviews](PLAN_REVIEWS.md) (#35) separate verified conflicts from advisory AI concerns and compose validated corrections through this workflow.

## Using the workflow

Open **Planner → Today → Generate plan** for the selected date. For a manual change,
expand **Manual plan change** and choose an addition,
move, duration change, removal or replacement, specify its time and reason, and
select **Preview change**. No planning records change at this point. Select a saved
proposal to inspect its before/after times, explanations, warnings and remaining
work. **Apply changes** revalidates and applies it; **Discard proposal** only
resolves the proposal. The latest 30 proposals for that date are listed, including
applied/discarded history. Pending previews refresh while the dialog is open.

Times use the saved plan timezone, or the user timezone when no current plan exists.
The simple editor accepts same-day HH:mm times; the structured API accepts explicit
offset instants, including the end at next local midnight. Nonexistent or ambiguous
wall times are rejected in the editor; the API can express either repeated-hour
instant unambiguously. Server time determines the future-only cutoff at preview
and acceptance, rounded up to the next minute. Generated schedules additionally
leave at least ten minutes for review; the preview displays an apply deadline and
offers regeneration if a proposed start passes. Manual edits keep their explicit times.

Ordinary manual edits protect manual, fixed, active, completed, skipped, cancelled
and calendar-linked blocks. #36 permits explicit selected future manual/fixed edits
and started-work finish/extension, while preserving calendar and resolved history. It also protects blocks that have already
started by clock time. Existing conflicts are displayed as warnings; unrelated
valid changes can still be proposed without moving those records. A removal or
replacement marks the old block CANCELED and keeps its history and task. Moves
and duration changes retain block identity/source. Duration changes keep the start;
moves keep the duration. Whole-task deletion is never a proposal action. #36 adds explicit task/occurrence completion through a reviewed finish action.

## Service/API contract

Protected `planningProposals` tRPC procedures delegate to
`lib/planner/proposals/service.ts`:

- `generate({requestId,date,mode,guidance,freeTimes?,reviseProposalId?})`: AI or explicit deterministic day generation;
  see [AI day planning](AI_DAY_PLANNING.md) for reports, limits and replay semantics.
- `review({date,proposalId?,mode,guidance})`: transient current/pending-plan conflict and contextual review, with independently validated correction documents; see [Day plan review](PLAN_REVIEWS.md).
- `replan(...)`: deterministic structured progress action and affected remainder;
  see [Replanning](REPLANNING.md) for action semantics and limits.
- `context({date})`: owner-scoped candidate references, current block summaries,
  editing eligibility, timezone and planning-input fingerprint.
- `create({requestId,date,baseHash,document})`: validate and persist a proposal;
  retries with the same owner/request/payload return its existing ID. Changed
  payloads with the same request ID are rejected. Concurrent creation cannot
  duplicate it; a losing request can retry its original ID.
- `createEdit(...)`: same service, with the simple editor's one-operation wall-time
  input. This does not call a model or bypass structured validation.
- `list({date})` / `get({id})`: resumable saved previews and receipts. A pending
  detail read checks current validity; stale previews cannot be applied.
- `accept({id})`: revalidate and atomically apply once. An already applied request
  replays its saved receipt even if the plan later changes. It does not reapply.
- `discard({id})`: idempotent for discarded proposals; applied proposals cannot
  be discarded. Missing/foreign proposals return the same NOT_FOUND response.

`schemaVersion: 1` documents contain up to 100 structured operations, each with an
explanation. Types are `add`, `move`, `resize`, `remove`, `replace`, `skip`, `finish` and `extend`.
Explicit selected-block permission applies only to future planned manual/fixed edits;
finish/extend have their own started-work validation. Extension can include an explicitly
reviewed increased total task estimate; finish has an explicit completion boolean. Added blocks
are a referenced TASK (taskId plus existing occurrenceId, or null for an eligible
non-recurring backlog task or virtual selected-day recurring occurrence) or REST. Batch operations can collectively resolve
conflicts; a block may only be mutated once in a document. There is no executable model text, arbitrary task property patch, implicit completion,
or inferred override permission. Optional new LEISURE reservations and generation reports are stored in
the same document; at least one operation or reservation is required. Generation calls
this same create/accept boundary.

The manual editor composes one operation per proposal. The service accepts batches, including
split-task segments and explicit rests. Leisure tasks require a matching existing or
proposed reservation. #34 adds validated future LEISURE reservations; existing reservation
editing stays with the availability/category UI. New reservations appear in the preview
and are inserted atomically on acceptance.

## Validation and remaining work

The pure validator checks ownership/reference resolution, status/occurrence dates,
unresolved hard prerequisites, earliest starts, positive whole-minute intervals,
local-day/effective-availability containment, busy intervals, occupied block conflicts,
category reservations, leisure placement, remaining estimates and session limits.
Intervals are half-open; touching endpoints are permitted. PTO/NO_WORK and category
reservations cannot be used to bypass availability.

Committed and completed minutes in other current plans are counted, while edited
allocations are replaced before evaluating the total. Recurring work is counted per
occurrence. New occurrences for non-recurring tasks are created only on acceptance;
generation may also reference a virtual selected-day recurring occurrence, created on
acceptance only after supported-rule/date validation. This workflow never
backfills missed dates or resurrects a closed occurrence.
Removing the last commitment leaves an open occurrence PENDING for future planning
and returns a non-recurring IN_PROGRESS task to BACKLOG when no commitments remain.
This retains cancelled block linkage rather than using legacy occurrence deletion.

Work sessions accumulate across task/category boundaries. A qualifying gap or rest
resets the clock; busy time does not count as recovery. The configured target allows
at most 30 extra minutes only to finish the current task. It cannot start another task
after the target or finish merely a partial allocation. Future commitments elsewhere
also prevent falsely claiming that the current segment finishes a task. Leisure has
its separate hard session maximum. Removing/moving a rest cannot introduce a session
violation in untouched downstream work. Existing session violations may remain but
cannot be made worse. Placement optimization and early-break selection now live in #34 generation; the
validator rejects a bad schedule rather than generating a replacement.

## Persistence and concurrency

Migration `20261019190000_planning_proposals` adds the owner-scoped JSONB proposal,
preview and receipt table with request uniqueness and status/resolution constraints.
No existing application tables/data are rewritten. PENDING → APPLIED or DISCARDED
is final. Failed validation or any transactional failure leaves the plan/proposal
unapplied. An applied receipt records plan ID, new/changed block IDs and apply time.

Creation uses a consistent read transaction. Acceptance acquires PostgreSQL table
locks on all planning source tables (including timezone and theme data) and proposals
before loading the current state. This covers legacy/manual writers that do not
participate in a new advisory-lock convention, including concurrent inserts. It
then compares a deterministic fingerprint, reruns validation and writes the changes
and receipt in the same short, model-free transaction. Discard/application races
are serialized too. Lock contention/deadlocks produce a retry/review conflict;
locks have a five-second timeout and the transaction is bounded to fifteen seconds.

This deliberately conservative first version briefly serializes planner-related
writes **across users** during acceptance. Ordinary reads continue. It is suitable
for the current private app; replacing it with owner revisions/locks requires every
legacy/calendar/settings write path to participate, with equivalent race tests.
Fingerprints cover all owner task/occurrence/current-block/calendar records plus
selected-day plans, availability/overrides/settings and timezone. Unrelated edits
can therefore require another preview. New task/theme references are always resolved
from current owned data, not trusted from the saved preview.

Accepted proposals patch the current plan in place (or create an ACTIVE plan if
none exists), preserving protected block IDs and outcomes. They do not use the legacy
`generateDraft` or `clearDayPlan` implementations. Today now calls #34 proposal generation; acceptance of previously saved legacy
drafts and the old generator API retain their existing behavior. This feature does not rebuild or
restart the public deployment.

## Verification

Focused Jest tests cover structured input, ownership/reference failures, eligibility,
cutoffs, DST wall-time resolution, reservations, remaining work, protected edits,
replacement/removal semantics and session validation. Component tests exercise
preview vs acceptance, stale proposal blocking and discard; router tests cover
anonymous access and invalid boundary inputs. Live synthetic PostgreSQL checks cover
creation/discard without plan mutations, request replay, cross-owner rejection,
concurrent acceptance, competing stale proposals, retained identity/history and a
concurrent legacy task edit. An injected failure before receipt persistence verified
real transaction rollback of preceding block/plan writes. Temporary fixtures are removed after those checks.

Validation on 2026-10-19: 539 Jest tests in 81 suites, TypeScript, scoped lint/format
and production build pass. Thirty-three isolated PostgreSQL/service assertions and
real desktop/390px preview/apply browser checks pass; browser runtime errors are
empty. A private backup preceded the additive migration, which is applied locally.
Existing legacy TodayView lint/format failures are outside this change. The public
build/server were not changed; temporary fixture accounts/data were removed.

## Conversational planning constraints (#37)

Planner chat uses these same services; see [workspace](PLANNER_WORKSPACE.md#phase-2--conversational-planning-37). Generation can subtract explicit local free intervals from shared availability before existing task/meal placement. Proposals retain absolute `freeIntervals`; creation, corrections, revision and acceptance reject occupied time within them. Free intervals do not change saved availability for later independent generation. Selection-only provenance survives edits under `selectionExplanation`; stale allocation counts and timestamps do not. Acceptance and receipts remain unchanged.

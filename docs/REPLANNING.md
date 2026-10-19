# Remaining-day replanning

Implemented for [#36](https://github.com/aarondewindt/vela/issues/36), using the
existing [planning proposal](PLANNING_PROPOSALS.md) validation and atomic acceptance.
No migration or model call is needed.

Today → **Adjust remaining day**, or an unfinished block’s **Progress & replan**,
opens structured actions. Enter a reason, preview the result, then apply it. Saved
previews show statuses, before/after times, explicit task changes, released work
and unallocated effort. Planning-input changes and elapsed placement cutoffs require
a new preview. Generated downstream moves leave ten minutes for review.

- **Extend started work** preserves its start, identity, source and linkage and
  proposes a later end. If the total allocation exceeds the remaining estimate,
  enter an increased **total task estimate**, reviewed and applied atomically.
  Session limits, availability, reservations and busy time still constrain future work.
- **Finish a block** records its actual whole-minute duration and finish time as
  DONE. The time must follow its start, be on the selected day, and not be in the
  future. This is actual history, so an overrun can exceed its old estimate or
  historical availability. Its recorded minutes count once toward completed effort.
  The task remains open by default, even when estimated remaining effort is zero.
- **Also complete the task** explicitly closes the nonrecurring task and its open
  occurrences. For recurring tasks it closes only the selected occurrence, keeping
  the recurring task and other occurrences open. Future flexible allocations for
  the completed work are released. Remaining commitments on another day or in
  protected work require explicit resolution before completion is accepted.
- **Postpone to later today** preserves the selected block’s duration and identity.
  **Skip** retains its SKIPPED annotation. **Cancel** retains a CANCELED block.
  **Replace** cancels the old allocation and inserts the chosen eligible task at
  its former interval. These actions keep the original task; they never delete or
  complete it. To postpone beyond today, cancel its allocation and plan its open
  occurrence on the desired future date.
- **Replan remaining day** considers future flexible blocks against current
  availability, calendar, task, reservation and planner settings. It keeps valid
  times where practical. **Bring flexible work forward** optionally fills earlier
  gaps, including after an early finish.

The deterministic builder retains block order and whole-block duration; it searches
whole-minute placements and uses the shared validator for every trial. The search
runs outside database transactions, with at most 98 downstream blocks and 10,000
placement trials; larger requests require a smaller adjustment. It considers
only the selected block and flexible blocks starting at or after it, or all future
flexible blocks for a day-wide replan. Unaffected earlier work stays in place.
Work that cannot fit is explicitly cancelled in the preview with its task and
unfinished effort retained. Existing leisure reservations remain in place. This
version does not split downstream blocks, optimize candidate selection, or add new
backlog work; **Generate plan** can subsequently fill open time.

Manual and fixed work is preserved unless selected explicitly for a future edit;
started work can only be finished or extended. Calendar-linked blocks and resolved
DONE/SKIPPED/CANCELED history cannot be changed. Future flexible blocks may move even when their original start is near; their new
placements leave ten minutes for review. Already-started blocks remain protected. Explicit postponement
and replacement keep the user’s chosen interval and may have shorter review time.

Acceptance uses the existing owner fingerprint, table locks, transaction and saved
receipt. Estimate changes, actual durations, outcomes, downstream moves/removals,
occurrence reconciliation and the receipt commit together. Retries replay saved
requests and applied receipts without repeating work. Finishing the last allocation
without task completion leaves its occurrence PENDING, with completed effort still
counted. Recurring remaining effort stays occurrence scoped.

Today’s inspector now uses this reviewed progress workflow. Legacy outcome, removal,
unskip, drag/drop editing and clear-plan APIs retain their earlier behavior and are
not replanning primitives. In particular, the old outcome API still closes an
occurrence on block completion; clear-plan can delete history. They are not used
by the new progress/replan controls.

Validation includes focused domain, service, router and UI tests plus isolated
PostgreSQL checks for preview isolation, concurrent acceptance, retries, ownership,
explicit/partial/recurring completion, effort accounting, stale rejection and real
rollback after an injected receipt failure. Temporary fixture users/data are removed.

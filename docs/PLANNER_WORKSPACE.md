# Planner Today workspace

The November 2, 2026 redesign (#119 → #59 → #37/#73 → #120) makes
`/planner/today` the visual schedule editor with an AI assistant. PR #96 was
already merged into master; its scheduler, validation, chat lifecycle and task
picker are reused. Earlier proposal-card expectations are superseded.

## Everyday workflow

1. Pick a date. The left candidate-task list keeps search, filters, task inspection
   and drag/drop. The middle initially shows one active Mantine DayView.
2. Drag a task, move/resize/remove a block, use Generate/Auto-fill, or ask chat to
   change the schedule. The first action creates a persistent working draft and
   performs that action. With an active plan it copies intended state; otherwise
   it starts empty. No schedule edit silently changes active.
3. While drafting, compare the read-only active DayView with the editable draft
   beside it. Changed placements are labeled. Manual drag/resize is deliberately
   permissive: blocks and category reservations may overlap, leave availability,
   mismatch categories/leisure reservations or exceed a task estimate. Both resize
   edges use one identity-preserving retime operation. Hard conflicts are marked and
   explained, but remain persisted until the user fixes or undoes them.
4. Use Undo/Redo for one manual action or one chat edit/batch at a time. The draft,
   cursor and redo branch survive reload, date changes and conversation deletion.
5. Accept is the hard-consistency boundary. It rejects occupied-block, busy-calendar,
   reservation-slot, day-boundary and protection/lock conflicts with actionable IDs
   and local ranges while preserving the draft. It allows non-busy events and explicit
   availability/category/leisure/estimate overrides. A valid draft is atomically saved
   as the next active version, retaining old plans, blocks, occurrence identities and
   check-ins. Cancel leaves active intact; materially changed drafts require confirmation.

Generate and Auto-fill share the existing scheduler. Normal regeneration replaces
eligible automatic future placements while preserving manual origins and user
overrides. Rebuild requires an explicit request/confirmation and may reorganize
eligible future manual placements. Started/completed, locked, fixed and calendar
commitments remain protected. Automatic placements remain strict; manual resizing may
deliberately exceed recorded remaining task effort without changing the task estimate.

Review schedule uses the existing deterministic review on the current draft (or
active when none is open). Findings and conflicts remain separate from advisory AI
review. Actual Mark done/Skip/Unskip actions are explicit active-work controls;
draft edits cannot complete work, change actual progress or infer task completion.

The desktop Splitter retains resizable side columns. Existing narrow-screen surface
selection remains; mobile redesign and synchronized calendar scrolling are deferred.

## Persistence and conflicts

See [persistent drafts](PLANNER_DRAFTS.md) for models, transaction/lock ordering,
revision retention, idempotency and promotion. `plannerDraft` tRPC is the typed
boundary. Persistent server state stays in TanStack Query; Zustand holds date and
focus only. Polling and mutation invalidation update other tabs. Conflicting edits
reject expected-version mismatches without dropping either saved schedule.

A stale draft stays visible with an explanation. Accept rechecks freshness and rejects
without changing the draft. Refresh inputs
can revalidate it if its active base is unchanged; otherwise keep it for comparison
or cancel and start from the new active version. Past drafts stay saved and cannot
auto-activate. Timezone/DST conversion uses the existing saved-zone resolver;
ambiguous local times require explicit-offset operations instead of guessing.

Legacy manual tRPC endpoints stage drafts too. Legacy proposal acceptance is disabled,
old proposal rows remain readable, and the old `/planner/conversation` page redirects
to Today. Older structured conversations remain stored and owner-readable through
existing APIs; they are not silently converted to new streaming conversations.

## Conversation tools and model separation

The right chat reuses AI Dev's owner/scope-protected persistent streaming lifecycle,
model selection, retry/cancellation, generation lease and escaped Markdown.
Conversations do not own drafts. Questions, explanation and review do not create one.

| Tool | Application behavior |
| --- | --- |
| `getPlanningContext` | Bounded date/timezone, draft blocks, availability and candidates. |
| `generateDayPlan` | Existing AI selection → deterministic placement → validation, saved as one draft revision. |
| `proposeScheduleChanges` | Existing instruction resolution and validated edit/replan primitives against the draft. |
| `editScheduleBatch` | Multiple explicit edits, applied atomically as one undo step. |
| `replaceScheduledBlocks` | Existing selected-block replacement logic with preserved intervals. |
| `reviewDayPlan` | Existing deterministic/advisory review on the draft snapshot. |
| `explainPlanningDecision` | Saved generation intent and outcomes, without rerunning scheduling. |

The conversation resolves `planner.conversation`; scheduling independently resolves
`planner.dayPlan`; optional AI review independently resolves `planner.planReview`.
The conversation model cannot select another scheduler/review model or approve a
schedule. One successful scheduling mutation is permitted per conversation turn;
multi-part explicit changes use the batch tool.

Successful scheduling replies are short application-owned confirmations. Schedule
changes appear in the draft calendar, without interactive proposal cards or a giant
generation form. Generation details remain saved in draft state; bounded Planner
debug stays collapsed. Failed updates retain saved drafts and show a canonical
failure, even if subsequent model prose incorrectly claims success. No provider
fallback or second scheduler is introduced. Invalid model output can still require
retry or Auto-fill; actual model acceptance evidence and limits are recorded in
[verification](PLANNER_DRAFT_VERIFICATION.md).

## Task and theme management (#38)

The integrated Today conversation now exposes `findPlannerRecords`,
`proposeRecordChange` and `reviseRecordChange`. There is no additional chat screen.
Find covers the owner's inventory, including unscheduled/completed tasks, with exact
name/ID precedence, bounded substring matches and explicit ID choice buttons.
Proposals reuse `conversation/records.ts` and the regular task/theme services.
Supported fields are title/name, brief, task status, priority, size, due date,
estimate, lead time, category, tags, task theme assignment/clearing, theme color and
active state. Recurrence, dependencies, locations and rich notes remain in the
regular editor. An explicit relative deadline uses the saved user timezone.

Inline cards share `RecordReview` with the older command interface and show resolved
records, before/after fields, relationship names and deletion effects. Accept changes
applies one record; deletion additionally requires its checkbox and Confirm deletion.
Discard and Revise in chat remain available. No chat confirmation invokes acceptance.
Accepted changes invalidate ordinary Tasks, Today, proposals, task search and reviews;
Open Tasks links to the ordinary inventory. Planning previews become stale when
accepted record changes affect their source fingerprint.

`PlannerRecordProposal` belongs to a Planner-scoped `AiConversation` and cascades on
conversation deletion. Compact saved `data-planning` parts retain preview IDs and
bounded match choices; server reads own preview contents/status. A pending preview
can be recovered even if interruption prevented saving its message card. Owner and
scope checks protect lookup, creation and resolution. Existing records and related
occurrence/block/dependency versions are fingerprinted and rechecked inside the
same short transaction as the domain mutation and durable receipt. Preview lifecycle
uses the existing planner lock order, then locks conversation/record-preview tables.
This retains the existing brief cross-user serialization cost.

One stable owner/conversation/message identity permits one record preview per turn;
changed retry arguments reject instead of creating another record. Concurrent accepts
replay the receipt, including after later deletion. Late tools from earlier messages
cannot supersede the latest preview. Acceptance waits for active response generation.
Failed or ambiguous proposals retain the prior preview; successful corrections
supersede it. `reviseRecordChange` derives the action/target from the pending preview,
so correcting an unaccepted creation does not require an existing task. It retains
previous fields and uses the same stale fingerprint checks. Deletion previews must
be discarded before changing their action.

Record previews remain distinct from schedule drafts and keep their existing
explicit acceptance/deletion-confirmation rules. Their earlier verification
limits remain in #38; this redesign does not claim new inventory acceptance.

# Day plan review

Implemented for [#35](https://github.com/aarondewindt/vela/issues/35).
Open **Planner → Today → Adjust remaining day → Review day plan** (also available inside
Generate plan). Review the current day or select a saved pending proposal and
choose **Selected pending proposal**. Reviews do not change or save planning state.

**Verified conflicts only** works without a model. It checks occupied block
intervals, overlaps, busy calendar events, effective availability, category/leisure
reservations, task/occurrence eligibility and hard prerequisites, earliest starts,
excess estimates across current plans, and the shared session/break policy.
Findings identify the relevant blocks/tasks. Cancelled/skipped and nonbusy calendar
blocks are excluded. Completed history can still explain overlapping time; automatic
corrections preserve history, active/started, manual, fixed and calendar blocks.

**Verified conflicts and AI concerns** adds bounded contextual assessment of workload,
sequencing, context switching, deadlines and supplied guidance. The separate
`planner.planReview` model setting inherits Balanced/default settings. The model
receives bounded recorded task context and request-local block references. Responses
must reference supplied blocks. These findings are explicitly advisory, even when
they repeat a verified problem. Provider/configuration/invalid-output failures show
an error beside the available verified results. No model chooses executable changes.

Correction options include releasing an allocation and up to three eligible
replacement occurrences per adjustable block, ordered by existing planning urgency.
The complete remaining estimate must fit the original slot; shorter replacements
leave the remainder free. Every option passes the existing full proposal validator,
including occupied time, prerequisites, category/session limits and other commitments.
Pending-proposal replacement accounting includes its proposed allocations.
Options show displaced minutes and recorded deadlines, replacement effort and deadline
risk. Deadline flags mean due before the end of the selected local day; they do not
predict execution or guarantee completion. Missing effort uses the existing 25-minute
default. Broader deadline feasibility and contextual mismatches remain advisory.

**Preview correction** calls the shared owner-scoped `planningProposals.create`
service with the reviewed fingerprint and a stable retry ID. For a pending proposal,
it composes the correction with its operations/reservations into a separate proposal;
the old generation/replan report is omitted because it describes the prior allocation.
The original proposal remains pending and will become stale if the correction is
applied. Before/after review, explicit application, transaction locking, fingerprint
rechecks and receipts use the existing proposal workflow. No review endpoint applies
changes. Source edits or elapsed placement times require renewed review.

Reviews are transient and can be rerun. AI review supports at most 100 occupied
blocks and 12 contextual concerns; a model failure retains deterministic findings.
Correction options are independent, not a combined repair optimizer. Some overlapping
or protected conflicts require the existing explicit progress/manual workflow or
remaining-day replanning. Proposed plans must be current, pending and valid to project.
No schema change, migration, worker, indexing or deployment is required by this feature.

Validation uses focused domain/service/router and React tests, plus the existing
proposal acceptance/concurrency tests. See the implementation checkpoint in
[agent handoff](agent-handoff.md) for final checks and limitations.

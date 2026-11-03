# Use typed slot intent with deterministic placement

To make different guidance on adjacent availability slots meaningful, one bounded AI request receives all effective slots and candidates and returns typed planning intent keyed by slot identity. Each slot result supplies a target number of task minutes plus an ordered list of eligible task IDs and bounded reasons, but no timestamps or model-inferred categories. Application code prefilters hard-ineligible candidates, clamps budgets, prevents cross-slot over-allocation and retains ownership of conflicts, splitting, session rules and final placement. Explicit generation guidance outranks saved slot guidance as a soft preference; structured slot policy always wins.

Automatic blocks do not cross availability-slot boundaries. A task may occupy multiple slots only as separate segments, each eligible for its slot.

There is no deterministic fallback planner. If AI selection fails, Vela leaves the working draft unchanged and returns a debuggable error instead of producing a schedule that did not interpret the user's guidance. Deterministic placement and validation remain mandatory after successful AI selection and always enforce structured slot policies.

Failed attempts retain bounded, sanitized diagnostics: stage and stable error code, model and request identities, failure class, concise detail and validation paths. They do not retain secrets, full prompts or unrestricted model output.

The public deterministic Auto-fill and selection modes and the legacy draft generator are removed. Failed attempts use owner-scoped records independent of drafts, retained for 30 days and capped at the latest 100 attempts per user; manual planning is the only fallback.

When a date has no effective availability, Vela does not call the model. It explains whether the date is explicitly unavailable or its weekday is unassigned and offers configuration or manual-editing actions; this is expected state, not a failed generation attempt.

Unknown references, hard-ineligible slot assignments, schema-bound violations or contradictory structured intent fail the entire generation atomically and leave the draft unchanged. Vela does not silently drop malformed fragments. A valid sparse result that selects no suitable work for a slot is accepted and reported as unfilled; only the leisure-target policy may add a generic leisure block there.

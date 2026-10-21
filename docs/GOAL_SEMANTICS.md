# Goal semantics (#47)

Nutrition and Health share `lib/goals/semantics.ts`: a pure decimal evaluator with
inclusive minimum, maximum, exact target (optional ± tolerance), and range bounds.
A range uses the existing target amount as its lower bound. A minimum has no upper
bound; a maximum has no lower bound. Exceeding a minimum or staying below a maximum
satisfies the goal. Results distinguish below, within and above bounds, unset goals,
and unknown observations. Signed and zero Health targets never use percentage math.

## Persistence and compatibility

The additive migration `20261021210000_goal_semantics` adds JSONB `semantics` columns
to `nutrition_goals` and `health_goals`. Existing scalar amounts, ownership, versions
and history remain intact. Empty metadata resolves to exact target semantics, so
no existing protein target is silently reinterpreted as a minimum. Users can select
minimum explicitly. Nutrition stores per-nutrient options; Health stores one set
of options for its signed balance goal. Both boundaries validate the options and
ordered bounds; updates retain optimistic version checks. Older callers omitting
options retain the saved options and must still satisfy their bounds.

The choice of additive metadata avoids duplicating target amounts in JSON or moving
two existing owner-scoped settings models into a new cross-module table. A separate
goal table would become useful with multiple active goals, effective dates or new
evaluation periods; those are not implemented here. The shared evaluator accepts
resolved values and targets independently of persistence, so future dynamic target
resolvers can supply explicit calculated targets and provenance before evaluation.
Dynamic calculations, weekly periods, soft/hard limits, fiber goals and effective
historical goal versions remain future work.

## UI and interpretation

Nutrition and Health use the same goal-type controls and status labels. Nutrition
shows a capped attainment bar only for minimum goals; other types use their bounds
and status instead of treating distance to a limit as incomplete work. Health keeps
the balance difference from the configured amount, alongside its evaluated status.
These daily results describe logged data; they cannot establish complete food
logging or finalized device totals. Health explicitly labels its comparison as
provisional. Current settings still apply to every date shown.

Generate Prisma Client and apply the reviewed migration through the normal
backup/deploy procedure before running this version against an existing database.
The migration has been checked against Prisma's schema diff and tested on temporary
PostgreSQL tables inside a rolled-back transaction. Local deployment status is recorded in the
[shared handoff](agent-handoff.md).

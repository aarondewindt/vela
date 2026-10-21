# Daily meal scheduling (#55)

Settings → Planner → Daily meals enables breakfast, lunch and dinner independently.
Each has a same-day preferred window and an estimated 5–240 minute duration for
preparation, eating and cleanup together. Defaults are disabled; upgrading does
not change existing accounts' schedules. Meal settings use an owner-scoped version
check, independent of the other session/leisure settings.

Meals are recurring requirements, not tasks or task occurrences. A nullable JSONB
`PlannerGenerationSettings.mealPreferences` document stores the three finite
preferences. `DailyBlock.mealKind` identifies the daily instance; `(planId, mealKind)`
is unique, including cancelled/skipped history. The migration adds columns and
constraints without rewriting existing tasks, availability or categories.

Both AI selection and the model-free deterministic alternative place enabled meals
through the existing proposal validator **before** optional tasks/leisure. Meals
are explicit MEAL additions represented as REST blocks, without a task occurrence
or calendar link. They inherit current REST recovery/reservation semantics: a meal
at least as long as the short break resets the session clock, and REST may occur
inside category slots. No new task/category association or category migration is
introduced. Availability and busy calendar commitments still apply.

Automatic placement searches for a continuous block inside each preferred window,
using the plan timezone and ten-minute preview buffer. Missing/ambiguous DST times,
past windows, insufficient continuous availability and the proposal operation
limit produce explicit unmet requirement messages, including when there are no
task placements or no savable proposal. It does not silently shorten meals, place
them outside the window or assume PTO allows meals; existing PTO/NO_WORK semantics
still disable ordinary availability. Placement is a bounded greedy search, not a
packing optimizer; overlapping meal windows can require adjustment.

Generation retains existing blocks. Replanning handles flexible meals before task
placements, tries valid existing times first, and keeps block IDs and durations.
Missing meals are added through the same validator. A flexible meal that cannot
fit is explicitly cancelled in the reviewed preview with an unmet warning; fixed
or started blocks are retained with a conflict warning. Manual moves/resizes through
the proposal editor, explicit postponement, and Today drag/resize edits fix the
meal block against later automatic moves. The ordinary move and duration editor
rules still apply: change its time and duration separately. Actual meal completion
can use Progress & replan without completing a task.

A skipped/cancelled meal is a deliberate day override and is not regenerated.
The Today delete path cancels meals rather than deleting their identity. Unskip
remains available for skipped blocks; cancelled blocks have no restore control yet.
Changing/disabling a recurring preference does not rewrite existing meal blocks.
Explicit clear-plan remains the existing destructive whole-plan workflow and can
remove meal history, like other block history. The retired legacy draft API keeps
existing meal blocks, but only the shared proposal generator adds missing meals.

Proposal fingerprints include meal preferences/versions and blocks; the existing
acceptance table locks already include their tables. Preview remains read-only,
and acceptance revalidates atomically with receipt replay and DB uniqueness.
Pending previews created before the schema upgrade may require regeneration.
For verification and rollout evidence see [scheduler evaluation](PLANNER_EVALUATION.md).

#17 remains an architecture review. Nutrition links/logging (#68), sleep,
multipart meals (#54), availability guidance (#69) and templates (#70) are deferred.

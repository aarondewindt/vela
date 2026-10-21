# Goal semantics (#47)

Nutrition and Health share `lib/goals/semantics.ts`: a pure decimal evaluator with
inclusive minimum, maximum, exact target (optional ± tolerance), and range bounds.
The existing scalar amount is the minimum for minimum/range goals. Ranges accept
an upper bound and an optional preferred target inside the range. Minimum goals
accept optional preferred and excellent milestones, ordered as
minimum ≤ preferred ≤ excellent. An excellent milestone requires a preferred target.
A minimum has no upper limit, so exceeding any milestone remains successful.

Results distinguish unset goals, unknown observations, below/within/above bounds,
and minimum/preferred/excellent milestones. Difference is measured from the
preferred target when configured, otherwise from the scalar amount. Signed and
zero Health targets never use percentage math. Validation and persistence remain
application-owned; AI does not set or evaluate these goals.

## Persistence and compatibility

The additive migration `20261021210000_goal_semantics` adds JSONB `semantics` columns
to `nutrition_goals` and `health_goals`. `20261021230000_goal_thresholds_fiber` adds a
nullable fiber amount to Nutrition goals; new thresholds use the same metadata.
Existing ownership, optimistic versions and diary snapshots remain intact.
Protein goals with absent options or an exact target without tolerance are converted
to minimum semantics, retaining their amount and incrementing their version.
Explicit ranges, maxima, nonzero tolerance bands and existing minimum milestones
are retained. No preferred/excellent values or dietary bounds are prescribed.

Nutrition settings default new protein/fiber goals to minimum semantics. Other
absent options still resolve to exact target semantics. Fat and calorie balance can
use the shared range controls for minimum, maximum and preferred target. Older
callers omitting fiber retain its saved amount. Callers omitting options retain saved
options; services validate the combined saved/new values before writing.

The choice of additive metadata avoids duplicating target amounts in JSON or moving
two owner-scoped settings models into a new cross-module table. A separate goal
table would become useful with multiple active goals, effective dates or new
periods. The evaluator accepts resolved values independently of persistence, so
future dynamic target resolvers can supply calculated targets and provenance.
Dynamic calculations, weekly periods, soft/hard limits and effective historical
goal versions remain future work.

## UI and interpretation

Nutrition uses marked bars for configured positive goals, including fiber. The
highest desired edge initially sits at 90% of the track. Ranges/tolerances show a
shaded interval; minimum, preferred and excellent values have markers. Overage
expands the scale with 5% headroom. Minimum goals are red below minimum, orange
from minimum to preferred, green at/above preferred, and cyan at/above excellent.
Without a preferred milestone, reaching the minimum shows green. Labels include
“Minimum reached — keep going!”, “Goal reached!” and “Excellent goal reached!”.
Other goal types retain teal inside bounds, orange below and red above.
Accessible values report actual amounts, thresholds and status.

The compact dashboard variant uses four horizontal rows and places its highest
goal marker at 75% initially, retaining the same overage expansion. It uses blue
below goal, green within bounds, red above an upper bound and the existing
orange/green/cyan milestone colors. Unknown amounts keep a neutral track and
markers with “Waiting for data”, without reporting a numeric value. The detailed
Nutrition diary retains its existing cards, colors and 90% scale.

History references use yellow for minimum thresholds, green for targets and
acceptable finite bands, red for maximum bounds and lime for excellent milestones.
These hues are distinct from the current Nutrition/Health data series. Reference
geometry is unlabeled; explanatory keys sit outside the plotting areas.

Unknown fiber remains unknown, with known partial intake shown separately. History
includes fiber in the macro chart and daily table; unknown values and missing days
remain gaps, while recorded zero remains zero. Signed Health goals show bounds,
preferred-target history and status, with difference measured from the preferred
target. Health comparisons remain provisional. These daily views cannot establish
complete food logging or finalized device totals. Current goals apply to all dates.

Apply migrations through the normal backup/deploy procedure and regenerate Prisma
Client before running against an existing database. Local status is recorded in the
[shared handoff](agent-handoff.md).

# Rest and routines architecture review (#17)

Reviewed against the current Planner and the #55 meal implementation on 2026-10-22.
No sleep or generalized routine system is implemented here.

## Findings

- Availability defines permissible scheduling time. Weekly windows and day overrides
  already express unavailable time; PTO/NO_WORK currently mean no ordinary availability.
- Calendar busy events reserve time independently of availability. They represent
  commitments, not requests for the Planner to find a suitable time.
- Task recurrence creates task occurrences and carries task progress/dependency/effort
  semantics. Meals should not acquire these semantics merely to reserve daily time.
- DailyBlock already supports taskless REST blocks, outcomes, fixed/manual protection,
  time edits, progress and reviewed replanning. #55 reuses this with a finite mealKind
  identifier, versioned recurring preferences and one block per meal/plan.
- The proposal workflow owns eligibility, placement validation, fingerprinting,
  concurrency and atomic application. A second scheduling engine would duplicate
  precisely the rules that need to remain application-owned.

## Recommendation

Retain #17 and narrow its remaining scope to sleep/overnight rest architecture.
#55 covers breakfast/lunch/dinner preferences, continuous meal placement, daily
identity, individual adjustments and explicit unmet requirements. #68 can attach
an optional Product reference to the existing block ID without copying nutrients
or treating scheduled food as consumed. Do not close #17 after meal delivery.

Keep the finite meal implementation for now. An extensible RoutineDefinition and
RoutineOccurrence would offer value only after multiple routines need recurrence
rules, exceptions, independent lifecycle or cross-day identity. Introducing them
now would add a second recurrence system and migration costs without evidence
that the three meals need that complexity. Breaks already use generated REST
blocks/session rules; they do not need recurring definitions.

First decide what “schedule sleep” means: display unavailable time, recommend a
bedtime, or actively reserve a requested duration. Availability exclusions can
handle the first; optional calendar commitments handle imported actual reservations.
Neither expresses an unmet requested duration or a flexible sleep window.

Flexible overnight sleep would need a stable **cross-day occurrence**, an explicit
anchor-date convention (bedtime date vs wake date), timezone/DST elapsed-duration
rules, and reviewed per-night overrides. The current validator deliberately limits
new blocks to one local day. Silently splitting sleep into two independent daily
blocks could duplicate, shorten or move half a night during replanning. Any split
projection must share a persistent occurrence ID and apply/check both affected days
atomically, with fingerprints and locks covering both days. Changing a timezone or
recurring preference must not rewrite accepted history or discard explicit edits.

Availability also needs a product decision: sleep often occupies time that is
intentionally unavailable for tasks. Making REST bypass availability globally
would break existing hard constraints. Either keep sleep as a separate unavailable
interval projection or define typed activity eligibility for availability in a
separately reviewed policy. Do not infer this permission from category names or
AI guidance. Missed sleep requirements and imported busy overlaps need explicit
resolution, not silent overbooking.

## Suggested order

1. Complete/review #55 and evaluate daily meal behavior under #41.
2. Complete #69's availability/category guidance and hard-constraint decisions;
   #70 templates must copy that agreed model and follow #69.
3. Revise #17 around sleep semantics, night identity, overnight/DST behavior,
   unavailable-time policy and per-night edits. Split a focused implementation issue
   only after those decisions; reuse proposal validation/application.
4. Introduce a shared routine model only if that sleep design and subsequent concrete
   routine use cases demonstrate a need. Migrate meal preferences/identities explicitly
   at that point, preserving accepted daily blocks and future Nutrition references.

Nutrition integration #68 can follow #55 independently of sleep. No #69/#70 work,
category removal/migration or multipart task implementation is included in this batch.

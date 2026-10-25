# Calorie burn baseline (#110, Phase 1)

`lib/health/calorie-projection.ts` owns the reusable calculation. Health daily
history (including the dashboard gauge) and chart history use the same helper.
No future values are persisted. There is no statistical or Planner prediction,
and no remaining intake budget (#108).

## Samsung interpretation

The Companion uses Data SDK `ActivitySummaryType.TOTAL_CALORIES_BURNED` and
`TOTAL_ACTIVE_CALORIES_BURNED`, `AggregateSourceFilter.fromPlatform()` and the
same `LocalTimeFilter` from local midnight through a captured instant. Samsung
specifies interval calorie aggregates and gives midnight-to-now examples:

- [Total calories](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/-companion/-t-o-t-a-l_-c-a-l-o-r-i-e-s_-b-u-r-n-e-d.html)
- [Active calories](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/-companion/-t-o-t-a-l_-a-c-t-i-v-e_-c-a-l-o-r-i-e-s_-b-u-r-n-e-d.html)
- [#57 resolution](https://github.com/aarondewindt/vela/issues/57#issuecomment-6391868841): the earlier issue was Health Connect synchronization, resolved by reading the Samsung SDK directly.

Based on this documented interval contract, Vela classifies this specific adapter
as elapsed expenditure. It does not treat Samsung's app daily display or an
unknown imported total as equivalent. The existing wire kind
`sdk_aggregate_semantics_unverified` identifies this adapter; it is preserved for
compatibility with installed Companions/outboxes. Export, manual and HA readings
remain unclassified. Explicit incompatible semantics are rejected.

For cutoff `t`, projection = observed total + BMR × (next midnight − t) /
(next midnight − midnight). The denominator is the actual local day duration,
including DST. BMR is the latest imported Samsung body-composition point, with
its actual measurement timestamp retained and shown. Missing BMR is not estimated.
An explicit full-day-resting-inclusive total is never passed through this equation.

The SDK aggregate does **not** expose wearable measurement or last-sync timestamps.
The cutoff is the query boundary, and `observedAt` is SDK response capture time,
not server receipt. Delayed wearable synchronization can still undercount burn.
A read-only check of stored imports on 2026-10-25 found nine paired total/active
intervals with BMR, including one partial-day interval. That partial-day resting
difference was closer to elapsed BMR than a full-day BMR allowance, corroborating
the documented interval interpretation. This is limited evidence, not validation
of every Samsung version or wearable. No numeric heuristic reclassifies values.

## Observations and corrections

Calorie ingestion now includes the normalized cutoff instant in `sourceKey`.
Repeated captures/corrections for that cutoff are idempotent and newer captures
replace older revisions, including downward corrections. Different cutoffs remain
separate real observations in the existing table; no migration is required.
Previously overwritten captures cannot be recovered. Existing daily rows remain
readable. Daily source precedence is unchanged, then greatest cutoff wins, then
capture/receipt/id break ties. Daily totals are never summed across captures.

Today lines use actual captures from the authoritative daily total's device and
owner timezone. Sparse captures remain sparse; no midnight zero or intermediate
bins are invented. Active/resting needs the same source, device, timezone and
query interval. Invalid or incompatible breakdowns remain gaps and are labeled.
Historical stacked bars retain unsplit totals if a compatible breakdown is absent.
The Today toggle is local to the existing Calories burned chart and preserves the
global history range. Numeric time axes distinguish repeated DST hours by offset.

The dotted line starts at the selected actual total and ends at next local midnight.
The blue gauge marker is consumed so far minus that same projected total. Current
and projected balances appear together in the center as signed whole kcal; the
projection uses the same blue as its marker. Current balance retains its original
marker. A tooltip over recorded burn shows its last capture time. The baseline assumes no
additional food or active expenditure. Its scale includes both markers and the
green goal range with the existing 5% margins. Invalid/missing-data goal behavior
is preserved. Stale same-day captures are projected from their original cutoff;
previous-day values are never projected into today. UI labels expose cutoff,
response-relative age, and BMR measurement date.

Captures accumulate over time (normally hourly plus manual syncs); no new retention
policy is introduced. Repeated local-time query boundaries are retained as supplied
by the Companion; Samsung's LocalTimeFilter cannot encode an overlap offset, so
source-side ambiguity is a remaining SDK limitation.

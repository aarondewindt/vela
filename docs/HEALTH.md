# Health and Home Assistant

The **Health** app (`/health`) tracks weight (kg), body fat (%), lean mass (kg), sleep
(hours), steps, BMR (kcal/day), total and active calories burned (kcal). It shows the latest reading for each
metric on each calendar date, with 7/30-day history. Weight, body fat, lean mass and BMR
cards/table carry the latest known reading forward, even from before the selected
period, and label its original date. Source, timestamp basis and record identity
remain unchanged; no measurements are inserted. Charts show actual readings with
gaps. Sleep and total daily burn are never carried forward, and calorie balance
requires same-day intake and burn. Manual
readings can be added and deleted. Home Assistant readings retain their provenance;
removing a mapping stops its future import without deleting history.

Calorie balance is **Nutrition diary intake − total calories burned**. Negative
means deficit; positive means surplus. The optional signed daily goal supports a
deficit, maintenance (zero), surplus, or no goal. Difference from goal is balance
minus the configured goal amount. Minimum, maximum, exact target (with optional
tolerance) and range semantics use the shared [goal evaluator](GOAL_SEMANTICS.md).
The status compares recorded data and remains provisional. The current goal applies
to all dates shown. No daily burn is inferred from active calories or BMR alone.
Missing food entries or burn data produce an unknown balance; unfinished days and
incomplete records are explicitly provisional. Nutrition entries stay authoritative
and edits/deletions are reflected on the next query. Health never changes Nutrition
goals or food records.

The compact calorie balance widget (#24, part of #107) shows the observed signed
balance once inside a Mantine semicircular gauge, beside larger consumed/burned
totals. A configured range goal is green and the rest of the arc is gray; the
marker represents current balance. The preferred target starts at the top and
the range occupies 20% of the default span. The scale translates before expanding
and preserves 5% margins around the balance and both range endpoints. Ranges
without an explicit preferred target retain the service's lower-bound fallback.
Missing balance or invalid/non-range goals use a neutral arc without a marker;
recorded intake/burn totals remain visible independently. Existing source dates
and provisional-data notices still apply. This widget does not project burn (#12)
or calculate remaining food budgets (#108).
The main Dashboard also reuses this widget for today's date in the user's timezone,
with the existing Health history API, a 30-second refresh and links to Health and
its goal settings. Missing current-day readings never fall back to historical burn.

## Connection setup

1. Configure these server-only variables in the environment used by both Next.js
   and the sync worker (for local Next.js, `.env.local`; for the container/public
   launcher, `vela.env` or the appropriate runtime environment):

   ```dotenv
   # Exact comma-separated trusted origins; include the scheme and port, no path.
   HOME_ASSISTANT_ALLOWED_ORIGINS=http://homeassistant.local:8123
   # Generate once using `openssl rand -hex 32`; keep private and stable.
   INTEGRATION_ENCRYPTION_KEY=<64 hex characters>
   ```

   The allowlist is operator-owned; it permits the intended LAN origin without
   exposing arbitrary server-side URL requests to users. Allow only trusted Home
   Assistant origins. REST redirects are rejected. HTTPS is preferable whenever
   traffic leaves a trusted local network.

2. Generate Prisma Client and apply the reviewed migration before running the new
   code: `yarn prisma generate`, `yarn prisma migrate deploy`. The additive migration
   `20261019090000_health_home_assistant` is applied to the current local database.
   A private backup was created before migration; existing application tables were
   not modified.
3. Restart the app with the new environment. Open **Home Assistant** in navigation
   (`/settings/home-assistant`), enter your instance origin and a long-lived token
   from your Home Assistant profile, then save. The saved token is never returned
   to the browser. Empty token input retains it; an origin change requires a new
   token and clears mappings. Each Vela user has a separate connection.
4. Select **Test connection / load sensors**, then map your own weight, body fat,
   and lean mass Withings sensors only. Samsung Health calories, steps, sleep and
   BMR synchronize through the Android companion. Unmapped metrics stay missing. Confirm the displayed
   units and source sensors. The application cannot determine which person an
   arbitrary Home Assistant sensor belongs to.
   The **Sensor diagnostics** panel checks each saved mapping against live Home
   Assistant states. It shows the entity ID, raw state/unit, timestamps, converted
   reading/date and a specific rejection reason (missing entity, unavailable or
   nonnumeric state, unsupported unit, invalid range or timestamp). Use **Refresh
   diagnostics** after saving mappings. This read-only check uses the same validation
   as the importer; it does not import readings or update worker status. The Health
   status banner links directly to this panel. Credentials and unrelated attributes
   are never included in diagnostics.

5. Run a supervised background process alongside the app:

   ```bash
   yarn home-assistant:sync --check
   yarn home-assistant:sync
   ```

   The worker loads Next.js environment files and the inherited runtime environment.
   Keep it supervised/restarted by your deployment process; opening a browser or
   starting Next.js alone does not start synchronization. `--check` only verifies
   imports/database access, without opening a Home Assistant connection. SIGINT and
   SIGTERM stop subscriptions and release leases. Desktop sleep interrupts sync.

The Home Assistant health path is **Withings → Home Assistant → Vela** for weight,
body fat and lean mass. Old Samsung/Health Connect mappings are ignored; existing
historical readings remain stored. General Home Assistant REST/WebSocket clients,
connection management and discovery remain available to other Vela modules.
See [the required source matrix](ANDROID_SOURCE_MATRIX.md) for the Android path.

## Implementation and privacy

- `lib/integrations/home-assistant/client.ts` is a reusable server-only read adapter:
  REST state/history reads and selected-entity WebSocket subscriptions. It has no
  health calculations or persistence. Transport errors omit remote bodies and tokens.
- Connection settings, credentials and entity discovery are owner-scoped services
  behind protected tRPC procedures. AES-256-GCM uses a dedicated key and authenticates
  each ciphertext against its owner ID. Back up this key separately and securely
  alongside the database recovery plan. Losing/changing it requires re-entering
  saved tokens. Database users/operators remain trusted; this is application-level
  user isolation, not isolation from server administrators. Home Assistant's own
  token permissions determine which HA entities the supplied account can read.
- `lib/health/` owns mapping validation, normalization, import and domain services.
  Imported identities include the owner, instance-origin namespace, entity, metric
  and sensor timestamp. Replays upsert;
  late history cannot overwrite newer observations. Manual request IDs are owner-scoped and reject changed payloads.
- The worker subscribes through `subscribe_entities`, reconstructs compact changes,
  pings the connection, queues ordered writes and retries failures with capped
  exponential backoff. Each user connection has a renewable database lease; revision,
  owner and lease checks fence writes after connection/mapping edits or disablement.
  Lease renewal runs independently of network history requests. There are at most
  ten simultaneous connections per process; additional processes share the leases.
- Initial/reconnect recovery reads at most seven days of HA history in daily chunks,
  with a five-minute overlap from the last successful reconciliation. History failure
  remains visible and does not advance that recovery cursor. Snapshots reconcile
  every minute. Sessions reload configuration/timezone every five minutes; connection
  edits/disablement are detected at the next heartbeat (normally within 15 seconds).
  REST calls have a 15-second timeout and bounded response size. Data in Health
  refreshes every 30 seconds while open.

## Limits

Withings imports can only recover history Home Assistant recorded and retained.
Outages longer than seven days can leave gaps. Exact device measurement times and
stable original record IDs are not assumed: timestamps are labeled **sensor state
time**, using HA `last_changed`. Equal-valued measurements without a new state
timestamp cannot be distinguished. Samsung sleep uses SDK date aggregates instead
of HA update-date grouping; full sleep-stage/session export is not implemented.

A user timezone should match the timezone used for daily totals on the source phone.
Changing Vela's timezone affects future imports after the worker reloads; existing
dates are retained. No missing day is reconstructed from a later cumulative total.
The daily detail shows one selected reading per day, not every intraday sample. For
Android-designated metrics, Samsung has priority over manual and legacy HA
readings. For weight, body fat and lean mass, Home Assistant has priority over
manual and other retained sources on the same measurement date. Within a source,
the latest observation wins. Carry-forward uses the most recent measurement date.
All historical and manual rows remain stored.

A successful Companion upload may contain historical measurements while the SDK
returns no reading for today. Health keeps the selected date's burn and balance
missing, explains the date gap, and offers a button to the latest recorded burn in
the displayed period. That earlier reading is dated and never used as today's
burn. Companion Dev Tools allow inspection of accepted receipts and dates;
an HTTP request alone does not establish that a particular metric/date was stored.

The connector currently reads data only. Home Assistant commands into Vela and Vela
service calls that control Home Assistant remain future work over explicit service
and authorization boundaries.

## Verification

Focused Jest coverage includes signed goals/missing data, unit conversions, local
midnight/DST, daily-total correction/replay, owner-scoped APIs and services, ciphertext
ownership/tampering, URL restrictions, compact WebSocket changes, authentication
failure, stalled connections, history recovery failure, lost leases/revisions, and
the Health goal UI. A temporary local REST/WebSocket simulator and real PostgreSQL
check verified import through the worker, normalization, daily-total deduplication,
Nutrition balance/goal comparison, manual retries and cross-user isolation; all
synthetic accounts/data were removed. Real device entities still need setup and
end-to-end verification by the account owner.

Health’s daily calorie-balance goal is configured in **Settings → Health** (`/settings/health`). The Health dashboard links to this editor. **Settings → Home Assistant** retains the private connection, health sensor mappings and diagnostics.


## Chart goal references (#23 follow-up)

Settings → Health now includes optional weight (kg), body-fat (%) and sleep
(hours) goals alongside the signed calorie-balance goal. Each supports the shared
goal types, including ranges and target tolerance. Values and bounds are validated
against the metric's supported limits. Empty amounts mean no goal; no health
thresholds are prescribed. Current goals apply to every displayed date.

Health history uses Mantine reference lines for targets, bounds and milestones,
and shaded reference areas for finite ranges/tolerance bands. Geometry has no text
labels. References use semantic hues distinct from the observation series: yellow
minimum, green target/acceptable band, red maximum and lime excellent. A short
key appears outside the plots. These remain visible
when observations are missing and extend the chart domain when needed. Actual
reading gaps and carried-forward labels retain their existing meaning. Lean mass
remains an observed series without goals; calculated lean mass is tracked in #67.

Migration `20261022000000_health_metric_goals` adds `health_goals.metricGoals`
with an empty JSONB default, preserving existing calorie goals and versions. All
goals save under the existing owner/version check; omitted metric goals from older
clients are retained.

## Android companion ingestion (#90)

Samsung Health manual snapshots now share the existing measurement store. Total and active calories remain separate; calorie balance selects one total per day with Samsung Health → manual → legacy Home Assistant priority. Active calories are visible but never added to total or used as total burn. Samsung query/capture timestamps and unverified calorie semantics are labeled explicitly. See [manual sync deployment and phone testing](ANDROID_MANUAL_SYNC.md).

## Required source matrix (#92 continuation)

See [Android source matrix](ANDROID_SOURCE_MATRIX.md) for steps, sleep and direct
SDK BMR ingestion, schema migration, new read permissions and phone acceptance.

## Shared history and dashboard (#25, #26, #107)

One Health-page dropdown controls all eight existing history plots: last 10/30
days, 3/6 calendar months, one calendar year, and all time. The default is 10 days.
The `health-history` Zustand store persists only this UI selection in localStorage
and restores it after mount. Server data stays in tRPC/TanStack Query. The existing
period-ending date still anchors history; daily cards/table retain a small,
explicitly labeled seven-day detail window.

`health.chartHistory` validates the range and delegates to `lib/health/history.ts`.
It reuses the daily history's authoritative source/date selection and Nutrition's
scalar snapshot grouping query. All time starts at the owner's earliest Health
or diary date, never another owner's data. Future end dates are capped at today
in the owner's timezone. Stored source calendar dates are retained after timezone
changes; historical measurements are not reassigned using the viewer's timezone.
Manual writes/deletes invalidate both detail and chart queries.

Aggregation occurs on the server before transmission/rendering:

- Up to 93 inclusive days: daily observations; 94–366 days: Monday–Sunday
  calendar weeks clipped to the selected window; longer periods: calendar months.
- Histories exceeding 180 months use multi-month buckets to bound output to at
  most 181 points. Empty periods remain present without allocating every empty
  day in long histories. The database still reads one authoritative scalar row per
  observed metric/day, so query cost grows with the stored daily history.
- Weight, lean mass, body fat, sleep, steps and BMR use means of actual daily
  readings in multi-day buckets. Tooltips retain observed minima/maxima and day
  coverage. Carry-forward values never become chart observations.
- Burn uses sums of recorded daily totals, with missing/partial-day coverage
  exposed. Active/resting stacks require explicitly verified expenditure semantics,
  matching source/device, timezone and query bounds, and `0 ≤ active ≤ total`.
  Otherwise the same chart shows an orange **Total (unsplit)** bar. No invalid
  difference is clamped, and BMR is never used as resting expenditure.
- Balance preserves `intake − total burn`, rounding each daily balance using the
  existing calculation before summing. A multi-day sum is present only when all
  selected days have both inputs, are in the past, and Samsung burn covers the
  complete source day. Today and incomplete periods remain gaps. A diary with
  some food logged is still not proof that all intake was recorded.
- Current body/sleep goal references stay visible, including missing observations;
  sleep references apply to daily means. Signed balance references apply only to
  daily values and are hidden for multi-day sums.

Calories burned alone has a local Today toggle; it leaves the shared range intact.
Today currently shows **10-minute data unavailable**, with no synthetic bins.
Investigation inspected the production Samsung adapter, version-1 upload/upsert
contract, background schedule, and the existing private #92 physical-device probe.
The production adapter requests an ungrouped midnight-to-query aggregate. Upload
capture times are SDK response/sync times, not underlying measurement times, and
each device/metric/date is updated in place. The probe's explicit hourly groups
had hour-sized bounds (including DST/partial-period anomalies), not evidence of
10-minute resolution. No 10-minute read or ingestion has been validated. WorkManager
allows 15/30/60/120-minute scheduling, default 60, without guaranteeing exact timing.
The [recorded investigation](ANDROID_DST_INVESTIGATION.md) also demonstrates delayed
SDK availability associated with opening Samsung Health. It does not prove an
internal synchronization trigger or classify elapsed/projected expenditure.

Samsung documents [local-time calorie aggregation](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/-companion/-t-o-t-a-l_-c-a-l-o-r-i-e-s_-b-u-r-n-e-d.html)
and [aggregate interval bounds](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.data/-aggregated-data/index.html).
Neither establishes measurement timestamps for these imported daily snapshots.
Current ingestion retains `sdk_aggregate_semantics_unverified`; no current adapter
emits the explicit verified classification required for decomposition. Therefore
current Samsung history displays unsplit totals. Enabling verified stacks or real
intraday bins requires new source evidence and an adapter/ingestion change, not
interpolation of existing snapshots. No Android synchronization policy is changed
by this UI work.

The main dashboard adds compact Weight, Body fat and Sleep summaries alongside
the existing calorie-balance gauge. They share the same seven-day Health query and
goals. Body readings can carry forward from before that window and retain their
measurement dates; Sleep shows the latest reading within seven days, dated and
labeled when stale, or an explicit missing state. All eight detailed history plots
remain on the Health page.

Verification for this batch (2026-10-25): 140 focused Health/component/Nutrition
history/store tests passed; three existing integration tests were skipped. Typecheck,
production build (`NODE_ENV=production yarn build`), changed-file Oxlint/formatting,
Stylelint and diff checks passed. Authenticated browser checks used a disposable
synthetic account with 17 years of daily history, exercised every range, reload
persistence, Today isolation, missing-day balances, goal display and dashboard
summaries at 1440/390/320px. The account and its data were removed afterward.
Next.js runtime diagnostics returned no current errors after exercising the pages.
Full-repository `yarn lint` remains blocked by 28 existing errors in unrelated
auth, shell, editor and Planner files; no Health/range/chart lint errors remain.

## Historical exports (#109)

CLI-only Withings and Samsung Health backfills, dataset inventory, duplicate and
overwrite rules, dry-run results and unresolved calorie/sleep semantics are in
[Historical Health imports](HEALTH_HISTORICAL_IMPORT.md). Real imports have not yet
been performed; issue #109 remains open pending import and verification.

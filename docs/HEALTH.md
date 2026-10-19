# Health and Home Assistant

The **Health** app (`/health`) tracks weight (kg), body fat (%), lean mass (kg), sleep
(hours) and total daily calories burned (kcal). It shows the latest reading for each
metric on each calendar date, with 7/30-day history and gaps for missing data. Manual
readings can be added and deleted. Home Assistant readings retain their provenance;
removing a mapping stops its future import without deleting history.

Calorie balance is **Nutrition diary intake − total calories burned**. Negative
means deficit; positive means surplus. The optional signed daily goal supports a
deficit, maintenance (zero), surplus, or no goal. Difference from goal is balance
minus goal. This is a comparison, not a pass/fail threshold. The current goal applies
to all dates shown. No daily burn is inferred from active calories or BMR alone.
Missing food entries or burn data produce an unknown balance; unfinished days and
incomplete records are explicitly provisional. Nutrition entries stay authoritative
and edits/deletions are reflected on the next query. Health never changes Nutrition
goals or food records.

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
   lean mass, latest sleep duration, and **total daily calories burned including
   basal metabolism** sensors. Unmapped metrics stay missing. Confirm the displayed
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

The upstream path is Samsung Health/Withings → Health Connect → Android Home
Assistant Companion sensors → Home Assistant. Configure upstream permissions and
sensor enablement on your phone. Confirm actual entities before relying on a metric.
See [Companion health sensors](https://companion.home-assistant.io/docs/core/sensors/#health-connect-sensors).

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
  and sensor timestamp (or calendar date for cumulative totals). Replays upsert;
  late history cannot overwrite newer daily totals. Lower corrected totals replace
  earlier values. Manual request IDs are owner-scoped and reject changed payloads.
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

Health Connect sensors expose latest readings or aggregates, rather than a guaranteed
complete export of original Health Connect records. Vela can only recover history
that Home Assistant actually recorded and retained. Outages longer than seven days
can leave gaps. Exact device measurement times and stable original record IDs are
not assumed: imported timestamps are labeled **sensor state time**. Body/sleep data
uses HA `last_changed`; daily burn uses `last_updated`. Equal-valued measurements
without a new state timestamp cannot be distinguished. Sleep is grouped by its
sensor update date; this first version does not import sleep stages/session boundaries.

A user timezone should match the timezone used for daily totals on the source phone.
Changing Vela's timezone affects future imports after the worker reloads; existing
dates are retained. No missing day is reconstructed from a later cumulative total.
The view shows daily latest measurements, not every intraday sample. A later manual
reading takes precedence until deleted or superseded by a later sensor timestamp.

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

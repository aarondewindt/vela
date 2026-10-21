# Settings organization

`/settings` is the directory for implemented configuration. Account, Apps and
Integrations group the links. Every subpage shares an overview link, links to all
other sections and an active-page indicator. Mantine's responsive grid keeps this
navigation visible on desktop and mobile. The main application navbar also nests
Overview and every section under an expandable Settings group, which opens on
Settings routes and retains the existing mobile-menu close behavior.

## Inventory and destinations

| Configuration before #30 | Destination | Existing behavior retained |
| --- | --- | --- |
| Display name in the long Settings page | `/settings/profile` | Better Auth update, session refresh and validation |
| Color scheme in the long Settings page | `/settings/appearance` | Device-local Mantine light/dark/system preference; available signed out |
| AI defaults, profiles and feature overrides in Settings | `/settings/ai-models` | Account preferences and model capability filtering |
| Planner timezone in Settings | `/settings/planner` | Saved account timezone used across schedules, Nutrition and Health |
| Planning defaults in Today's modal | `/settings/planner` | Work sessions, short breaks, leisure durations and existing save mutation |
| Shared task-index model/instruction in AI settings | `/settings/planner` | Published model, maintainer-only confirmed rebuilds |
| Nutrition goals at `/nutrition/settings` on master | `/settings/nutrition` | Goal types, version checks, saved targets and return-to-diary date |
| Related-food search status/refresh in the food catalog (#20) | `/settings/nutrition#related-food-search` | Refresh retry, worker state and error handling |
| Shared food-index model/instruction in AI settings | `/settings/nutrition#related-food-search` | Published model, maintainer-only confirmed rebuilds |
| Calorie-balance goal at the bottom of Health | `/settings/health` | Signed amounts, goal semantics and optimistic version checks |
| Home Assistant route, linked from Health and main navigation | `/settings/home-assistant` | Private encrypted connection, synchronization, sensor mappings and diagnostics |

Nutrition goals have a single editor in Settings, completing the placement requested
in #21. The old `/nutrition/settings` URL redirects, preserving a valid `date` query
parameter. Older `/settings#ai-models` bookmarks open the AI subpage. In-app links
use the new routes directly. Today, Health, the food catalog and the diary link to
the relevant Settings page instead of maintaining duplicate configuration forms.

Search usage actions (querying and incremental task indexing), date-specific
availability, planner display controls, record/recipe editing, NEVO import choices,
Dev Tools generation controls and per-conversation/draft model overrides stay in
their workflows. These are contextual actions rather than a second account
configuration screen. Environment/deployment settings such as provider URLs and
worker credentials remain server configuration; no credential-management UI is added.

All persistent configuration continues through authenticated tRPC/Better Auth APIs.
Search-maintainer authorization remains server-enforced. `health.getGoal` provides an owner-scoped read for the Settings editor;
the additive `20261022000000_health_metric_goals` migration adds nullable,
user-entered weight, body-fat and sleep goals in a JSONB map on the existing
owner/version-fenced Health goal record. Older callers retain these goals. No
scheduling behavior changes.

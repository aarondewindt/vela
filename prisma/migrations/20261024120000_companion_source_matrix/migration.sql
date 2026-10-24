-- Additive only: retain all historical readings and mappings.
ALTER TYPE "HealthMetricKind" ADD VALUE 'STEPS';
ALTER TYPE "HealthMetricKind" ADD VALUE 'BMR';
-- Legacy HA mappings are retained for rollback, but ignored by the new worker/API.
UPDATE home_assistant_connections SET revision = revision + 1,
  status = 'Health source routing changed, reload Withings mappings', "lastSyncedAt" = NULL;

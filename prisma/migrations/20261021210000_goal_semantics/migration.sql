-- Existing scalar targets are retained. Empty options resolve to target semantics.
ALTER TABLE "nutrition_goals" ADD COLUMN "semantics" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "health_goals" ADD COLUMN "semantics" JSONB NOT NULL DEFAULT '{}';

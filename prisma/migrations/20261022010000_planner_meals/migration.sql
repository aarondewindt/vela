ALTER TABLE "planner_generation_settings"
  ADD COLUMN "mealPreferences" JSONB,
  ADD COLUMN "mealVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "daily_blocks" ADD COLUMN "mealKind" VARCHAR(16);
ALTER TABLE "daily_blocks" ADD CONSTRAINT "daily_blocks_mealKind_check"
  CHECK ("mealKind" IS NULL OR ("mealKind" IN ('BREAKFAST', 'LUNCH', 'DINNER') AND "taskOccurrenceId" IS NULL AND "calendarEventId" IS NULL));
CREATE UNIQUE INDEX "daily_blocks_planId_mealKind_key" ON "daily_blocks"("planId", "mealKind");

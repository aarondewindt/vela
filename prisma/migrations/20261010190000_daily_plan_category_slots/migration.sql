CREATE TYPE "CategorySlotSource" AS ENUM ('MANUAL', 'PLANNER');

CREATE TABLE "daily_plan_category_slots" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "category" "PlanningCategory" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "source" "CategorySlotSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "daily_plan_category_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "daily_plan_category_slots_planId_startsAt_idx"
ON "daily_plan_category_slots"("planId", "startsAt");

ALTER TABLE "daily_plan_category_slots"
ADD CONSTRAINT "daily_plan_category_slots_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "daily_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "daily_plan_category_slots" ("id", "planId", "category", "startsAt", "endsAt", "source", "updatedAt")
SELECT "id", "planId", "category", "startsAt", "endsAt",
       CASE WHEN "source" = 'MANUAL' THEN 'MANUAL'::"CategorySlotSource" ELSE 'PLANNER'::"CategorySlotSource" END,
       CURRENT_TIMESTAMP
FROM "daily_blocks"
WHERE "taskOccurrenceId" IS NULL
  AND "calendarEventId" IS NULL
  AND "category" IS NOT NULL
  AND ("source" = 'MANUAL' OR ("source" = 'PLANNER' AND "category" = 'LEISURE' AND "title" = 'Leisure'));

DELETE FROM "daily_blocks"
WHERE "taskOccurrenceId" IS NULL
  AND "calendarEventId" IS NULL
  AND "category" IS NOT NULL
  AND ("source" = 'MANUAL' OR ("source" = 'PLANNER' AND "category" = 'LEISURE' AND "title" = 'Leisure'));
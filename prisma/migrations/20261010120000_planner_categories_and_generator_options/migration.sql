CREATE TYPE "PlanningCategory" AS ENUM ('WORK', 'LIFE', 'LEISURE', 'REST');

ALTER TABLE "themes" ADD COLUMN "category" "PlanningCategory" NOT NULL DEFAULT 'WORK';
ALTER TABLE "tasks" ADD COLUMN "category" "PlanningCategory";
ALTER TABLE "daily_blocks" ADD COLUMN "category" "PlanningCategory";
ALTER TABLE "daily_blocks" ADD COLUMN "calendarEventId" UUID;

CREATE TABLE "planner_generation_settings" (
    "userId" TEXT NOT NULL,
    "workSessionMinutes" INTEGER NOT NULL DEFAULT 90,
    "shortBreakMinutes" INTEGER NOT NULL DEFAULT 15,
    "leisureMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "planner_generation_settings_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "daily_blocks_calendarEventId_idx" ON "daily_blocks"("calendarEventId");

ALTER TABLE "daily_blocks"
ADD CONSTRAINT "daily_blocks_calendarEventId_fkey"
FOREIGN KEY ("calendarEventId") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "planner_generation_settings"
ADD CONSTRAINT "planner_generation_settings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planner_generation_settings"
ADD COLUMN "shortLeisureBlockMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "maxLeisureBlockMinutes" INTEGER NOT NULL DEFAULT 90;
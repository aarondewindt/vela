-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'PAUSED', 'IN_PROGRESS', 'DONE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('PENDING', 'SCHEDULED', 'DONE', 'SKIPPED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OccurrenceOrigin" AS ENUM ('MANUAL', 'RECURRENCE', 'IMPORT');

-- CreateEnum
CREATE TYPE "DailyPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'FINALIZED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanGenerationSource" AS ENUM ('MANUAL', 'MORNING_RUN', 'REPLAN', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "BlockStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BlockSource" AS ENUM ('MANUAL', 'PLANNER', 'REPLAN', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "DayWorkMode" AS ENUM ('NORMAL', 'WFH', 'PTO', 'NO_WORK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CalendarEventSource" AS ENUM ('HA', 'GOOGLE', 'ICS', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationRunType" AS ENUM ('PLAN_INIT', 'MORNING_RUN', 'REPLAN', 'CALENDAR_SYNC', 'HA_PROJECTION');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "themes" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "brief" TEXT,
    "content" JSONB,
    "color" VARCHAR(32),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "brief" TEXT,
    "content" JSONB,
    "timezone" VARCHAR(64),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "themeId" UUID,
    "locationId" UUID,
    "title" VARCHAR(240) NOT NULL,
    "brief" TEXT,
    "content" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "size" INTEGER NOT NULL DEFAULT 3,
    "status" "TaskStatus" NOT NULL DEFAULT 'BACKLOG',
    "firstStep" TEXT,
    "dueDate" DATE,
    "earliestStartAt" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "recurrenceTz" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "blockedTaskId" UUID NOT NULL,
    "dependsOnTaskId" UUID NOT NULL,
    "dependencyType" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "isHardBlock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_occurrences" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" UUID NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "origin" "OccurrenceOrigin" NOT NULL DEFAULT 'RECURRENCE',
    "generatedRuleVersion" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_plans" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "planDate" DATE NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "status" "DailyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "generatedBy" "PlanGenerationSource" NOT NULL DEFAULT 'MANUAL',
    "explanationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "daily_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_blocks" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" UUID NOT NULL,
    "taskOccurrenceId" UUID,
    "title" VARCHAR(240) NOT NULL,
    "brief" TEXT,
    "content" JSONB,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "BlockStatus" NOT NULL DEFAULT 'PLANNED',
    "source" "BlockSource" NOT NULL DEFAULT 'MANUAL',
    "position" INTEGER,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_overrides" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "overrideDate" DATE NOT NULL,
    "workMode" "DayWorkMode" NOT NULL DEFAULT 'CUSTOM',
    "startTime" TIME(6),
    "endTime" TIME(6),
    "capacityMinutes" INTEGER,
    "locationId" UUID,
    "brief" TEXT,
    "content" JSONB,
    "source" VARCHAR(64) NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "externalCalendarId" VARCHAR(200) NOT NULL,
    "externalEventId" VARCHAR(200) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "brief" TEXT,
    "content" JSONB,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "isBusy" BOOLEAN NOT NULL DEFAULT true,
    "source" "CalendarEventSource" NOT NULL DEFAULT 'MANUAL',
    "ownershipMarker" VARCHAR(120),
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" UUID,
    "taskOccurrenceId" UUID,
    "blockId" UUID,
    "checkinAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "energyLevel" INTEGER,
    "focusLevel" INTEGER,
    "moodLevel" INTEGER,
    "brief" TEXT,
    "content" JSONB,
    "commandText" TEXT,
    "parsedCommandJson" JSONB,
    "applied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "runType" "AutomationRunType" NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerSource" VARCHAR(64) NOT NULL DEFAULT 'system',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "requestPayload" JSONB,
    "resultPayload" JSONB,
    "errorText" TEXT,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "themes_userId_idx" ON "themes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "themes_userId_name_key" ON "themes"("userId", "name");

-- CreateIndex
CREATE INDEX "locations_userId_idx" ON "locations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "locations_userId_name_key" ON "locations"("userId", "name");

-- CreateIndex
CREATE INDEX "tasks_userId_idx" ON "tasks"("userId");

-- CreateIndex
CREATE INDEX "tasks_userId_status_idx" ON "tasks"("userId", "status");

-- CreateIndex
CREATE INDEX "tasks_userId_dueDate_idx" ON "tasks"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "tasks_userId_priority_idx" ON "tasks"("userId", "priority");

-- CreateIndex
CREATE INDEX "tasks_themeId_idx" ON "tasks"("themeId");

-- CreateIndex
CREATE INDEX "tasks_locationId_idx" ON "tasks"("locationId");

-- CreateIndex
CREATE INDEX "task_dependencies_userId_idx" ON "task_dependencies"("userId");

-- CreateIndex
CREATE INDEX "task_dependencies_blockedTaskId_idx" ON "task_dependencies"("blockedTaskId");

-- CreateIndex
CREATE INDEX "task_dependencies_dependsOnTaskId_idx" ON "task_dependencies"("dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_blockedTaskId_dependsOnTaskId_key" ON "task_dependencies"("blockedTaskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "task_occurrences_userId_idx" ON "task_occurrences"("userId");

-- CreateIndex
CREATE INDEX "task_occurrences_taskId_idx" ON "task_occurrences"("taskId");

-- CreateIndex
CREATE INDEX "task_occurrences_userId_occurrenceDate_idx" ON "task_occurrences"("userId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "task_occurrences_userId_status_idx" ON "task_occurrences"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "task_occurrences_taskId_occurrenceDate_key" ON "task_occurrences"("taskId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "daily_plans_userId_idx" ON "daily_plans"("userId");

-- CreateIndex
CREATE INDEX "daily_plans_userId_planDate_idx" ON "daily_plans"("userId", "planDate");

-- CreateIndex
CREATE INDEX "daily_plans_userId_planDate_isCurrent_idx" ON "daily_plans"("userId", "planDate", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "daily_plans_userId_planDate_version_key" ON "daily_plans"("userId", "planDate", "version");

-- CreateIndex
CREATE INDEX "daily_blocks_userId_idx" ON "daily_blocks"("userId");

-- CreateIndex
CREATE INDEX "daily_blocks_planId_idx" ON "daily_blocks"("planId");

-- CreateIndex
CREATE INDEX "daily_blocks_taskOccurrenceId_idx" ON "daily_blocks"("taskOccurrenceId");

-- CreateIndex
CREATE INDEX "daily_blocks_userId_startsAt_idx" ON "daily_blocks"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "daily_blocks_planId_position_idx" ON "daily_blocks"("planId", "position");

-- CreateIndex
CREATE INDEX "daily_blocks_planId_startsAt_idx" ON "daily_blocks"("planId", "startsAt");

-- CreateIndex
CREATE INDEX "day_overrides_userId_idx" ON "day_overrides"("userId");

-- CreateIndex
CREATE INDEX "day_overrides_locationId_idx" ON "day_overrides"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "day_overrides_userId_overrideDate_key" ON "day_overrides"("userId", "overrideDate");

-- CreateIndex
CREATE INDEX "calendar_events_userId_idx" ON "calendar_events"("userId");

-- CreateIndex
CREATE INDEX "calendar_events_userId_startsAt_idx" ON "calendar_events"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_userId_endsAt_idx" ON "calendar_events"("userId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_userId_externalCalendarId_externalEventId_key" ON "calendar_events"("userId", "externalCalendarId", "externalEventId");

-- CreateIndex
CREATE INDEX "checkins_userId_idx" ON "checkins"("userId");

-- CreateIndex
CREATE INDEX "checkins_planId_idx" ON "checkins"("planId");

-- CreateIndex
CREATE INDEX "checkins_taskOccurrenceId_idx" ON "checkins"("taskOccurrenceId");

-- CreateIndex
CREATE INDEX "checkins_blockId_idx" ON "checkins"("blockId");

-- CreateIndex
CREATE INDEX "checkins_userId_checkinAt_idx" ON "checkins"("userId", "checkinAt");

-- CreateIndex
CREATE INDEX "automation_runs_userId_idx" ON "automation_runs"("userId");

-- CreateIndex
CREATE INDEX "automation_runs_userId_runType_idx" ON "automation_runs"("userId", "runType");

-- CreateIndex
CREATE INDEX "automation_runs_userId_startedAt_idx" ON "automation_runs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_runs_status_idx" ON "automation_runs"("status");

-- AddForeignKey
ALTER TABLE "themes" ADD CONSTRAINT "themes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blockedTaskId_fkey" FOREIGN KEY ("blockedTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_blocks" ADD CONSTRAINT "daily_blocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_blocks" ADD CONSTRAINT "daily_blocks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "daily_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_blocks" ADD CONSTRAINT "daily_blocks_taskOccurrenceId_fkey" FOREIGN KEY ("taskOccurrenceId") REFERENCES "task_occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_overrides" ADD CONSTRAINT "day_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_overrides" ADD CONSTRAINT "day_overrides_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_planId_fkey" FOREIGN KEY ("planId") REFERENCES "daily_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_taskOccurrenceId_fkey" FOREIGN KEY ("taskOccurrenceId") REFERENCES "task_occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "daily_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

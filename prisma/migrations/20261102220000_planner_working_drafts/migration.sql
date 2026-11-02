-- Additive: existing plans, blocks, proposals and task history remain untouched.
ALTER TABLE "daily_blocks" ADD COLUMN "manualOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "planner_drafts" (
  "id" UUID NOT NULL, "userId" TEXT NOT NULL, "planDate" DATE NOT NULL,
  "timezone" VARCHAR(64) NOT NULL, "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "basePlanId" UUID, "baseHash" CHAR(64) NOT NULL, "baseState" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "cursor" INTEGER NOT NULL DEFAULT 0,
  "nextRevision" INTEGER NOT NULL DEFAULT 1, "receipt" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "planner_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "planner_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "planner_drafts_status_check" CHECK ("status" IN ('OPEN', 'ACCEPTED', 'CANCELLED'))
);
CREATE INDEX "planner_drafts_userId_planDate_status_idx" ON "planner_drafts"("userId", "planDate", "status");
CREATE UNIQUE INDEX "planner_drafts_one_open_day" ON "planner_drafts"("userId", "planDate") WHERE "status" = 'OPEN';
CREATE TABLE "planner_draft_revisions" (
  "draftId" UUID NOT NULL, "sequence" INTEGER NOT NULL, "state" JSONB NOT NULL,
  "label" VARCHAR(240) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planner_draft_revisions_pkey" PRIMARY KEY ("draftId", "sequence"),
  CONSTRAINT "planner_draft_revisions_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "planner_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "planner_draft_requests" (
  "userId" TEXT NOT NULL, "requestId" UUID NOT NULL, "draftId" UUID NOT NULL,
  "requestHash" CHAR(64) NOT NULL, "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planner_draft_requests_pkey" PRIMARY KEY ("userId", "requestId"),
  CONSTRAINT "planner_draft_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "planner_draft_requests_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "planner_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Do not attempt to repair ambiguous legacy current versions by discarding data.
-- Acceptance takes the existing writer locks and rejects ambiguity explicitly.

CREATE TABLE "planning_proposals" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "planDate" DATE NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "baseHash" CHAR(64) NOT NULL,
  "document" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "receipt" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "planning_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "planning_proposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "planning_proposals_status_check" CHECK ("status" IN ('PENDING','APPLIED','DISCARDED')),
  CONSTRAINT "planning_proposals_resolution_check" CHECK (
    ("status" = 'PENDING' AND "resolvedAt" IS NULL AND "receipt" IS NULL) OR
    ("status" = 'DISCARDED' AND "resolvedAt" IS NOT NULL AND "receipt" IS NULL) OR
    ("status" = 'APPLIED' AND "resolvedAt" IS NOT NULL AND "receipt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "planning_proposals_userId_requestId_key" ON "planning_proposals"("userId", "requestId");
CREATE INDEX "planning_proposals_userId_planDate_createdAt_idx" ON "planning_proposals"("userId", "planDate", "createdAt");

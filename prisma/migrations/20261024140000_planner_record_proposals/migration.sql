CREATE TABLE "planner_record_proposals" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "inputHash" VARCHAR(64) NOT NULL,
  "preview" JSONB NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "receipt" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planner_record_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "planner_record_proposals_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "planner_record_proposals_conversationId_createdAt_idx" ON "planner_record_proposals"("conversationId", "createdAt");

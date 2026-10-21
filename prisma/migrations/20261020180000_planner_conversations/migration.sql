-- CreateTable
CREATE TABLE "planner_conversations" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "activeTurnId" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planner_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planner_conversation_turns" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'GENERATING',
    "result" JSONB,
    "receipt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planner_conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planner_conversations_userId_updatedAt_idx" ON "planner_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "planner_conversation_turns_conversationId_revision_key" ON "planner_conversation_turns"("conversationId", "revision");

-- AddForeignKey
ALTER TABLE "planner_conversations" ADD CONSTRAINT "planner_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_conversation_turns" ADD CONSTRAINT "planner_conversation_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "planner_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


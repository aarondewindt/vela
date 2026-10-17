-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "AiMessageStatus" AS ENUM ('COMPLETED', 'GENERATING', 'INTERRUPTED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(240) NOT NULL DEFAULT 'New conversation',
    "provider" VARCHAR(64) NOT NULL,
    "modelId" VARCHAR(200) NOT NULL,
    "activeGenerationId" UUID,
    "generationStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "conversationId" UUID NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "parts" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "AiMessageStatus" NOT NULL DEFAULT 'COMPLETED',
    "replyToId" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("conversationId","id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_userId_updatedAt_idx" ON "ai_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversationId_position_key" ON "ai_messages"("conversationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversationId_replyToId_key" ON "ai_messages"("conversationId", "replyToId");

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

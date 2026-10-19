-- CreateTable
CREATE TABLE "task_reviews" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" UUID NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "source" JSONB NOT NULL,
    "document" JSONB NOT NULL,
    "promptVersion" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "modelId" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "task_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_reviews_userId_taskId_createdAt_idx" ON "task_reviews"("userId", "taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


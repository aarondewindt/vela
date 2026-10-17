-- CreateTable
CREATE TABLE "embedding_collection_configs" (
    "key" VARCHAR(120) NOT NULL,
    "configuration" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leaseId" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embedding_collection_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "task_embeddings" (
    "taskId" UUID NOT NULL,
    "embedding" vector NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_embeddings_pkey" PRIMARY KEY ("taskId")
);

-- AddForeignKey
ALTER TABLE "task_embeddings" ADD CONSTRAINT "task_embeddings_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

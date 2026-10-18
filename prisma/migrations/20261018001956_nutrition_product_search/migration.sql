-- AlterTable
ALTER TABLE "products" ADD COLUMN     "searchUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "product_embeddings" (
    "productId" UUID NOT NULL,
    "embedding" vector NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "nutrition_product_index_jobs" (
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "completedRevision" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseId" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_product_index_jobs_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "nutrition_product_index_jobs_runAfter_idx" ON "nutrition_product_index_jobs"("runAfter");

-- AddForeignKey
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_product_index_jobs" ADD CONSTRAINT "nutrition_product_index_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nutrition_product_index_jobs" ADD CONSTRAINT "nutrition_product_index_jobs_state_check"
CHECK (revision > 0 AND "completedRevision" >= 0 AND "completedRevision" <= revision AND attempts >= 0
  AND (("leaseId" IS NULL) = ("leaseExpiresAt" IS NULL)));

-- Existing catalogs get the same durable refresh as newly created products.
INSERT INTO "nutrition_product_index_jobs" ("userId", "updatedAt")
SELECT DISTINCT "userId", CURRENT_TIMESTAMP FROM products WHERE "archivedAt" IS NULL;

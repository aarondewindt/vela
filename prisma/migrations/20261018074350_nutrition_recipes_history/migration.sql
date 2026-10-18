-- CreateTable
CREATE TABLE "nutrition_meal_copies" (
    "userId" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "entryIds" UUID[],
    "targetDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_meal_copies_pkey" PRIMARY KEY ("userId","requestId")
);

-- AddForeignKey
ALTER TABLE "nutrition_meal_copies" ADD CONSTRAINT "nutrition_meal_copies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nutrition_meal_copies"
ADD CONSTRAINT "nutrition_meal_copies_valid_hash" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "nutrition_meal_copies_valid_date" CHECK ("targetDate" BETWEEN '0001-01-01'::date AND '9999-12-31'::date),
ADD CONSTRAINT "nutrition_meal_copies_valid_entries" CHECK ("entryIds" IS NOT NULL AND cardinality("entryIds") BETWEEN 1 AND 100);

ALTER TABLE "products" ADD CONSTRAINT "products_calculated_yield"
CHECK ("calculationMode" <> 'CALCULATED' OR ("yieldQuantity" IS NOT NULL AND "yieldUnit" IS NOT NULL));

ALTER TABLE "nutrition_log_entries" DROP CONSTRAINT "nutrition_log_entries_snapshot_version";
ALTER TABLE "nutrition_log_entries" ADD CONSTRAINT "nutrition_log_entries_snapshot_version" CHECK (coalesce(
  jsonb_typeof("referenceSnapshot") = 'object' AND
  jsonb_typeof("referenceSnapshot"->'definition') = 'object' AND (
    ("referenceSnapshot"->>'schemaVersion' = '1' AND "referenceSnapshot"->>'calculationVersion' = 'direct-v1') OR
    ("referenceSnapshot"->>'schemaVersion' = '2' AND "referenceSnapshot"->>'calculationVersion' = 'recipe-v1' AND
      jsonb_typeof("referenceSnapshot"->'composition') = 'array' AND
      "referenceSnapshot"->>'recipeRevision' ~ '^[0-9a-f]{64}$')
  ), false));

CREATE INDEX "nutrition_log_entries_userId_productId_logDate_idx" ON "nutrition_log_entries"("userId", "productId", "logDate");

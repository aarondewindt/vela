-- CreateEnum
CREATE TYPE "NutritionMealCategory" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS');

-- CreateTable
CREATE TABLE "nutrition_log_entries" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" UUID,
    "logDate" DATE NOT NULL,
    "mealCategory" "NutritionMealCategory" NOT NULL,
    "productNameSnapshot" VARCHAR(240) NOT NULL,
    "quantity" DECIMAL(20,8) NOT NULL,
    "unit" "NutritionQuantityUnit" NOT NULL,
    "servingId" UUID,
    "unitLabelSnapshot" VARCHAR(80) NOT NULL,
    "resolvedQuantity" DECIMAL(20,8) NOT NULL,
    "referenceUnit" "NutritionReferenceUnit" NOT NULL,
    "calories" DECIMAL(20,8) NOT NULL,
    "protein" DECIMAL(20,8) NOT NULL,
    "carbohydrates" DECIMAL(20,8) NOT NULL,
    "fat" DECIMAL(20,8) NOT NULL,
    "fiber" DECIMAL(20,8),
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "referenceSnapshot" JSONB NOT NULL,
    "requestId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_goals" (
    "userId" TEXT NOT NULL,
    "calories" DECIMAL(20,8),
    "protein" DECIMAL(20,8),
    "carbohydrates" DECIMAL(20,8),
    "fat" DECIMAL(20,8),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_goals_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "nutrition_log_entries_userId_logDate_mealCategory_idx" ON "nutrition_log_entries"("userId", "logDate", "mealCategory");

-- CreateIndex
CREATE INDEX "nutrition_log_entries_productId_idx" ON "nutrition_log_entries"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_log_entries_userId_requestId_key" ON "nutrition_log_entries"("userId", "requestId");

-- AddForeignKey
ALTER TABLE "nutrition_log_entries" ADD CONSTRAINT "nutrition_log_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_log_entries" ADD CONSTRAINT "nutrition_log_entries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_goals" ADD CONSTRAINT "nutrition_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Historical quantities and totals use the catalog's finite NUMERIC(20,8) contract.
-- servingId deliberately has no live FK: the saved definition outlives serving deletion.
ALTER TABLE "nutrition_log_entries"
ADD CONSTRAINT "nutrition_log_entries_positive_quantities" CHECK (
  "quantity" > 0 AND "quantity" <= 999999999999.99999999 AND
  "resolvedQuantity" > 0 AND "resolvedQuantity" <= 999999999999.99999999),
ADD CONSTRAINT "nutrition_log_entries_valid_nutrients" CHECK (
  "calories" BETWEEN 0 AND 999999999999.99999999 AND
  "protein" BETWEEN 0 AND 999999999999.99999999 AND
  "carbohydrates" BETWEEN 0 AND 999999999999.99999999 AND
  "fat" BETWEEN 0 AND 999999999999.99999999 AND
  ("fiber" IS NULL OR "fiber" BETWEEN 0 AND 999999999999.99999999)),
ADD CONSTRAINT "nutrition_log_entries_valid_labels" CHECK (
  length(btrim("productNameSnapshot")) > 0 AND length(btrim("unitLabelSnapshot")) > 0),
ADD CONSTRAINT "nutrition_log_entries_valid_date" CHECK ("logDate" BETWEEN '0001-01-01'::date AND '9999-12-31'::date),
ADD CONSTRAINT "nutrition_log_entries_serving_unit" CHECK ("servingId" IS NULL OR "unit" = 'SERVING'),
ADD CONSTRAINT "nutrition_log_entries_snapshot_version" CHECK (coalesce(
  jsonb_typeof("referenceSnapshot") = 'object' AND
  "referenceSnapshot"->>'schemaVersion' = '1' AND
  "referenceSnapshot"->>'calculationVersion' = 'direct-v1' AND
  jsonb_typeof("referenceSnapshot"->'definition') = 'object', false)),
ADD CONSTRAINT "nutrition_log_entries_positive_version" CHECK ("version" > 0),
ADD CONSTRAINT "nutrition_log_entries_request_hash" CHECK ("requestHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "nutrition_goals"
ADD CONSTRAINT "nutrition_goals_positive_values" CHECK (
  ("calories" IS NULL OR ("calories" > 0 AND "calories" <= 999999999999.99999999)) AND
  ("protein" IS NULL OR ("protein" > 0 AND "protein" <= 999999999999.99999999)) AND
  ("carbohydrates" IS NULL OR ("carbohydrates" > 0 AND "carbohydrates" <= 999999999999.99999999)) AND
  ("fat" IS NULL OR ("fat" > 0 AND "fat" <= 999999999999.99999999))),
ADD CONSTRAINT "nutrition_goals_positive_version" CHECK ("version" > 0);

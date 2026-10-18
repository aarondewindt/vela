-- CreateEnum
CREATE TYPE "ProductCalculationMode" AS ENUM ('DIRECT', 'CALCULATED');

-- CreateEnum
CREATE TYPE "NutritionReferenceUnit" AS ENUM ('G', 'ML', 'SERVING');

-- CreateEnum
CREATE TYPE "NutritionQuantityUnit" AS ENUM ('G', 'KG', 'ML', 'L', 'SERVING');

-- CreateEnum
CREATE TYPE "ProductSourceType" AS ENUM ('MANUAL', 'DATASET', 'AI_ESTIMATE', 'EXTERNAL_API');

-- CreateEnum
CREATE TYPE "ProductVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'ESTIMATED');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "brand" VARCHAR(240),
    "description" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "normalizedName" VARCHAR(240) NOT NULL,
    "normalizedAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchText" TEXT NOT NULL,
    "calculationMode" "ProductCalculationMode" NOT NULL DEFAULT 'DIRECT',
    "referenceQuantity" DECIMAL(20,8) NOT NULL,
    "referenceUnit" "NutritionReferenceUnit" NOT NULL,
    "referenceLabel" VARCHAR(80),
    "calories" DECIMAL(20,8),
    "protein" DECIMAL(20,8),
    "carbohydrates" DECIMAL(20,8),
    "fat" DECIMAL(20,8),
    "fiber" DECIMAL(20,8),
    "servingSizeQuantity" DECIMAL(20,8),
    "servingSizeUnit" "NutritionReferenceUnit",
    "servingSizeIsEstimated" BOOLEAN NOT NULL DEFAULT false,
    "densityGramsPerMl" DECIMAL(20,8),
    "densityIsEstimated" BOOLEAN NOT NULL DEFAULT false,
    "yieldQuantity" DECIMAL(20,8),
    "yieldUnit" "NutritionReferenceUnit",
    "sourceType" "ProductSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceName" VARCHAR(240),
    "sourceRecordId" VARCHAR(240),
    "sourceVersion" VARCHAR(120),
    "importedAt" TIMESTAMP(3),
    "verificationStatus" "ProductVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "userModifiedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_servings" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity" DECIMAL(20,8) NOT NULL,
    "canonicalUnit" "NutritionReferenceUnit" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_servings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_components" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "parentProductId" UUID NOT NULL,
    "childProductId" UUID NOT NULL,
    "quantity" DECIMAL(20,8) NOT NULL,
    "unit" "NutritionQuantityUnit" NOT NULL,
    "servingId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_userId_archivedAt_normalizedName_idx" ON "products"("userId", "archivedAt", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "products_userId_id_key" ON "products"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "products_userId_sourceType_sourceName_sourceRecordId_key" ON "products"("userId", "sourceType", "sourceName", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "product_servings_productId_id_key" ON "product_servings"("productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_servings_productId_normalizedName_key" ON "product_servings"("productId", "normalizedName");

-- CreateIndex
CREATE INDEX "product_components_parentProductId_sortOrder_idx" ON "product_components"("parentProductId", "sortOrder");

-- CreateIndex
CREATE INDEX "product_components_childProductId_idx" ON "product_components"("childProductId");

-- CreateIndex
CREATE INDEX "product_components_childProductId_servingId_idx" ON "product_components"("childProductId", "servingId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_servings" ADD CONSTRAINT "product_servings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_userId_parentProductId_fkey" FOREIGN KEY ("userId", "parentProductId") REFERENCES "products"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_userId_childProductId_fkey" FOREIGN KEY ("userId", "childProductId") REFERENCES "products"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_childProductId_servingId_fkey" FOREIGN KEY ("childProductId", "servingId") REFERENCES "product_servings"("productId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Domain invariants Prisma cannot express. Keep these checks when extending the catalog.
CREATE UNIQUE INDEX "product_servings_one_default_per_product"
ON "product_servings" ("productId") WHERE "isDefault" = true;

ALTER TABLE "products"
ADD CONSTRAINT "products_positive_reference" CHECK ("referenceQuantity" > 0 AND "referenceQuantity" <= 999999999999.99999999),
ADD CONSTRAINT "products_valid_name" CHECK (length(btrim("name")) > 0 AND length(btrim("normalizedName")) > 0),
ADD CONSTRAINT "products_direct_nutrients" CHECK ("calculationMode" <> 'DIRECT' OR
  ("calories" IS NOT NULL AND "protein" IS NOT NULL AND "carbohydrates" IS NOT NULL AND "fat" IS NOT NULL)),
ADD CONSTRAINT "products_nonnegative_nutrients" CHECK (
  ("calories" IS NULL OR "calories" BETWEEN 0 AND 999999999999.99999999) AND
  ("protein" IS NULL OR "protein" BETWEEN 0 AND 999999999999.99999999) AND
  ("carbohydrates" IS NULL OR "carbohydrates" BETWEEN 0 AND 999999999999.99999999) AND
  ("fat" IS NULL OR "fat" BETWEEN 0 AND 999999999999.99999999) AND
  ("fiber" IS NULL OR "fiber" BETWEEN 0 AND 999999999999.99999999)),
ADD CONSTRAINT "products_named_serving" CHECK ("referenceUnit" <> 'SERVING' OR
  ("referenceLabel" IS NOT NULL AND length(btrim("referenceLabel")) > 0)),
ADD CONSTRAINT "products_physical_serving" CHECK (
  ("servingSizeQuantity" IS NULL AND "servingSizeUnit" IS NULL AND NOT "servingSizeIsEstimated") OR
  ("referenceUnit" = 'SERVING' AND "servingSizeQuantity" IS NOT NULL AND
   "servingSizeQuantity" > 0 AND "servingSizeQuantity" <= 999999999999.99999999 AND
   "servingSizeUnit" IS NOT NULL AND "servingSizeUnit" IN ('G', 'ML'))),
ADD CONSTRAINT "products_density" CHECK (
  ("densityGramsPerMl" IS NULL AND NOT "densityIsEstimated") OR
  ("densityGramsPerMl" IS NOT NULL AND "densityGramsPerMl" > 0 AND "densityGramsPerMl" <= 999999999999.99999999)),
ADD CONSTRAINT "products_yield" CHECK (
  ("yieldQuantity" IS NULL AND "yieldUnit" IS NULL) OR
  ("yieldQuantity" IS NOT NULL AND "yieldUnit" IS NOT NULL AND "yieldQuantity" > 0 AND "yieldQuantity" <= 999999999999.99999999)),
ADD CONSTRAINT "products_source_identity" CHECK (
  (("sourceName" IS NULL AND "sourceRecordId" IS NULL) OR
   ("sourceName" IS NOT NULL AND "sourceRecordId" IS NOT NULL AND length(btrim("sourceName")) > 0 AND length(btrim("sourceRecordId")) > 0)) AND
  ("sourceType" NOT IN ('DATASET', 'EXTERNAL_API') OR "sourceRecordId" IS NOT NULL) AND
  ("sourceType" <> 'MANUAL' OR "sourceRecordId" IS NULL)),
ADD CONSTRAINT "products_positive_version" CHECK ("version" > 0);

ALTER TABLE "product_servings"
ADD CONSTRAINT "product_servings_positive_quantity" CHECK ("quantity" > 0 AND "quantity" <= 999999999999.99999999),
ADD CONSTRAINT "product_servings_valid_name" CHECK (length(btrim("name")) > 0 AND length(btrim("normalizedName")) > 0);

ALTER TABLE "product_components"
ADD CONSTRAINT "product_components_positive_quantity" CHECK ("quantity" > 0 AND "quantity" <= 999999999999.99999999),
ADD CONSTRAINT "product_components_no_self_reference" CHECK ("parentProductId" <> "childProductId"),
ADD CONSTRAINT "product_components_serving_unit" CHECK ("servingId" IS NULL OR "unit" = 'SERVING');

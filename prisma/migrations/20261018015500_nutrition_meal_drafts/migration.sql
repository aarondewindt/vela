-- CreateEnum
CREATE TYPE "NutritionDraftStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "NutritionDraftTurnStatus" AS ENUM ('GENERATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "nutrition_meal_drafts" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL DEFAULT 'Meal draft',
    "logDate" DATE NOT NULL,
    "mealCategory" "NutritionMealCategory" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "modelId" VARCHAR(200) NOT NULL,
    "status" "NutritionDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB NOT NULL DEFAULT '[]',
    "questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "generationId" UUID,
    "generationExpiresAt" TIMESTAMP(3),
    "confirmedEntryIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_meal_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_draft_turns" (
    "id" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "userText" TEXT NOT NULL,
    "assistantText" TEXT,
    "status" "NutritionDraftTurnStatus" NOT NULL DEFAULT 'GENERATING',
    "requestedRevision" INTEGER NOT NULL,
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_draft_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nutrition_meal_drafts_userId_status_updatedAt_idx" ON "nutrition_meal_drafts"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "nutrition_draft_turns_draftId_createdAt_idx" ON "nutrition_draft_turns"("draftId", "createdAt");

-- AddForeignKey
ALTER TABLE "nutrition_meal_drafts" ADD CONSTRAINT "nutrition_meal_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_draft_turns" ADD CONSTRAINT "nutrition_draft_turns_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "nutrition_meal_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nutrition_meal_drafts" ADD CONSTRAINT "nutrition_meal_drafts_state_check"
CHECK (revision > 0 AND provider = 'ollama' AND length("modelId") > 0
  AND "logDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  AND jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 40
  AND cardinality(questions) <= 8 AND cardinality("confirmedEntryIds") <= 40
  AND (("generationId" IS NULL) = ("generationExpiresAt" IS NULL))
  AND (status = 'DRAFT' OR "generationId" IS NULL)
  AND ((status = 'CONFIRMED') = ("confirmedAt" IS NOT NULL)));

ALTER TABLE "nutrition_draft_turns" ADD CONSTRAINT "nutrition_draft_turns_content_check"
CHECK ("requestedRevision" > 0 AND length("userText") BETWEEN 1 AND 4000
  AND ("assistantText" IS NULL OR length("assistantText") <= 2000));

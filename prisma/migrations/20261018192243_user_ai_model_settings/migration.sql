-- AlterTable
ALTER TABLE "ai_conversations" ADD COLUMN     "inheritsModel" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "modelId" VARCHAR(200),
ADD COLUMN     "provider" VARCHAR(64);

-- AlterTable
ALTER TABLE "nutrition_draft_turns" ADD COLUMN     "modelId" VARCHAR(200),
ADD COLUMN     "provider" VARCHAR(64);

-- AlterTable
ALTER TABLE "nutrition_meal_drafts" ADD COLUMN     "inheritsModel" BOOLEAN NOT NULL DEFAULT true;

-- Preserve existing explicit selections; new conversations and drafts inherit settings.
UPDATE "ai_conversations" SET "inheritsModel" = false;
UPDATE "nutrition_meal_drafts" SET "inheritsModel" = false;
UPDATE "ai_messages" m SET "provider" = c."provider", "modelId" = c."modelId"
FROM "ai_conversations" c WHERE m."conversationId" = c.id AND m.role = 'assistant';
UPDATE "nutrition_draft_turns" t SET "provider" = d."provider", "modelId" = d."modelId"
FROM "nutrition_meal_drafts" d WHERE t."draftId" = d.id;

-- CreateTable
CREATE TABLE "user_ai_model_settings" (
    "userId" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "user_ai_model_settings_pkey" PRIMARY KEY ("userId","key")
);

-- AddForeignKey
ALTER TABLE "user_ai_model_settings" ADD CONSTRAINT "user_ai_model_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve legacy conversation model columns and all historical messages.
ALTER TABLE "ai_conversations" ADD COLUMN "modelSelections" JSONB;
ALTER TABLE "ai_messages" ADD COLUMN "modelSelections" JSONB;
ALTER TABLE "ai_messages" ADD COLUMN "pipelineCheckpoint" JSONB;

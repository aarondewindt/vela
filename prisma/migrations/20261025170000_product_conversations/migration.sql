ALTER TABLE "ai_conversations" ADD COLUMN "productId" UUID;
CREATE INDEX "ai_conversations_userId_scope_productId_idx" ON "ai_conversations"("userId", "scope", "productId");
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

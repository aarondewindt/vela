-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" VARCHAR(100) NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "retainedAt" TIMESTAMP(3),
    "deleteRequestedAt" TIMESTAMP(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_userId_createdAt_idx" ON "attachments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_retainedAt_createdAt_idx" ON "attachments"("retainedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


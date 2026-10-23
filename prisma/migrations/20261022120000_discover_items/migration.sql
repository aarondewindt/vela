-- CreateEnum
CREATE TYPE "DiscoverStatus" AS ENUM ('WANT_TO_EXPLORE', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'DROPPED');

-- CreateTable
CREATE TABLE "discover_items" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "contentType" VARCHAR(80) NOT NULL DEFAULT 'Other',
    "status" "DiscoverStatus" NOT NULL DEFAULT 'WANT_TO_EXPLORE',
    "description" TEXT,
    "url" VARCHAR(2048),
    "urlKey" CHAR(64),
    "imageUrl" VARCHAR(2048),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER,
    "notes" TEXT,
    "rating" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discover_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discover_items_priority_check" CHECK ("priority" BETWEEN 1 AND 3),
    CONSTRAINT "discover_items_rating_check" CHECK ("rating" BETWEEN 0 AND 10)
);

-- CreateIndex
CREATE INDEX "discover_items_userId_createdAt_idx" ON "discover_items"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "discover_items_userId_contentType_status_idx" ON "discover_items"("userId", "contentType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "discover_items_userId_urlKey_key" ON "discover_items"("userId", "urlKey");

-- AddForeignKey
ALTER TABLE "discover_items" ADD CONSTRAINT "discover_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


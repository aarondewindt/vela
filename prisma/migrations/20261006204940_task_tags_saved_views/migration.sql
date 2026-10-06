-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "themes" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "config" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_views_userId_scope_idx" ON "saved_views"("userId", "scope");

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

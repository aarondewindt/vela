-- AlterTable
ALTER TABLE "user" ADD COLUMN     "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Amsterdam';

-- CreateTable
CREATE TABLE "availability_windows" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "availability_windows_userId_weekday_isActive_idx" ON "availability_windows"("userId", "weekday", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "availability_windows_userId_weekday_startMinute_endMinute_key" ON "availability_windows"("userId", "weekday", "startMinute", "endMinute");

-- AddForeignKey
ALTER TABLE "availability_windows" ADD CONSTRAINT "availability_windows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

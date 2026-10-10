-- CreateTable
CREATE TABLE "date_availability_windows" (
    "id" UUID NOT NULL,
    "dayOverrideId" UUID NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "date_availability_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "date_availability_windows_dayOverrideId_idx" ON "date_availability_windows"("dayOverrideId");

-- CreateIndex
CREATE UNIQUE INDEX "date_availability_windows_dayOverrideId_startMinute_endMinu_key" ON "date_availability_windows"("dayOverrideId", "startMinute", "endMinute");

-- AddForeignKey
ALTER TABLE "date_availability_windows" ADD CONSTRAINT "date_availability_windows_dayOverrideId_fkey" FOREIGN KEY ("dayOverrideId") REFERENCES "day_overrides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

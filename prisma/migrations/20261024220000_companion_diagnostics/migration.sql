-- CreateTable
CREATE TABLE "companion_events" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" UUID NOT NULL,
    "uploadId" UUID,
    "kind" VARCHAR(16) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptId" UUID,
    "batchId" UUID,
    "trigger" VARCHAR(16) NOT NULL DEFAULT 'unknown',
    "status" VARCHAR(24) NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'samsung_health',
    "count" INTEGER NOT NULL DEFAULT 0,
    "metrics" TEXT[],
    "dateFrom" VARCHAR(10),
    "dateTo" VARCHAR(10),
    "durationMs" INTEGER,
    "retry" INTEGER,
    "replay" BOOLEAN,
    "errorCategory" VARCHAR(40),
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "companion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companion_uploads" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" UUID NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appVersion" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "report" JSONB NOT NULL,

    CONSTRAINT "companion_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companion_events_userId_kind_occurredAt_id_idx" ON "companion_events"("userId", "kind", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "companion_events_userId_deviceId_occurredAt_idx" ON "companion_events"("userId", "deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "companion_events_userId_attemptId_idx" ON "companion_events"("userId", "attemptId");

-- CreateIndex
CREATE INDEX "companion_events_userId_batchId_idx" ON "companion_events"("userId", "batchId");

-- CreateIndex
CREATE INDEX "companion_events_receivedAt_idx" ON "companion_events"("receivedAt");

-- CreateIndex
CREATE INDEX "companion_events_uploadId_idx" ON "companion_events"("uploadId");

-- CreateIndex
CREATE INDEX "companion_uploads_userId_receivedAt_id_idx" ON "companion_uploads"("userId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "companion_uploads_userId_deviceId_receivedAt_idx" ON "companion_uploads"("userId", "deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "companion_uploads_receivedAt_idx" ON "companion_uploads"("receivedAt");

-- AddForeignKey
ALTER TABLE "companion_events" ADD CONSTRAINT "companion_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_events" ADD CONSTRAINT "companion_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_events" ADD CONSTRAINT "companion_events_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "companion_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_uploads" ADD CONSTRAINT "companion_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_uploads" ADD CONSTRAINT "companion_uploads_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

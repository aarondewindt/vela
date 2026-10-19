-- CreateEnum
CREATE TYPE "HealthMetricKind" AS ENUM ('WEIGHT', 'BODY_FAT', 'LEAN_MASS', 'SLEEP', 'TOTAL_CALORIES');

-- CreateTable
CREATE TABLE "home_assistant_connections" (
    "userId" TEXT NOT NULL,
    "baseUrl" VARCHAR(500) NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(240) NOT NULL DEFAULT 'Waiting for worker',
    "lastSyncedAt" TIMESTAMP(3),
    "leaseId" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_assistant_connections_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "health_entity_mappings" (
    "userId" TEXT NOT NULL,
    "metric" "HealthMetricKind" NOT NULL,
    "entityId" VARCHAR(240) NOT NULL,

    CONSTRAINT "health_entity_mappings_pkey" PRIMARY KEY ("userId","metric")
);

-- CreateTable
CREATE TABLE "health_metrics" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" "HealthMetricKind" NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "date" DATE NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(32) NOT NULL,
    "entityId" VARCHAR(240),
    "sourceKey" VARCHAR(500) NOT NULL,
    "timestampBasis" VARCHAR(32) NOT NULL,

    CONSTRAINT "health_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_goals" (
    "userId" TEXT NOT NULL,
    "calorieBalance" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_goals_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "health_entity_mappings_userId_entityId_key" ON "health_entity_mappings"("userId", "entityId");

-- CreateIndex
CREATE INDEX "health_metrics_userId_date_metric_observedAt_idx" ON "health_metrics"("userId", "date", "metric", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "health_metrics_userId_sourceKey_key" ON "health_metrics"("userId", "sourceKey");

-- AddForeignKey
ALTER TABLE "home_assistant_connections" ADD CONSTRAINT "home_assistant_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_entity_mappings" ADD CONSTRAINT "health_entity_mappings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "home_assistant_connections"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_goals" ADD CONSTRAINT "health_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE health_goals ADD CONSTRAINT health_goal_balance_range CHECK ("calorieBalance" BETWEEN -10000 AND 10000);
ALTER TABLE health_metrics ADD CONSTRAINT health_metric_value_range CHECK (
  value >= 0 AND value <= CASE metric
    WHEN 'BODY_FAT' THEN 100 WHEN 'SLEEP' THEN 24
    WHEN 'WEIGHT' THEN 1000 WHEN 'LEAN_MASS' THEN 1000 ELSE 100000 END
  AND (metric NOT IN ('WEIGHT', 'LEAN_MASS') OR value > 0)
);

-- CreateTable
CREATE TABLE "device_credentials" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "clientType" VARCHAR(40) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_pairings" (
    "id" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "secretHash" CHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "clientType" VARCHAR(40) NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_rate_limits" (
    "key" TEXT NOT NULL,
    "window" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "device_rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_credentials_tokenHash_key" ON "device_credentials"("tokenHash");

-- CreateIndex
CREATE INDEX "device_credentials_userId_createdAt_idx" ON "device_credentials"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairings_codeHash_key" ON "device_pairings"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairings_secretHash_key" ON "device_pairings"("secretHash");

-- AddForeignKey
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


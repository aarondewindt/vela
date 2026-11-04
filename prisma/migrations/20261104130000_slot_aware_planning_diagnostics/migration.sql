-- Additive #69 diagnostics only. The #70 destructive availability cutover remains separate.
CREATE TABLE "planner_generation_attempts" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  "planDate" DATE NOT NULL,
  "stage" VARCHAR(32) NOT NULL,
  "errorCode" VARCHAR(64) NOT NULL,
  "provider" VARCHAR(64),
  "modelId" VARCHAR(200),
  "failureClass" VARCHAR(100) NOT NULL,
  "detail" VARCHAR(500) NOT NULL,
  "validationPaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planner_generation_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "planner_generation_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "planner_generation_attempts_userId_createdAt_idx" ON "planner_generation_attempts"("userId", "createdAt");
CREATE INDEX "planner_generation_attempts_userId_requestId_idx" ON "planner_generation_attempts"("userId", "requestId");

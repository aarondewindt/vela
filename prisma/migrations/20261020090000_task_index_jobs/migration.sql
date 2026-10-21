CREATE TABLE "task_index_jobs" (
  "userId" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "completedRevision" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseId" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" VARCHAR(500),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "task_index_jobs_runAfter_idx" ON "task_index_jobs"("runAfter");

-- Cover every task writer, including review acceptance and planner estimate updates.
-- No model work happens inside a task transaction. Preserve active worker leases.
CREATE FUNCTION enqueue_task_index_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO task_index_jobs ("userId") VALUES (NEW."userId")
  ON CONFLICT ("userId") DO UPDATE SET revision = task_index_jobs.revision + 1,
    attempts = 0, "runAfter" = CURRENT_TIMESTAMP, "lastError" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_index_refresh AFTER INSERT OR UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION enqueue_task_index_refresh();

-- Existing owners need one initial pass; deletion already cascades to task_embeddings.
INSERT INTO task_index_jobs ("userId") SELECT DISTINCT "userId" FROM tasks;

-- NULL retains the existing task-creation-date anchor; existing occurrences are unchanged.
ALTER TABLE "tasks" ADD COLUMN "recurrenceAnchorDate" DATE;

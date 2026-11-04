-- Expand-only foundation for versioned Planner availability. Legacy availability
-- tables and all active readers remain in place until the destructive cutover.
CREATE TYPE "SlotCategoryPolicyMode" AS ENUM ('ALL', 'ALLOW_ONLY', 'EXCLUDE');

CREATE TABLE "availability_templates" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "availability_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "availability_templates_userId_archivedAt_idx" ON "availability_templates"("userId", "archivedAt");

CREATE TABLE "availability_template_slots" (
  "id" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "availability_template_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_template_slots_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "availability_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "availability_template_slots_templateId_idx" ON "availability_template_slots"("templateId");

CREATE TABLE "availability_template_revisions" (
  "id" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "availability_template_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_template_revisions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "availability_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "availability_template_revisions_templateId_effectiveDate_key" ON "availability_template_revisions"("templateId", "effectiveDate");
CREATE INDEX "availability_template_revisions_templateId_effectiveDate_idx" ON "availability_template_revisions"("templateId", "effectiveDate");

CREATE TABLE "availability_template_revision_slots" (
  "id" UUID NOT NULL,
  "revisionId" UUID NOT NULL,
  "logicalSlotId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "name" VARCHAR(120),
  "guidance" VARCHAR(1000),
  "policyMode" "SlotCategoryPolicyMode" NOT NULL DEFAULT 'ALL',
  "policyCategories" "PlanningCategory"[] NOT NULL DEFAULT ARRAY[]::"PlanningCategory"[],
  CONSTRAINT "availability_template_revision_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_template_revision_slots_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "availability_template_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "availability_template_revision_slots_logicalSlotId_fkey" FOREIGN KEY ("logicalSlotId") REFERENCES "availability_template_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "availability_template_revision_slots_position_check" CHECK ("position" >= 0),
  CONSTRAINT "availability_template_revision_slots_minutes_check" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440),
  CONSTRAINT "availability_template_revision_slots_policy_check" CHECK ("policyMode" <> 'ALL' OR cardinality("policyCategories") = 0)
);
CREATE UNIQUE INDEX "availability_template_revision_slots_revisionId_position_key" ON "availability_template_revision_slots"("revisionId", "position");
CREATE UNIQUE INDEX "availability_template_revision_slots_revisionId_logicalSlotId_key" ON "availability_template_revision_slots"("revisionId", "logicalSlotId");
CREATE INDEX "availability_template_revision_slots_logicalSlotId_idx" ON "availability_template_revision_slots"("logicalSlotId");

CREATE TABLE "weekly_availability_assignments" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "templateId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weekly_availability_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "weekly_availability_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "weekly_availability_assignments_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "availability_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "weekly_availability_assignments_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6)
);
CREATE UNIQUE INDEX "weekly_availability_assignments_userId_weekday_effectiveDate_key" ON "weekly_availability_assignments"("userId", "weekday", "effectiveDate");
CREATE INDEX "weekly_availability_assignments_userId_weekday_effectiveDate_idx" ON "weekly_availability_assignments"("userId", "weekday", "effectiveDate");
CREATE INDEX "weekly_availability_assignments_templateId_idx" ON "weekly_availability_assignments"("templateId");

CREATE TABLE "date_availability_overrides" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "source" VARCHAR(64) NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "date_availability_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "date_availability_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "date_availability_overrides_userId_date_key" ON "date_availability_overrides"("userId", "date");
CREATE INDEX "date_availability_overrides_userId_date_idx" ON "date_availability_overrides"("userId", "date");

CREATE TABLE "date_availability_slots" (
  "id" UUID NOT NULL,
  "overrideId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "name" VARCHAR(120),
  "guidance" VARCHAR(1000),
  "policyMode" "SlotCategoryPolicyMode" NOT NULL DEFAULT 'ALL',
  "policyCategories" "PlanningCategory"[] NOT NULL DEFAULT ARRAY[]::"PlanningCategory"[],
  "sourceTemplateId" UUID,
  "sourceTemplateRevisionId" UUID,
  "sourceLogicalSlotId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "date_availability_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "date_availability_slots_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "date_availability_overrides"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "date_availability_slots_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "availability_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "date_availability_slots_sourceTemplateRevisionId_fkey" FOREIGN KEY ("sourceTemplateRevisionId") REFERENCES "availability_template_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "date_availability_slots_sourceLogicalSlotId_fkey" FOREIGN KEY ("sourceLogicalSlotId") REFERENCES "availability_template_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "date_availability_slots_position_check" CHECK ("position" >= 0),
  CONSTRAINT "date_availability_slots_minutes_check" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440),
  CONSTRAINT "date_availability_slots_policy_check" CHECK ("policyMode" <> 'ALL' OR cardinality("policyCategories") = 0)
);
CREATE UNIQUE INDEX "date_availability_slots_overrideId_position_key" ON "date_availability_slots"("overrideId", "position");
CREATE INDEX "date_availability_slots_overrideId_idx" ON "date_availability_slots"("overrideId");
CREATE INDEX "date_availability_slots_sourceTemplateId_idx" ON "date_availability_slots"("sourceTemplateId");
CREATE INDEX "date_availability_slots_sourceTemplateRevisionId_idx" ON "date_availability_slots"("sourceTemplateRevisionId");
CREATE INDEX "date_availability_slots_sourceLogicalSlotId_idx" ON "date_availability_slots"("sourceLogicalSlotId");

CREATE TABLE "planner_timezone_periods" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planner_timezone_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "planner_timezone_periods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "planner_timezone_periods_userId_effectiveDate_key" ON "planner_timezone_periods"("userId", "effectiveDate");
CREATE INDEX "planner_timezone_periods_userId_effectiveDate_idx" ON "planner_timezone_periods"("userId", "effectiveDate");

ALTER TABLE "daily_plans"
  ADD COLUMN "availabilitySnapshot" JSONB,
  ADD COLUMN "availabilityHash" CHAR(64);
ALTER TABLE "planner_draft_revisions"
  ADD COLUMN "generationAvailabilitySnapshot" JSONB,
  ADD COLUMN "generationAvailabilityHash" CHAR(64);

-- Revision rows and their values are append-only. Cascading owner deletion remains
-- possible because deletes are intentionally not blocked.
CREATE FUNCTION "prevent_availability_revision_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'availability template revisions are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "availability_template_revisions_immutable"
  BEFORE UPDATE ON "availability_template_revisions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_availability_revision_update"();
CREATE TRIGGER "availability_template_revision_slots_immutable"
  BEFORE UPDATE ON "availability_template_revision_slots"
  FOR EACH ROW EXECUTE FUNCTION "prevent_availability_revision_update"();

-- A revision value may only refer to a logical slot owned by the same template.
CREATE FUNCTION "check_availability_logical_slot_owner"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "availability_template_revisions" revision
    JOIN "availability_template_slots" slot ON slot."templateId" = revision."templateId"
    WHERE revision."id" = NEW."revisionId" AND slot."id" = NEW."logicalSlotId"
  ) THEN
    RAISE EXCEPTION 'logical availability slot belongs to another template';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "availability_revision_slot_owner"
  BEFORE INSERT ON "availability_template_revision_slots"
  FOR EACH ROW EXECUTE FUNCTION "check_availability_logical_slot_owner"();

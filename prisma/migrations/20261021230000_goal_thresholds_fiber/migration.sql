ALTER TABLE "nutrition_goals" ADD COLUMN "fiber" DECIMAL(20,8);

-- Preserve amounts; protein is a minimum, with optional higher milestones configured by the owner.
-- Keep explicitly configured ranges, maxima, and tolerance bands intact.
UPDATE "nutrition_goals"
SET "semantics" = jsonb_set("semantics", '{protein}', '{"kind":"minimum"}'::jsonb),
    "version" = "version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE NOT ("semantics" ? 'protein')
   OR "semantics"->'protein' = '{"kind":"target"}'::jsonb
   OR "semantics"->'protein' = '{"kind":"target","tolerance":"0"}'::jsonb;

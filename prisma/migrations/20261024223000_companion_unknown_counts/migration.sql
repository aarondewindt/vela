-- A rejected/unparsed request has an unknown count, not zero measurements.
ALTER TABLE "companion_events" ALTER COLUMN "count" DROP NOT NULL;
ALTER TABLE "companion_events" ALTER COLUMN "count" DROP DEFAULT;

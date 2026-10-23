-- Keep retrieved provenance separate from the user's editable fields.
ALTER TABLE "discover_items" ADD COLUMN "sourceMetadata" JSONB;

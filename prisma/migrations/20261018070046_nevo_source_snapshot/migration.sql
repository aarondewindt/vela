-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sourceSnapshot" JSONB;

ALTER TABLE "products" ADD CONSTRAINT "products_source_snapshot_object"
CHECK ("sourceSnapshot" IS NULL OR jsonb_typeof("sourceSnapshot") = 'object');

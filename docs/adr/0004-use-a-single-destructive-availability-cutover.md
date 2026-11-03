# Use a single destructive availability cutover

Vela replaces legacy availability windows, work-mode availability fields, category reservations and obsolete scheduler paths in one migration and code cutover instead of maintaining dual readers. The current database is test-only, has no open Planner drafts and may lose reservation history and unavailable pre-redesign plan context; accepted blocks and non-availability day context remain intact.

The migration converts current weekly windows and date overrides into the versioned model, verifies the result and then removes superseded schema. A backup precedes the migration. New availability tables join the existing consistent planner transaction lock order; redesigning concurrency around owner-scoped advisory locks remains separate work.

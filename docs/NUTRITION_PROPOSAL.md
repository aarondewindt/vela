# Nutrition architecture proposal

Status: Phases 1 and 2 approved and delivered on 2026-10-18. Implementation and validation are recorded in [Nutrition](NUTRITION.md).
Prepared: 2026-10-18.

This proposal adapts the supplied Nutrition specification to the inspected repository. The initial approval covered Phase 1, and the user subsequently explicitly authorized Phase 2. Later major phases retain the specification's review checkpoints.

## 1. Existing infrastructure to reuse

| Area | Inspected implementation and implication |
| --- | --- |
| Feature registration | App Router pages live under `app/`; navigation is the static `navbar_map` in `components/NavbarNested/NavbarNested.tsx`. Register a Nutrition group there and a protected feature router in `lib/trpc/root.ts`. There is no app/plugin registry to extend. |
| Authentication | Better Auth supplies sessions. `lib/trpc/server.ts` exposes `protectedProcedure` with `ctx.userId`. Use the explicit server-side session check from `app/ai-dev/page.tsx` and pass the authenticated owner into every service. |
| State and services | `lib/planner/` and `lib/settings/` demonstrate feature services behind thin Zod-validated tRPC procedures. TanStack Query owns persistent data; local React state or existing Zustand conventions own filters, selection and open editors. |
| Persistence | Prisma 7 uses `prisma-client`, `generated/prisma/`, `PrismaPg`, `prisma.config.ts` and PostgreSQL. Domain records use UUIDs, string user IDs, mapped table names and timestamps. `Task.archivedAt`, JSONB snapshots/configuration and `@db.Date` fields provide relevant precedents. No food tables currently exist. |
| UI | Mantine 9, shared `theme.ts`, CSS modules, dark mode, responsive AppShell, modal forms and `mantine-datatable` are established. `@mantine/charts` and Recharts are installed, with chart styles already loaded; no application chart implementation was found to reuse. Follow `docs/COLOR_PALETTE.md`. |
| AI | `lib/ai/` supplies lazy Ollama configuration, capability discovery, explicit model resolution, safe errors and timeouts. `lib/ai-dev/service.ts` consumes AI SDK streaming chat. There is no shared structured-output generation helper yet. |
| Embeddings | `lib/embeddings/` supplies collection adapters, batching, digest/dimension checks, indexing leases and atomic rebuild publication. `lib/task-search/` is the concrete reference: dedicated vector table, source hashes, owner filtering and exact cosine search. Current task indexing is manual. |
| Tests | Colocated Jest tests use mocked Prisma/services and tRPC callers; UI tests use Testing Library and `test-utils/`. Existing database verification is documented separately in `docs/AI.md`. |

Use current code and `docs/architecture.md` / `docs/FRONTEND_API.md` for implementation locations. The older `docs/PROJECT_PLAN.md` contains aspirational REST endpoints and separate recipe tables; these are not current implementation requirements. Nutrition will use tRPC and the specified unified Product model.

## 2. Proposed Prisma schema

Add models incrementally in their delivery phase. The following describes the proposed fields and constraints; it is not an applied Prisma schema.

### Phase 1: product catalog

| Model | Proposed fields |
| --- | --- |
| `Product` → `products` | UUID `id`, `userId`, `name`, optional `brand` / `description`, `aliases String[]`, normalized search fields, `calculationMode`, `referenceQuantity`, `referenceUnit`, optional `referenceLabel`, `calories`, `protein`, `carbohydrates`, `fat`, nullable `fiber`, optional physical serving size and density, optional explicit recipe yield, provenance fields below, `verificationStatus`, `userModifiedAt`, `archivedAt`, timestamps. |
| `ProductServing` → `product_servings` | UUID `id`, `productId`, `name`, aliases, positive `quantity`, `canonicalUnit`, `isDefault`, `isEstimated`, timestamps. One named unit maps directly to a canonical quantity, e.g. one slice = 35 g. |
| `ProductComponent` → `product_components` | UUID `id`, `parentProductId`, `childProductId`, positive `quantity`, either a standard unit or child `servingId`, `sortOrder`, timestamps. Separate named relations connect parent and child to `Product`. |

Enums:

- `ProductCalculationMode`: `DIRECT`, `CALCULATED`.
- `NutritionReferenceUnit`: `G`, `ML`, `SERVING`.
- Standard entered units: `G`, `KG`, `ML`, `L`; household/custom units use a product serving ID.
- `ProductSourceType`: `MANUAL`, `DATASET`, `AI_ESTIMATE`, `EXTERNAL_API`.
- `ProductVerificationStatus`: `UNVERIFIED`, `VERIFIED`, `ESTIMATED`.

The reference quantity is explicit: 100 g, 100 ml or one named serving are common defaults. A `SERVING` reference requires a label such as “bar” or “bowl”; it needs no invented physical size. An optional `servingSizeQuantity` + `servingSizeUnit` (`G` or `ML`) enables physical conversions when known. Optional `densityGramsPerMl` enables weight/volume conversion. A serving definition can map to `G`, `ML` or a multiple of the product's named `SERVING` basis; definitions cannot reference other serving definitions.

Reserve nullable `yieldQuantity` + `yieldUnit` for calculated products. Yield is the complete prepared recipe output in an explicit unit, independent of the nutrition reference. For example, four portions of output can be normalized to nutrition per one portion; weight-based consumption additionally requires explicitly entered prepared yield/portion weight. Ingredient weight never supplies cooked yield automatically.

Keep provenance inline initially: `sourceType`, nullable `sourceName`, string `sourceRecordId`, `sourceVersion` and `importedAt`. Add uniqueness on `[userId, sourceType, sourceName, sourceRecordId]` for identified external records; source version is metadata, not part of identity. Require source name/record ID together for external identities. Manual records have no external identity. `userModifiedAt` records user overrides independently of source provenance and verification; there is no importer or overwrite policy yet. Product names are not unique, since brands and variants may share names.

Use `Decimal @db.Decimal(20, 8)` for nutrients, quantities, conversion factors and yields. Validate finite decimal strings and storage bounds at API boundaries; positive quantities/conversions and nonnegative nutrients also receive database CHECK constraints. Unknown fiber remains null. Direct products require all four core nutrients; calculated products may leave direct values null. Phase 1 accepts only `DIRECT` creation/editing; component mutation and calculated mode remain unavailable until Phase 5.

Index active products by owner, and components by parent/child. Enforce at most one default serving per product with a partial unique index. Validate parent, child and serving ownership and serving/product correspondence transactionally. Restrict component reference deletion. Archive products through normal UI actions; block archival of a child used by an active calculated parent until the dependency is resolved. Serving removal must also respect component references. Ordinary catalog operations do not hard-delete products.

### Later phases

| Phase / model | Proposed fields and constraints |
| --- | --- |
| 2: `NutritionLogEntry` | UUID, `userId`, `logDate DateTime @db.Date`, meal category, nullable product FK (`SetNull` on physical deletion), product name snapshot, original decimal quantity/unit/serving label, resolved reference quantity, five nutrient total snapshots, versioned reference/conversion snapshot JSONB, timestamps. Index `[userId, logDate, mealCategory]`. No product deletion cascades into logs. |
| 2: `NutritionGoals` | `userId` as primary key / user FK, nullable positive decimal calorie/protein/carbohydrate/fat goals, timestamps. Unset means no target. One current set per user; date-effective goal history is deferred. |
| 3: `ProductEmbedding` | Product UUID primary/FK, `Unsupported("vector")`, source hash, source update timestamp and indexing timestamp, matching `TaskEmbedding`. Cascade physical product deletion into vectors. Collection configuration remains in existing `EmbeddingCollectionConfig`. |
| 4: `NutritionMealDraft` | UUID, `userId`, target `@db.Date`, meal category, `OPEN` / `CONFIRMED` / `DISCARDED` status, integer revision, selected provider/model, timestamps and confirmation timestamp. |
| 4: `NutritionMealDraftItem` | Stable UUID, draft FK, optional matched product/serving, original product query and quantity/unit, candidate/unresolved/estimated state, resolved preview snapshot, ordering and timestamps. Nullable quantity preserves phrases such as “some broccoli” for review. |
| 4: `NutritionDraftTurn` | Draft FK, stable request ID, expected draft revision, user instruction, validated operations, safe generation status/lease and timestamps. Unique `[draftId, requestId]` makes conversational retries durable without reusing AI Dev's text-only chat schema. |

Meal categories are `BREAKFAST`, `LUNCH`, `DINNER`, `SNACKS`. Draft confirmation associates logs with their draft item through nullable identifiers and a unique `[draftId, draftItemId]` constraint. Confirmed-draft status and created logs commit together; a repeated confirmation returns the existing result.

All root records belong to a user; servings/components/items/turns inherit ownership through their validated parent. Foreign and missing IDs produce the same not-found behavior. Neither client input nor model output supplies authoritative owner IDs.

## 3. Deterministic services and calculations

Add `lib/nutrition/router.ts` and colocated `schema.ts`, then small modules as each phase needs them:

| Module | Responsibility |
| --- | --- |
| `products.ts` | Product/serving CRUD, archival, provenance, owner validation and transactions. |
| `search.ts` | Reusable catalog search for product management, logging and AI matching. |
| `calculations.ts` | Pure decimal calculations, canonical conversion, reference scaling and totals; recursive calculation is added in Phase 5. |
| `diary.ts`, `goals.ts` | Date-scoped logs, snapshot creation and quantity edits, daily totals, goals and later meal copying. |
| `drafts.ts` | Persistent draft operations, revision checks, deterministic resolution and idempotent transactional confirmation. |
| `interpretation.ts` | Nutrition prompts and typed operations over shared AI resolution/generation. No provider construction or direct log mutation. |
| `embedding-adapter.ts`, `embedding-text.ts` | Product-specific source text, vector persistence and owner-scoped retrieval over the existing collection engine. |

Use Prisma's existing Decimal runtime on the server without adding a decimal dependency. Send decimal strings across tRPC rather than relying on automatic serialization of Decimal instances. The client sends string quantities; Mantine previews call a debounced protected calculation query backed by the same utility, and saves always recompute on the server. Do not duplicate arithmetic in React. Use an isolated decimal context with adequate intermediate precision; persist at eight decimal places with explicit half-up rounding. Display calories/macros at suitable lower precision, while daily totals sum stored snapshots before display rounding.

The conversion path is: entered quantity → selected product serving or standard metric unit → compatible canonical quantity → explicit serving size/density if needed → nutrition reference scaling. Reject missing conversions and zero denominators. For peanut butter, `588 × 30 / 100 = 176.4 kcal`. Do not derive calories from macros or presume that 1 ml weighs 1 g. A total with unknown fiber is marked incomplete rather than presenting missing fiber as zero.

Each log's versioned, Zod-validated JSON snapshot stores decimal strings for the nutrition reference, per-reference nutrients, captured serving/conversion definitions, estimation flags and calculation version. Later composite logs also capture the contributing composition. Scalar nutrient snapshots support efficient historical aggregation. Editing quantity or switching to a captured compatible unit uses this snapshot exclusively; an uncaptured conversion requires an explicit new source selection, never a silent refresh. Copying a historical meal preserves its snapshots. Draft previews may be refreshed from current products, but changed nutrition/conversions require a new review before confirmation.

Daily dates cross the API as validated `YYYY-MM-DD` strings and are stored as PostgreSQL dates, following planner date conventions. Use the user's saved timezone to determine “today” and relative dates, with no timezone conversion of an already selected diary date.

In Phase 5, calculated products sum component contributions and normalize by explicit output yield. Detect cycles along the current ancestor path, bound depth and total nodes, and evaluate each component row once. The same ingredient appearing in separate branches still contributes in each branch. Direct mode always uses entered nutrients even when components exist. Serialize component mutations sufficiently to prevent concurrent edits from creating a cycle.

## 4. UI and navigation

Add a Nutrition navigation group using the existing nested-link convention. Expose links only when their pages are functional:

| Route | Components / behavior | Phase |
| --- | --- | --- |
| `/nutrition/products` | `ProductsView`, `ProductEditor`, `ServingEditor`: searchable owner catalog, inline search, create/edit/archive, reference and nutrient inputs, aliases, servings and provenance/verification. Use a modal editor; table on desktop and compact rows/cards on narrow screens. | 1 |
| `/nutrition` | `NutritionDiaryView`, `DailyNutritionSummary`, `MealSection`, `LogEntryEditor`, shared `ProductPicker`: date navigation, four meal sections, totals, quick manual logging and snapshot-based quantity edits. | 2 |
| `/nutrition/settings` | `NutritionGoalsView`: user-entered daily targets and unset states. | 2 |
| Within diary | `MealDraftEditor` and natural-language input: persistent review, candidates, quantities, corrections, confirm/discard. Model selector uses shared discovery. | 4 |
| Product editor | Component/yield controls for calculated products. | 5 |
| `/nutrition/history` | `NutritionHistoryView`: 7/30-day calorie and macro charts using Mantine Charts. | 6 |

Every phase includes useful loading, empty, validation and error states plus keyboard/mobile access. Manual add remains prominent when natural-language input arrives. Query invalidation refreshes authoritative data after mutations; draft content is persistent server state, not a Zustand cache. Use the current theme and semantic palette roles.

## 5. Search and AI integration

**Conventional search first.** Store normalized names/aliases and apply the same Unicode/whitespace/case normalization to queries. Rank exact name, exact alias, other text matches, then semantic-only matches. Deduplicate by product ID and use stable tie ordering. Brand/description contribute to text search. Return plausible alternatives; similarity is a raw retrieval score, not a confidence probability.

**One separate product collection.** Add `nutrition.products.semantic` / `product_embeddings`, with name, description, brand and sorted aliases in versioned embedding text. Reuse `createEmbeddingCollection`, digest checks, exact cosine search and atomic model replacement. Product searches always filter owner and archival state. Retain the existing maintainer allowlist for shared configuration/rebuilds; extract its small check into a shared helper when needed. Do not reuse the task-specific rebuild schema's default query instruction.

**Index lifecycle requires a small extension.** The current engine can synchronize an owner's collection, but it has no automatic durable scheduler. In Phase 3, mark relevant edits with a dedicated search-source timestamp, and transactionally enqueue a coalesced owner refresh in a small database-backed indexing job record. Process bounded jobs through an explicit server command/worker, with retry state and a manual retry/status action. Reuse the collection engine for inference/publication; it remains the only indexing implementation. Product writes commit independently of inference, and hybrid search returns text matches with a safe degradation indicator when indexing/search is unavailable. Archive filters take effect immediately; cleanup removes archived vectors. Do not depend on an unawaited promise surviving a request. Before Phase 3, review worker hosting and the existing in-memory full-rebuild size limit.

**Structured generation is the other missing shared capability.** In Phase 4, add a minimal server-only helper in `lib/ai/` that accepts a Zod schema, explicit model selection, context and cancellation; resolves via `resolveChatModel`; and uses the installed AI SDK's schema-validated output facility. Bound input/output, timeout and retries. Verify structured-output behavior against the selected installed Ollama model. Missing support or invalid output produces a safe error and preserves the draft. Nutrition-specific prompts and operation schemas stay in `lib/nutrition/`.

The model proposes `addItem`, `removeItem`, `setQuantity`, `changeProduct`, `changeMealCategory` and `changeDate` operations. The application validates stable item IDs, expected draft revision, product matches, quantities and ownership, then applies the whole operation batch atomically. Ambiguous references and missing quantities remain unresolved. Product creation remains manual; the model cannot invent nutrition or exact serving conversions. Date interpretation receives authoritative date/timezone context, and ambiguous phrases require review.

Model calls occur outside database transactions. Use short generation leases/revision checks so late replies cannot overwrite manual edits or newer turns. Confirmation validates the current draft and product revisions, computes snapshots, inserts logs and marks confirmed in one transaction. Changed source data returns an updated preview for review; concurrent/repeated confirmation cannot insert duplicates. Manual logging and catalog management never require the model or embeddings.

## 6. Delivery and validation

| Phase | Functional deliverable | Focused evidence |
| --- | --- | --- |
| 0, this proposal | Inspected architecture, schema/service/UI design and approval choices. | Documentation links and diff checks; repository typecheck/lint baseline. |
| 1 | Direct product database, servings, metric/serving/density calculations, conventional search; component schema reserved. | Decimal/fractional/conversion tests; product/serving validation, exact/alias ranking, archival and cross-owner tests; schema/migration and UI checks. |
| 2 | Complete manual diary, date navigation, goals and totals. | Historical immutability after product/serving edits, snapshot quantity edits, archived products, date/timezone boundaries and authorization. |
| 3 | Hybrid semantic product search and reliable indexing lifecycle. | Collection compatibility, relevant versus metadata edits, retries/fallbacks, owner/archive filtering, model switch rollback and retrieval fixtures. |
| 4 | Persistent conversational meal drafts and confirmed logging. | Mocked structured output, corrections, unresolved matches, malformed output, revision/lease conflicts and concurrent confirmation deduplication. |
| 5 | Recursive product editor and calculated nutrition. | Direct/indirect/concurrent cycles, nested/repeated ingredients, recursion limits, yields and composite log snapshots. |
| 6 | 7/30-day charts, recent/frequent foods, copy meals and usability refinements. | Snapshot-preserving copy, aggregation/date ranges, missing versus zero-intake days, mobile and performance checks. |

For each implementation phase, run focused Jest tests first, then TypeScript and lint/format checks; validate schema/migrations for database changes. Use live PostgreSQL checks for constraints, transactions and concurrency that mocked tests cannot establish. Run production build/browser checks when UI/server changes warrant them. Report existing unrelated failures separately and obtain approval before the next major phase.

No dataset import, barcode/image capture, AI nutrition estimates, inventory, groceries, exercise, weight, Health Connect, Home Assistant, social features or automatic target prescription is included.

## 7. Decisions requested for approval

1. **Catalog and units:** one user-owned Product model, direct products first, component schema now/editor later, explicit `G`/`ML`/named-serving basis, product-specific conversions and archival with dependency checks.
2. **Numeric and historical contract:** decimal-string API with PostgreSQL/Prisma decimals, server-calculated previews and immutable versioned log reference/conversion snapshots. Goals initially have one current set per user.
3. **AI delivery:** separate product embedding collection using existing maintainer controls; a small durable indexing worker in Phase 3; a reusable structured-output helper and Nutrition-owned drafts in Phase 4. Review deployment/model choices at those phase boundaries.

Approving this proposal authorizes Phase 1: schema/migration, deterministic calculations, owner-scoped product/serving services, conventional search, protected tRPC endpoints, product UI/navigation and focused validation. It does not authorize proceeding through all later phases without their checkpoints.

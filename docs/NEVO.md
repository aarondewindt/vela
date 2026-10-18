# NEVO upload and updates

Open **Nutrition → Food products → Upload NEVO dataset**. Choose the original UTF-8, pipe-delimited CSV, click **Preview NEVO import**, review the counts/names, then click **Import NEVO foods**. The file is uploaded through authenticated Nutrition tRPC procedures; importing does not call an AI provider. No CSV is bundled into the app or imported automatically into an existing account.

The supplied `docs/datasets/NEVO2025_v9.0.csv` was validated: 2,328 unique foods, including 53 referenced per 100 ml and seven with unknown fiber. The user's `docs/.gitignore` excludes the dataset directory; keep the original file local.

## Mapping and validation

| CSV column | Product field |
| --- | --- |
| `Engelse naam/Food name` | Primary English `name` |
| `Voedingsmiddelnaam/Dutch food name` | Full Dutch alias |
| `Synoniem` | Additional alias when present, retained as supplied |
| `NEVO-code` | Stable per-owner NEVO source record ID |
| `NEVO-versie/NEVO-version` | Source version |
| `Hoeveelheid/Quantity` | 100 g or 100 ml reference, preserved explicitly |
| `ENERCC (kcal)` | Calories |
| `PROT (g)`, `CHO (g)`, `FAT (g)` | Protein, carbohydrates, fat |
| `FIBT (g)` | Fiber; blank means unknown, never zero |
| Food group, notes, traces, fortification | Descriptive context with original text |

Food aliases now support 240 characters so the six Dutch names over the earlier 80-character limit remain complete. Household serving aliases keep their existing 80-character limit. Dutch decimal commas become decimal strings for calculation; no numerical precision or units are guessed. All original row columns, including unused nutrients and original decimal formatting, are retained in `Product.sourceSnapshot`. Manual editing cannot change that source record.

Files are limited to 5 MB and 10,000 rows. Headers can be reordered; quoted fields, escaped quotes, BOM, CRLF/LF and embedded newlines are supported. A file must have one NEVO release, unique positive codes, both names, supported reference units and valid required nutrients. Missing required macros, unsupported numbers, duplicate codes/headers, malformed CSV and invalid encoding reject the entire file before persistence. Errors identify logical row numbers; no partially valid subset is silently imported.

## Update policy

- Imported NEVO foods are verified on creation and update. Re-uploading the same data also verifies previously unverified or estimated, unedited NEVO foods through the normal preview/update flow.
- Identity is `(userId, DATASET, NEVO, NEVO-code)`, independent of names, filenames or release labels. Uploading the same data again for already verified foods leaves product IDs, versions, import timestamps and index jobs unchanged.
- Unedited source records are updated in place, including the original-source snapshot and source version. Later releases can also add codes. Changes to previously unused source columns are retained even when tracked macros stay the same.
- Manually edited NEVO products are protected by default, including their verification status. **Update imported fields of manually edited NEVO foods** explicitly permits replacing names/aliases, descriptions, reference units and nutrition from the upload and marking the imported food verified. Brands, household servings, density and archive choices are kept; the manual-edit marker remains conservative.
- Incompatible existing serving conversions or serving-based/custom calculated references are skipped for manual resolution, including when replacement is selected. Updates never invent missing conversions.
- Archived records remain archived. Previously imported codes absent from the upload are kept; there is no implicit deletion/archive sweep. Manual products, other datasets and other owners are outside the import scope.
- Preview is read-only. Its hash covers the file, selected policy, owner and existing product revisions. Applying revalidates under a per-owner advisory lock plus product row locks. A stale preview or competing import returns a conflict requiring a new preview. New rows, updates and the coalesced search refresh commit in one transaction; a failure rolls everything back.
- Diary snapshots remain immutable. Product revisions ensure an open meal draft must review changed food definitions before confirmation.

Only changed descriptive text invalidates existing embeddings; nutrient/version-only updates retain current vectors. New or changed active food text queues the existing worker once per import, independently of inference availability. To fit the supplied dataset, product collection bounds are now 10,000 documents and 12,000,000 staged vector values per operation (approximately 96 MB of raw double values, plus overhead). Existing batching/digest/lease/atomic-publication logic is unchanged. Very large catalogs/models still require a smaller model or a separately scoped streaming/staging design; conventional search remains available.

## Source attribution

The [official RIVM conditions for NEVO 2025/9.0](https://www.rivm.nl/sites/default/files/2025-11/Conditions-of-use-NEVO-online-2025-dataset.pdf) require source/version attribution and distinguish additions from original data. Vela preserves the imported original rows separately from editable user products. NEVO source identity/version and the manual-edit marker remain attached to those products; calculation displays cite the relevant stored release and RIVM, including historical diary/draft snapshots. The original supplied CSV is untouched and is not redistributed with the application.

## Implementation and validation

`lib/nutrition/nevo-csv.ts` parses/validates files, `nevo.ts` plans and transactionally applies updates, and `nevo-schema.ts` owns API limits. Protected `previewNevoImport` / `applyNevoImport` procedures remain thin. `NevoImporter` provides upload/preview/explicit import, and `NevoAttribution` renders source/version references. TanStack Query invalidates authoritative catalog/draft/index state after import; file selection and the reviewed upload are temporary UI state.

Migration `20261018070046_nevo_source_snapshot` adds the nullable JSONB original-source column and object constraint; it is applied locally and Prisma Client regenerated. Other environments use the normal migration workflow.

On 2026-10-18, all 330 Jest tests (48 suites), TypeScript, scoped Oxlint/format, repository Stylelint, Prisma validation/empty schema diff and production build passed. Repository-wide lint retains the previously documented errors in untouched auth/planner/UI files.

Thirty-four live PostgreSQL checks used temporary accounts and the supplied full file: full creation/update, English/Dutch mapping, native units, unknown fiber, source originals, exact Dutch alias search, repeat-upload idempotence, manual-edit protection/explicit replacement, preserved custom conversions/brand/archive, missing-code retention, owner isolation, stale/concurrent imports, forced transaction rollback and unchanged historical calculations. The final full import took about 1.2 seconds and a newer-release update about 4.8 seconds in this development environment; these are observations, not deployment guarantees.

Browser checks uploaded the actual file through the real transport, verified preview/import, Dutch search with English result names, no-change repeat upload, edited-row protection, policy-change re-preview, stale-preview rejection/recovery and malformed-file errors without writes. Desktop/390px layouts were inspected without settled horizontal overflow, and runtime diagnostics were clean. All temporary accounts/catalogs/logs and queued fixture work were removed, and the browser signed out/closed. No existing user's dataset or indexing queue was processed.

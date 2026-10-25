# Historical Health imports (#109)

Two standalone CLI commands backfill the existing `HealthMetric` store. They do
not expose endpoints, change the schema, start synchronization, or alter exports.
Issue #109 stays open until a real import and verification have succeeded.

## Commands

Use Yarn 4 from the repository root, with dependencies and generated Prisma Client
available (`yarn prisma generate` if necessary). Scripts load Next.js environment
files just like the Home Assistant worker, including `.env.local`. The database
must already contain the intended user. Email matching is case insensitive and
must return exactly one user; missing/ambiguous users fail before parsing.

```bash
yarn health:import:withings --file "docs/datasets/withings_2026_10_25_data_AAR_1792933880" --user "aaron@test-email.aarondewindt.space" --dry-run
yarn health:import:samsung --file "docs/datasets/Samsung Health/samsunghealth_aaron.dewindt_20261025135468" --user "aaron@test-email.aarondewindt.space" --dry-run
```

After reviewing the limitations below, the exact real-import commands are:

```bash
yarn health:import:withings --file "docs/datasets/withings_2026_10_25_data_AAR_1792933880" --user "aaron@test-email.aarondewindt.space"
yarn health:import:samsung --file "docs/datasets/Samsung Health/samsunghealth_aaron.dewindt_20261025135468" --user "aaron@test-email.aarondewindt.space"
```

**These real imports have not been executed.** Use another existing email if the
target database differs. Add `--overwrite` only under the matching rules below;
preview it with `--dry-run --overwrite`. `--file` accepts an extracted directory
or one recognized CSV file. ZIP archives are not unpacked by these commands.
For a single Withings CSV, the user's timezone is the fallback because the sibling
device file is not read. Use the whole directory for all three Withings metrics.

## Inspected exports, 2026-10-25

The Withings absolute host path from the issue resolves to the workspace's
`docs/datasets/withings_2026_10_25_data_AAR_1792933880` directory. Both extracted
exports and their ZIP files were already present and ignored by Git. Nothing in
the original datasets was changed. Reports stay in ignored `.local/`; do not add
exports or raw measurement logs to Git.

Withings contains 38 UTF-8 CSV files (191,569 data records, about 11.4 MB) plus
`README.txt`. Samsung contains 64 UTF-8 CSV files (90,192 data records, about
22.7 MB) and 41,739 JSON sidecars (about 346 MB). Samsung CSVs have a metadata
preamble before the header and an extra empty trailing field on many records;
Withings `other.csv` omits an unused trailing `position` field. The streaming
parser handles both, BOMs, quoted commas, escaped quotes and multiline fields.
Each run inventories every top-level file, including unsupported tables and
source temporal-column ranges. JSON sidecars contain detailed bins, session
extras and app metadata; these are not additional independent measurements.

| Source/table | Available records | Measurement dates | Import mapping |
| --- | ---: | --- | --- |
| Withings `weight.csv` | 313 | 2022-01-25–2026-10-25 | Weight, kg |
| Withings `other.csv`, `FAT_PERCENT` | 295 | 2022-01-25–2026-10-25 | Body fat, % |
| Withings `other.csv`, `FAT_FREE_MASS` | 295 | 2022-01-25–2026-10-25 | Lean mass, kg |
| Samsung `calories_burned.details` | 2,031 daily rows | 2018-05-21–2026-10-25 | Active calories, kcal; components retained in metadata |
| Samsung `step_daily_trend` | 4,441 rows; 1,969 all-source days | 2018-06-17–2026-10-25 | Only `source_type = -2`, steps |
| Samsung `health.weight`, explicit BMR | 38 of 82 rows | 2025-01-26–2026-05-30 | BMR, kcal/day |
| Samsung `shealth.sleep` | 608 sessions | 2018-06-17–2026-10-25 wake dates | Daily duration, hours; original sessions retained |

Other Withings data includes 1,119 activities, 558 sleep sessions, five daily
activity tables with 210 rows each (2023-08-18–2026-10-18), 26,613 heart-rate
samples, tracker streams, 295 readings each for fat-free/muscle/bone/water
percentages, one VO2max reading and one height reading. Weight rows also include
fat, bone, muscle and hydration masses. These are outside this import's Withings
scope or have no corresponding Health metric; none are silently substituted.

Samsung also contains 2,030 activity-day summaries, 4,441 pedometer-day summaries,
7,729 recent step intervals, 19 combined sleep parents, 15,161 sleep stages,
15,236 heart-rate records, 1,717 HRV records, 4,042 stress records, 2,651 floor
records, 5,142 movement records, 302 respiratory-rate records, 293 skin-temperature
records, oxygen/AGE/vitality/snoring data, workouts, food/water, height and app
configuration/social/goal tables. Unsupported records and duplicate representations
are inventoried but not imported. Nutrition snapshots are never written by these
scripts. No schema expansion is needed.

## Measurement semantics and unresolved limits

- **Withings:** direct `FAT_PERCENT` and `FAT_FREE_MASS` values from `other.csv`
  are used as exported, including their original rounding. Lean mass is not
  calculated from weight/fat and muscle mass is not treated as lean mass.
  Offsetless timestamps are local wall clocks. The supplied device file says
  `Europe/Amsterdam`; the account creation epoch and corresponding local profile
  timestamp corroborate this interpretation. An export without a unique device
  zone uses the user's zone. Original strings and timezone basis are retained.
  Historical travel zones cannot be recovered from these rows; ambiguous repeated
  DST hours and nonexistent local times are rejected instead of guessed.
- **Steps:** Samsung documents all-source daily totals as already deduplicated
  across phone/watch. `SOURCE_TYPE_ALL` is `-2`. The 1,968 phone rows and 504 watch
  rows are excluded, as are pedometer, activity-summary and raw interval copies.
  Daily `day_time` is a calendar label encoded at UTC midnight, not an observation
  to shift into another date. The original label is preserved.
- **Calories:** legacy `calories_burned.details` has `active_calorie`,
  `rest_calorie`, `tef_calorie`, and sometimes `total_exercise_calories`, but no
  explicit total-calorie field. Activity-day `calorie` and pedometer/step calorie
  fields are overlapping representations of activity expenditure. Active calories
  are imported once from `active_calorie`; exercise calories are not added again.
  Rest/TEF/exercise components are retained as metadata. **Total calories cannot
  currently be imported safely from this dataset.** Adding rest + active + TEF
  would be an inferred legacy total without verified equivalence to the companion
  SDK or elapsed/projected semantics. The supplied diagnostic-upload file is empty
  and cannot settle this. No synthetic total is persisted, and active is never
  used as total burn. This means these imports alone do not backfill historical
  calorie balance. Verification against Samsung's displayed totals is still needed.
- **BMR:** only the 38 explicit `basal_metabolic_rate` body-composition points are
  imported. Daily `rest_calorie` is expenditure, not a BMR reading. Neither a
  formula nor a reverse calculation is used to manufacture missing BMR.
- **Sleep:** original UTC session bounds and recorded UTC offset are retained.
  Sessions belong to their wake-up calendar date, including overnight sessions;
  naps on the same date are summed. Combined-parent rows and stages are not added
  on top of child sessions. The 284 rows with `sleep_duration` use those minutes.
  The 324 rows without it use explicitly labelled elapsed bedtime-to-wake duration;
  these may include awake time and must not be interpreted as stage-derived actual
  sleep. Identical intervals are deduplicated; remaining overlaps with differing
  bounds are withheld, never summed or proportionally allocated. Fourteen session
  records on six wake dates need review: 2018-09-27, 2025-07-05, 2025-10-25,
  2025-10-26, 2025-11-03 and 2026-02-15. Other metrics on those dates still import.
- Samsung timestamps are UTC values; point/session dates use the supplied offset.
  Daily aggregate rows provide no historical offset, so their source dates are
  preserved and the user's zone is recorded as a fallback. No full-day period or
  verified elapsed-expenditure classification is fabricated. Existing charts keep
  such calories unsplit. Source timestamps describe measurements/session ends or
  daily summary updates, rather than the time this CLI was run.

Primary references:
[Samsung StepDailyTrend](https://developer.samsung.com/health/android/data/api-reference/com/samsung/android/sdk/healthdata/HealthConstants.StepDailyTrend.html),
[Samsung constants](https://developer.samsung.com/health/android/data/api-reference/constant-values.html),
[Samsung body composition units](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-body-composition-type/index.html),
[Samsung sleep](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-sleep-type/index.html),
[Samsung session duration](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.data.entries/-sleep-session/duration.html).
The bundled Withings README defines its CSV units; it does not supply a timezone
for each weight/body record. Legacy calorie total composition remains unresolved.

## Idempotency, overlap and overwrite

The shared `HealthMetric` table, owner association, `validMetricValue` validation,
calendar-date helpers, decimal precision and application source selection remain
in use. Sources are `withings` and `samsung_health`; imported metadata identifies
the importer version and original timestamps/identities. No HA mapping,
connection, companion credential, sync receipt or cursor is created or changed.

- Withings identity is metric + exact resolved measurement instant. Separate
  instants remain separate, even on the same day with the same value. A same-metric
  synchronized/manual row at exactly that instant is protected. HA stores sensor
  state timestamps, which may lag the measurement; same-date HA observations at
  other instants are reported as possible overlaps and retained, because proximity
  or equal values do not prove sample identity. Existing daily source precedence
  still selects one observation rather than adding sources. Withings exports have
  no stable per-sample ID, so distinct readings with identical second-level times
  cannot be distinguished; conflicting values are reported for review.
- Samsung daily identity is metric + source date. Any existing non-import row for
  that metric/date (companion, manual or legacy HA) is protected, regardless of
  capture time or value. Imported daily snapshots are never summed with live ones.
  Future companion sync can retain its own identity and normal latest-observation
  selection. BMR is a point reading keyed by upstream ID; exact measurement time,
  companion `sourceObservedAt` or upstream ID detects synchronized overlap.
- Default replays skip an existing import identity. `--overwrite` replaces only
  that identity's import-owned row when its data differs; it retains the row ID
  and source identity, and updates receipt time. It never overwrites or deletes
  synchronized/manual rows, even when overwrite is requested. Corrected timestamps
  create new identities; they do not silently delete earlier records. Unchanged
  rows remain skipped. Owner scope applies to every lookup and write.

## Execution, reporting and validation

CSV reading is streaming with a 1 MiB record limit. Candidates are spooled by
calendar date to a mode-0700 temporary directory, in mode-0600 files, cleaned up in
`finally`. Per-date processing is capped at 16 MiB / 10,000 candidates and 10,000
existing database rows; limits fail rather than allocating unbounded memory.
Transactions contain at most 100 candidates. Real writes share Android ingestion's
owner advisory lock; the existing owner/source-key unique constraint also guards
concurrent importer replays. Avoid running imports alongside HA backfill if you
need a fixed duplicate-count preview; a dry-run is not a reservation of data.

Dry-run performs all parsing, mapping, validation, session consolidation and
owner-scoped duplicate checks in database transactions explicitly set **READ ONLY**.
It does not call persistence mutations, including with `--overwrite`. Temporary
staging files are the only writes. Counts can change as live sync advances.

JSON-line reports include discovered files, available source-date ranges, candidate
metric ranges, parsed/candidate/unsupported/invalid/consolidated counts and planned
creates/skips/replacements. `protected` is a subset of `skipped`.
`importable` counts planned creates; `overwritten` counts planned replacements.
`consolidated` counts source rows folded into daily aggregates or duplicate
identities. Invalid session counts exclude those dates' unrelated metrics.
Unsupported files/rows and recoverable parsing problems are reported without raw
values/comments; fatal CLI, owner, database, filesystem or safety-limit failures
exit nonzero. Real imports commit incrementally, so a later fatal failure can leave
successful earlier batches; rerunning safely skips them. Review invalid counts even
when exit status is zero. SIGKILL can leave a private temporary directory to remove.

Actual dataset dry-runs against the existing owner, 2026-10-25:

| Result | Withings | Samsung |
| --- | ---: | ---: |
| Top-level files | 39 | 64 |
| Parsed CSV records | 191,569 | 90,192 |
| Supported candidate readings | 903 | 4,646 |
| Consolidated source rows | 0 | 161 |
| Invalid/ambiguous readings withheld | 0 | 14 |
| Importable new rows | 903 | 4,446 |
| Existing rows skipped/protected | 0 | 25 |
| Planned overwrites | 0 | 0 |
| Database writes | **0** | **0** |

Samsung has 433 accepted daily sleep totals after consolidation and withholding
ambiguous dates. Its 4,471 normalized candidates comprise those sleep totals,
2,031 active-calorie daily readings, 1,969 step days and 38 BMR points. Twenty-five
are protected by existing data. No Withings HA overlaps were found in this database.
Private full reports are `.local/health-withings-dry-run.jsonl` and
`.local/health-samsung-dry-run.jsonl`.

Focused Jest coverage checks CSV formats, local time/DST, direct measurements and
units, step-source filtering, calorie/BMR separation, sleep date/consolidation,
protected sources, overwrite decisions, dry-run no-write behavior, user resolution,
batched writes and replay idempotency. No real database import was used for tests.

Validation passed: 45 focused Jest tests across historical import, HA import,
companion ingestion and normalization; `yarn typecheck`; changed-file Oxlint and
format checks; `git diff --check`. Both actual datasets were also rerun with
`--dry-run --overwrite`: counts matched the table and database writes remained
zero, including all 25 protected existing Samsung rows. No Next.js routes or UI
were changed, so browser/runtime diagnostics were not applicable.

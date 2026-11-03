# Planner availability redesign

**Status:** Accepted design; approved 2026-11-03. Implementation remains separately tracked and is not authorized by this document alone.

**Issues:** #69, #70, #124 and #125; related #13, #17, #31, #41, #119 and #123.

This design replaces legacy work modes, flat weekly windows and category reservations with historical, guided availability slots. AI interprets soft preferences; deterministic application code resolves categories, validates constraints, places blocks and owns all state changes.

Canonical vocabulary is defined in [the glossary](../GLOSSARY.md). Architectural trade-offs are recorded in [ADR 0001](adr/0001-resolve-weekly-availability-by-reference-and-dates-by-snapshot.md), [ADR 0002](adr/0002-use-typed-slot-intent-with-deterministic-placement.md), [ADR 0003](adr/0003-remove-category-reservations-and-use-a-transient-leisure-target.md) and [ADR 0004](adr/0004-use-a-single-destructive-availability-cutover.md).

## Scope

V1 supports named availability templates, effective-dated weekday assignments, date snapshots, per-slot names and soft AI guidance, and one normalized task-category policy per slot. It removes `PTO`, `NO_WORK`, `WFH`, `NORMAL` and `CUSTOM` as scheduling semantics, removes category reservations and removes public deterministic planning modes.

Desktop is the primary surface. Overnight and cross-day scheduling remain in #17. Location, maximum-session and other structured slot restrictions are deferred. Manual draft editing remains permissive under #123.

## Domain model

The exact Prisma names may follow nearby conventions, but the model has these responsibilities:

- **Availability template:** stable user-owned identity with archive state.
- **Template revision:** immutable, effective-dated template name and ordered slot values. Revisions default to tomorrow and may explicitly take effect today or later.
- **Logical template slot:** stable identity retained while that slot is edited across revisions. Deleting and recreating a slot creates a new identity.
- **Weekly availability assignment:** effective-dated weekday-to-template history. Missing assignment means no weekly availability.
- **Date availability override:** date-owned parent that shadows weekly resolution. Zero slots means explicitly unavailable.
- **Date availability slot:** independent snapshot identity with copied time, name, guidance and category policy. Template provenance is explanatory only.
- **Planner timezone period:** effective-dated timezone history used to resolve local dates and wall times.
- **Accepted-plan availability snapshot:** dedicated schema-versioned JSON containing the exact effective availability present at acceptance.
- **Generation input snapshot:** effective slots or their canonical hash stored with each successful AI-generated draft revision.
- **Generation attempt:** owner/date/request-scoped bounded diagnostics for attempts that fail without creating a draft revision.

Date availability is separate from the non-availability context currently held by `DayOverride`. Resetting availability must not delete location, brief, capacity or other unrelated day context.

### Slot shape

An effective availability slot contains:

- Stable logical/effective identity and origin.
- `startMinute` and `endMinute` within one local calendar day.
- Optional name.
- Optional bounded free-text guidance.
- One category-policy mode: `ALL`, `ALLOW_ONLY` or `EXCLUDE`.
- A finite set of `WORK`, `LIFE`, `LEISURE` and `REST` categories where the mode requires it.

Missing policy means `ALL`. An empty `ALLOW_ONLY` set permits no automatically placed task blocks. The policy does not constrain meals or generated breaks and is not an acceptance constraint for an explicitly reviewed manual draft.

Templates and overrides reject overlapping slots. Adjacent slots are valid and remain distinct even when their metadata happens to match. `00:00–24:00` is valid. Gaps are unavailable.

## Effective availability

For a date:

1. Resolve the historical Planner timezone applicable to that date.
2. If a date availability override exists, use its ordered snapshot slots, including an explicitly empty set.
3. Otherwise resolve the weekday assignment effective on the date and the template revision effective on the date.
4. Otherwise return no availability.
5. Resolve wall-time boundaries to instants and subtract busy commitments and other planning exclusions for placement without mutating the stored slots.

Full-day availability covers the actual local day, including 23-hour and 25-hour days. Any other ambiguous or nonexistent DST boundary fails explicitly; Vela never silently shifts it. Past dates cannot be edited through ordinary availability workflows.

Editing an inherited date copies its effective slots to a new date override before applying the edit. Applying a template to one date or an inclusive range creates independent snapshots with new identities. V1 supports previewed, atomic skip-or-replace over at most 366 today-or-future dates; it does not merge slot sets. Existing overrides are skipped by default. Reset deletes the date availability override and reveals weekly resolution.

Template deletion is archival. A template must first be removed from current or future assignments; historical assignments continue resolving it. Template revision UI previews the effective date, affected weekdays and open drafts that will become stale.

## Scheduler contract

Task category is resolved deterministically as task category, then theme category, then `WORK`. AI never supplies or overrides that classification.

One bounded model call receives all effective slots and authorized candidate tasks. Candidates may be prefiltered by hard slot eligibility. The typed result supplies, per slot:

- Slot identity.
- Target task minutes, allowing intentional underfill.
- Ordered candidate task IDs.
- Bounded reasons.

The model supplies no timestamps. Explicit one-off generation guidance outranks stored slot guidance as a soft preference; hard category policy always wins.

Application placement clamps budgets, enforces remaining estimates and category policy, prevents cross-slot over-allocation, applies calendar/session/break rules and produces timestamps. An automatic block never crosses a slot boundary. A split task may use multiple slots only as separate segments, each independently eligible.

Unknown task IDs, hard-ineligible slot assignments, contradictory intent or schema violations fail the attempt atomically. The draft remains unchanged and diagnostics identify the stage and invalid paths. A valid sparse response may leave a slot empty and is reported honestly.

There is no deterministic fallback planner. Public Auto-fill, deterministic candidate selection and the legacy `generateDraft` path are removed. Deterministic placement and validation remain mandatory after successful AI selection. A date with no effective availability skips the model and shows configuration/manual-editing actions instead.

## Leisure, meals and breaks

Category reservations are removed from behavior and persistence. Leisure tasks no longer require reserved category time.

The leisure target counts scheduled `LEISURE` task blocks and generic leisure blocks. After protected commitments and meals, automatic planning prefers eligible leisure tasks. Any remaining target is filled with explicit taskless `DailyBlock` records whose category is `LEISURE`, title is normally “Leisure,” and source is `PLANNER` or `MANUAL`.

Generic leisure blocks occupy schedule time, obey the configured maximum leisure-block duration when generated and may be distributed across eligible slots. Generated blocks are replaceable during regeneration; manually created or edited blocks retain manual protection. Done or skipped outcomes affect only the block. Meals, breaks and REST blocks do not count toward the leisure target. If slots do not permit enough leisure, the report shows the shortfall.

Meals and application-generated breaks remain independent. They must fit effective availability and occupied-time rules but are not filtered as task categories.

## Draft and plan lifecycle

Availability changes never rewrite accepted plans or discard working drafts. A canonical resolved-slot snapshot participates in draft freshness; changes to time, identity, name, guidance, policy or timezone stale only drafts whose resolved input changes. Editing an unrelated unassigned template does not.

A stale draft remains visible and manually editable with undo, redo and cancel, but AI generation and acceptance are blocked until reconciliation. The user may:

1. **Keep draft availability:** copy its prior availability into a date override and rebase without changing blocks.
2. **Use current availability, keep schedule:** rebase every block and show advisory mismatches.
3. **Regenerate automatic blocks:** use current availability while preserving manual/protected blocks.
4. **Cancel draft:** use the existing confirmed cancellation flow.

Availability saves before and independently of reconciliation or model calls. A failed regeneration leaves both the saved availability and original stale draft intact.

Manual placement remains permitted outside availability and across category policies. Acceptance continues to enforce hard occupancy, busy-event, day-boundary and protection constraints, not availability or category advice. Each generated revision retains its actual generation input; the accepted plan separately records the effective availability present at acceptance.

## APIs and UI

Persistent templates, revisions, assignments, overrides, timezone periods and snapshots are server state exposed through thin protected tRPC procedures over availability services. Zustand remains limited to local interaction state.

The desktop UI provides:

- Template create, edit, duplicate, archive and restore.
- Seven independent weekday assignments.
- Effective-date and affected-date previews.
- Date editing, explicit unavailability and reset.
- Inclusive range snapshot application with skip/replace preview.
- Clear empty states for unassigned weekdays and dates with no availability.
- Draft-staleness reconciliation actions.
- Visible slot names, guidance and category policies.

Planner conversation gains a reviewed date-specific availability proposal tool. It may edit slots, apply a template snapshot, reset a date or mark it unavailable. It cannot mutate templates or weekday assignments. Applying the proposal may stale a draft but never silently regenerates it.

## Failure diagnostics

A failed AI attempt leaves the draft unchanged and stores an owner-scoped record containing stable request/correlation identity, model identity, stage, error code, failure class, concise sanitized detail and bounded validation paths. It stores no secrets, complete prompts or unrestricted raw output. Records are retained for 30 days and capped at the latest 100 per user. The UI shows an actionable error and debug description; manual planning is the fallback.

## Migration and cutover

The current database is test-only and has no open Planner drafts. Use one backed-up, verified destructive cutover rather than dual readers:

1. Create the versioned template, assignment, date override, timezone-history and diagnostic structures.
2. Group identical legacy weekday window sets into user-owned migrated templates and effective assignments; leave empty weekdays unassigned.
3. Convert `CUSTOM` dates to snapshots, including legacy start/end fallback; convert `PTO` and `NO_WORK` to explicit empty overrides; let `NORMAL` and `WFH` inherit weekly assignment.
4. Preserve unrelated day context.
5. Normalize overlapping legacy windows to their effective union and reject irrecoverably invalid times rather than guessing.
6. Cut all readers and writers to the canonical resolver.
7. Delete category-reservation data/schema, legacy availability tables and work-mode availability fields, obsolete draft fields and obsolete scheduler paths.
8. Verify migrated effective dates and take a post-migration backup.

Older accepted plans may lack the new availability snapshot because their exact prior context is not reconstructible. Their blocks and task state remain intact. New plans preserve history going forward.

The new availability tables join the same consistent coarse lock order in proposal, draft and conversation transactions. Owner-scoped locking is separate work.

## Recommended implementation phases

1. **Contracts and persistence foundation:** schemas, pure validation, effective-dated timezone/template/assignment/override services, canonical resolver, snapshot/hash contracts and migration tests.
2. **Scheduler integration:** slot-aware candidate context, typed AI intent, category enforcement, boundary-aware deterministic placement, generation/acceptance provenance and failure diagnostics.
3. **Retirement and leisure:** remove category reservations, deterministic/legacy scheduler surfaces and add generic leisure blocks.
4. **UI and conversation:** template/assignment/date/range workflows, empty states, stale-draft reconciliation and reviewed date-availability chat tool.
5. **Cutover and verification:** destructive migration, lock audit, documentation, full automated suite, real-model tests and authenticated desktop browser scenarios.

## Issue refinements

### #69 — guidance and category architecture

Refocus on the normalized slot policy, canonical effective-slot contract, one-call per-slot AI intent, deterministic category enforcement and boundary-preserving placement. Add generation versus acceptance snapshots, atomic invalid-output failure, sparse valid output and bounded failure diagnostics. Remove deterministic fallback acceptance criteria.

### #124 — retire category reservations

Make physical removal acceptable for the test-only cutover. Include removal from draft/proposal schemas, validators, UI and legacy scheduler paths. Replace the leisure reservation mechanism with explicit generic leisure blocks and regression coverage for meals, breaks, manual edits and block outcomes.

### #70 — reusable templates and weekly assignments

Split delivery into a foundation needed before #69 and later UI/cutover completion. Add immutable effective-dated revisions, logical slot identity, assignment and timezone history, archival deletion, historical accepted-plan snapshots, date overrides, reset, explicit empty dates, range skip/replace without merge, past-edit prohibition and stale-draft fan-out preview.

### #125 — end-to-end verification

Add migration of all legacy modes, destructive cleanup, historical resolution, timezone changes, DST rejection, slot identity, adjacent guidance, category policies, split tasks, generic leisure blocks, model failures, sparse intent, no-availability short-circuit, draft reconciliation, chat proposals, concurrency/lock order, owner isolation and desktop browser evidence.

## Risks and deferred work

- Per-slot model intent may increase prompt/output size; candidate bounds and evaluation under #41 remain necessary.
- Strict DST-boundary rejection needs clear date-level recovery UI.
- Coarse planner locks remain cross-user and should be reconsidered only as separate work.
- The destructive migration intentionally cannot reconstruct pre-redesign availability history.
- Future-dated revision UX and archived-template restoration require careful conflict messaging.
- Overnight sleep, cross-day routines, location restrictions and a historical correction workflow remain out of scope.

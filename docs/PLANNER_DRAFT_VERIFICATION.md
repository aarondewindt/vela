# Planner draft verification — November 3, 2026

This report covers the persistent-draft redesign in #119, #59, #37 and #73.
#120 remains open for the broader acceptance matrix and repeated daily use.
No production deployment or existing user-data rewrite was performed. The additive
migration was applied to the local development database; model/browser fixtures use
synthetic ownership. All issue acceptance criteria must be checked before closure.

## Issue #120 acceptance pass — November 3, 2026

The desktop workflow was exercised end to end with a disposable credential account
and then repeated against focused automation. The account and every cascaded fixture
were deleted afterward. No existing Planner row was read for fixture construction or
changed by the run. Issue #120 remains open for the owner's final daily-use review.

### Automated and integration results

- Full Jest: 197 suites passed, 1,682 tests passed, 41 opt-in tests skipped.
- Focused Planner run: 29 suites passed, 314 tests passed, 13 opt-in tests skipped.
- Real PostgreSQL lifecycle suite: 10/10 passed in a random schema that was dropped
  afterward. It covers durable revisions, refresh recovery, replay, create/edit/accept
  races, stale inputs, atomic rollback, history/identity preservation, regeneration,
  conversational batching, permissive conflicts, strict acceptance and past drafts.
- TypeScript, Prisma Client generation, changed-script Oxlint/format and the production
  build passed. The build requires `NODE_ENV=production` in this execution environment;
  it retains the pre-existing attachment-storage NFT tracing warnings.
- Deterministic suites cover busy/non-busy calendar events, category reservations,
  availability/advisory overrides, recurrence, meals, DST 23/25-hour days, ambiguous
  wall time, started/completed/locked blocks and calendar-linked protection.

### Real browser outcomes

An authenticated Chromium session visited `/planner/today` at 1720×1050 and 1280×900.
The test created an empty draft by dragging a real candidate, moved it, resized from
both edges, undid both edits, reloaded, redid both edits, and accepted it. It then
cloned the active schedule with another drag, intentionally overlapped two blocks,
received a conflict naming both blocks and local ranges, retained the draft, resolved
the overlap and accepted. The UI returned to one active DayView with both blocks. A
modified draft cancellation left the active plan identical. Date changes and saved
conversation changes did not change the date-owned draft. At 1280px the active layout
kept tasks, calendar and chat visible without body overflow.

The same browser invoked real AI generation, saw the generated blocks in the draft,
sent an unambiguous chat move and received the concise canonical reply “Updated the
draft.” The moved block became a manual override. A subsequent real regeneration kept
its ID, time and duration unchanged. Switching to a new conversation and back restored
the saved command/reply while the draft ID/version remained unchanged. Expected
acceptance returned HTTP 400 for the deliberate conflict; no unexpected 4xx/5xx
requests were captured.

Next DevTools confirmed `/workspaces/vela`, the Planner/API routes and the visited page.
It reported no Planner build error. Runtime diagnostics did report Mantine's app-wide
`ColorSchemeScript` React warning. The synthetic sign-in method (fetching credentials
after first rendering the anonymous shell) also produced an auth hydration mismatch;
that mismatch does not occur in the normal sign-in-modal flow and is not a Planner
state failure.

### Real Ollama outcomes

Two live runs used `qwen3:8b` for conversation and independently configured
`qwen3:14b` for scheduling. Generation persisted a non-empty draft without activating
a plan; a question did not change its revision; chat moved the requested block in one
revision; normal regeneration preserved that manual override exactly; replaying the
same generation request returned the saved receipt without another mutation;
conversation deletion retained the draft; and an unavailable endpoint left version
and state unchanged. One exploratory run needed two SDK/model tool-argument
corrections before final success; the expanded repeat passed. This is sampled live
integration evidence, not a guarantee that every model response will be valid.

### Coverage added in #120

`scripts/verify-planner-drafts.mjs` now repeats both-edge resize, undo/redo across
reload, deliberate conflict retention and resolution, final single-DayView acceptance,
cancel preservation, page-error capture and unexpected failed-request detection.
`scripts/verify-planner-ollama.ts` now repeats live normal regeneration, exact manual
override preservation and duplicate-request receipt replay.

### Remaining limitations and manual acceptance

The following were not reproduced as destructive live-history scenarios: editing a
real started/completed/calendar-linked activity, a real multi-tab UI race, and a
hard-killed Ollama process mid-token. Their service/database contracts are covered,
but the final owner review should use ordinary non-critical data:

1. Open today's Planner at the desktop width normally used each day.
2. Drag one real task, move it and resize both edges; undo/redo once and reload.
3. Generate, make one chat change, regenerate, and confirm the manual placement stays.
4. Intentionally overlap two future editable blocks; confirm Accept explains the
   conflict and keeps the draft, then resolve and accept.
5. Confirm the final active schedule is correct in the single DayView and that no
   protected/started/completed/calendar-linked item changed unexpectedly.
6. Create and cancel one harmless draft, switch dates and conversations, and confirm
   the active schedule is unchanged.
7. Note whether calendar density, sidebar widths, chat brevity or drag handles feel
   awkward during a normal planning session; keep #120 open until that review passes.

## Recorded outcomes

| Scenario | Evidence / outcome |
| --- | --- |
| Empty day → first manual edit | Real authenticated API/browser: drag from existing candidate list creates draft and performs placement. No active plan/occurrence is created. |
| Active → first modifying action | Real desktop drag creates copied draft with initiating edit; active API state stays identical. |
| Dual calendars | Authenticated 1720px desktop, existing sidebar and DayViews; active has no drag handles. A separate 1280px smoke visited active view without page errors. |
| Manual move/resize/remove | Real browser drag movement and pointer resize; service checks cover removal. Resize remains constrained by task effort; the browser test shrinks a block instead of silently changing its estimate. |
| Undo/redo/reload | Browser buttons and reload smoke; PostgreSQL verifies durable cursor, redo, branch truncation and net-empty cancellation. |
| Accept/cancel | Browser accept returns to one active view. Modified cancel prompts; confirming cancellation leaves active API state identical. |
| Concurrent creation/edits/acceptance | Real PostgreSQL, isolated schema: expected-version fencing, one OPEN draft, same-request replay, distinct competing accepts and exactly one current plan. |
| Atomic rollback | A synthetic late-failure DB trigger rejects closing the draft after promotion writes; plan/blocks/occurrences roll back and draft remains. |
| History/identity | Old plan/block rows and check-ins remain; existing occurrence state and task progress are unchanged by acceptance. Draft-only task references and remaining effort survive subsequent edits without fake occurrences. |
| Staleness | Relevant task changes flag/reject acceptance, safe refresh revalidates; a changed active base cannot be refreshed over. Draft remains saved. Unrelated metadata does not stale it. |
| Regeneration | Real DB: normal generation retains manual placement/resize; explicit rebuild reorganizes eligible future manual placements. Started/completed/locked/manual-override protection has focused deterministic coverage. |
| Past dates/DST | DB: past drafts stay saved and cannot activate. Deterministic tests verify 23/25-hour days and ambiguous saved-zone wall times. |
| Live Ollama | Actual `qwen3:8b` conversation and separately configured `qwen3:14b` scheduler generated a saved draft, answered a question without changing revision, moved work in one revision and retained draft after conversation deletion. |
| Concise success/failure | Successful live turns show application-owned “Draft schedule updated.” / “Updated the draft.” Tests ensure a failed update cannot be replaced with model prose claiming success. |
| Runtime diagnostics | Next DevTools verified project/routes/logs on 3000 initially. A stale failed router module on that server required an isolated 3002 server; metadata and authenticated visited-page diagnostics on 3002 returned no config/session errors. Temporary config was restored; a final read-only request on original port 3000 returned 200. |

The full Jest run passed 199 suites / 1,694 tests (41 opt-in skips); final
focused generation/chat/draft/proposal checks passed 257 tests, and
isolated PostgreSQL passed ten tests. TypeScript, changed-file lint/style checks
and production build passed. The initial full-suite transport failure was sandbox
child-process denial and passed on rerun with the required execution access.

After the final #123 validation-policy changes landed, the #37 integration was
rechecked against that exact revision. The focused draft/chat/generation/proposal/
review/UI run passed 26 suites / 290 tests (13 opt-in skips), the isolated PostgreSQL
suite passed all ten lifecycle tests, TypeScript passed, and the full Jest run passed
199 suites / 1,700 tests (41 opt-in skips). A fresh live run again used `qwen3:8b`
for conversation and independently configured `qwen3:14b` for scheduling; it created
a draft without an active plan, kept an informational question revision-neutral,
applied the following edit as one revision, preserved state across conversation
deletion and rolled back a deliberately failed scheduler call. Repository-wide
format/lint checks still report the documented unrelated baseline violations.

## Reproduction

Use Yarn 4. Regenerate Prisma and deploy the additive migration before starting a
fresh development process. Never reset or overwrite the application database.

```sh
yarn prisma generate
yarn prisma migrate deploy
yarn typecheck
yarn jest --runInBand lib/planner/drafts lib/planner/chat lib/planner/generation
NODE_OPTIONS=--experimental-vm-modules VELA_PLANNER_DRAFT_DB_TESTS=1 yarn jest --runInBand lib/planner/drafts/database.test.ts
```

The DB suite creates a random isolated PostgreSQL schema, applies migrations there
and drops only that schema. PostgreSQL access/schema privileges are required.
Default Jest skips this suite; its inference dependencies are mocked so deterministic
DB checks do not need Ollama.

The optional browser runner requires Playwright/Chromium, supplied separately from
application dependencies. It creates a synthetic credential account, exercises real
candidate drag/drop, movement, pointer resize, acceptance, active-copy creation and
cancellation, then deletes only that account and its fixtures.

```sh
VELA_PLANNER_BROWSER_SMOKE=1 \
VELA_PLANNER_SMOKE_BASE_URL=http://localhost:3000 \
VELA_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
VELA_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium \
yarn exec tsx --conditions=react-server scripts/verify-planner-drafts.mjs
```

For a development server whose listening origin differs from Better Auth's canonical
origin, set `VELA_PLANNER_SMOKE_ORIGIN` to the trusted canonical origin. Do not relax
the application's origin checks for the runner.

The live runner uses real model resolution, streaming tools, scheduler and database
persistence, with a disposable synthetic owner and automatic cleanup:

```sh
VELA_PLANNER_OLLAMA_SMOKE=1 \
VELA_PLANNER_CONVERSATION_MODEL=qwen3:8b \
VELA_PLANNER_SCHEDULER_MODEL=qwen3:14b \
yarn exec tsx --conditions=react-server scripts/verify-planner-ollama.ts
```

It requires the configured Ollama endpoint and both installed models. No model is
silently substituted. Synthetic data/replies may be printed; no credentials are
printed. AI inference runs outside draft transactions.

## Failure found and fixed; remaining scope

Live testing found draft-only blocks losing task identity when the old snapshot
adapter looked only at authoritative occurrences. The adapter now carries their
intended task references separately and includes them in effort accounting.
Regression tests cover identity before/after a subsequent edit.

A one-candidate live request produced the same key in both selected and omitted,
including on the existing correction attempt. Strict validation retained the draft.
The prompt now explicitly forbids placeholder omissions and the correction names
the repeated candidate. A subsequent full live generation/question/edit sequence
passed, including a deliberately unavailable Ollama endpoint preserving the existing
draft state/version unchanged. Some runs required SDK tool-argument correction;
the smoke validates final persisted behavior instead of assuming raw model output
is always valid. Invalid output remains a supported failure requiring retry/Auto-fill; this
is evidence of sampled integration, not a guarantee of model instruction following.
A related misleading model “ready to accept” response is now suppressed by the
canonical failed-update result.

Broader #120 acceptance still includes repeated model/date/availability scenarios,
real interrupted browser/model calls and multi-tab interaction beyond the DB race
checks, detailed calendar/recurring-meal combinations and longer daily use. Mobile
redesign, synchronized scrolling and automatic stale-base merging are deferred.
Keep issues open; do not treat mocked AI or a single successful live run as complete
usability acceptance.

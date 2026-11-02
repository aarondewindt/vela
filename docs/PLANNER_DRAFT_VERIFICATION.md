# Planner draft verification — November 2, 2026

This report covers the persistent-draft redesign in #119, #59, #37 and #73.
#120 remains open for the broader acceptance matrix and repeated daily use.
No production deployment or existing user-data rewrite was performed. The additive
migration was applied to the local development database; model/browser fixtures use
synthetic ownership. All issue acceptance criteria must be checked before closure.

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

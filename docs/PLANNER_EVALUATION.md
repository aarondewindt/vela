# AI scheduler evaluation and default (#41)

2026-10-22. The Today proposal workspace already selected AI by default before this
batch. The validated generate API now also defaults omitted `mode` to `ai`.
The existing **Deterministic · urgency order** choice is the explicit model-free
fallback/rollback. Both choices use the same candidate, placement, meal, validation,
preview and acceptance code. No duplicate legacy scheduler UI is introduced.
Model failure never silently substitutes a different selection policy or applies
changes; retry or select deterministic planning. The legacy draft API remains for
compatibility, not as the meal-capable fallback.

## Acceptance bar and automated coverage

The default requires valid application-owned placements; owner/reference/eligibility
validation independent of model prose; no writes on inference failure; explicit
unplaced work/unmet meals; preserved protected identity/history; stale-input rejection
and idempotent atomic acceptance; and a usable model-free alternative.

- `generation/{candidates,selection,schedule,service}.test.ts`: overload, sparse
  descriptions/default effort, due/important candidates retained beyond semantic
  top-k, hard prerequisites/earliest starts, recurrence, partial work, guidance vs
  unguided coverage, busy calendar time, available windows, category/session rules,
  malformed/duplicate/invented references, invalid schema fields and provider/model
  errors. Task-authored instructions cannot supply operations, timestamps, ownership,
  completion or exceptions; harmless-looking selection reasons still cannot bypass
  placement constraints. Generation warnings explain unassessed candidates.
- `generation/meals.test.ts`, `meal-service.test.ts`: all three meals, no task/model
  dependency, disabled preferences, fragmented/absent availability, elapsed windows,
  calendars, DST, manual adjustments, repeated generation/replanning, cancelled
  history, duplicate identity, version fencing and failed saves.
- `proposals/{validate,replan,service,router}.test.ts`: stale proposals, explicit
  progress/estimate changes, interruptions, recurring effort, minimal churn,
  changed availability, fixed/started/manual history, receipt replay and ownership.
  Shared `ai/structured.test.ts` exercises timeout cancellation, bounded inference,
  malformed output and provider-detail masking. These mocked service tests alone
  do not establish real database locking or model quality.
- Component tests cover meal settings, typed window editing, errors/invalid input,
  explicit AI/deterministic selection, previews/apply deadlines, meal shortfalls,
  diagnostics and progress controls.

Success reports include elapsed planning milliseconds (through placement), eligible
candidate count and operation count. Unscheduled minutes and recorded deadline risks
remain per candidate. Model failures expose a finite error code and a retry/fallback
action; rejected proposals retain existing constraint/staleness errors. No private
prompts, task contents, raw model responses or new application logs are emitted.

## Reproducible integration evaluation

`yarn tsx --conditions=react-server scripts/evaluate-planner.ts` creates an empty,
uniquely named disposable database using DATABASE_URL's configured PostgreSQL role,
applies every migration, uses synthetic users/tasks only, and drops that database
in finally. It requires CREATE DATABASE permission and a reachable configured
Ollama provider. `PLANNER_EVAL_MODEL` can select an installed chat model; otherwise
it prefers qwen3:8b. It never downloads a model or copies application user data.

The real PostgreSQL + qwen3:8b run passed with five eligible tasks (including a sparse
one, recurrence, oversized work and adversarial instructions), an unresolved blocked
task, and three enabled meals. Preview created no blocks/occurrences. Acceptance
created all three meals without duplication. A separate deterministic recurrence
preview verified exactly-once deferred occurrence creation even when overloaded
AI ordering left recurrence unplaced. Concurrent first
preference saves admitted one version, concurrent acceptance replayed safely,
foreign acceptance failed, changed preferences fenced a pending proposal, and a direct
duplicate meal insert failed. Acceptance also waited for an open legacy task
writer and then rejected the committed source edit without creating a plan. An explicit meal resize retained its ID and became
fixed. An unchanged remainder required **zero** replan changes.

Three successful runs observed core generation times of **8,981 ms**, **2,010 ms**
and **2,279 ms**, with **5/5**, **4/5** and **3/5 eligible tasks** receiving time
respectively. Every run placed all three meals, reported **1,050 task minutes explicitly unallocated**, and supplied
explanations for all five outcomes. Application validation accepted every generated placement. These are synthetic runs of one model,
not a production latency benchmark or proof of optimal packing/explanation quality.

## Remaining review and manual testing

Keep #41 open until daily-use quality and explanation usefulness have been reviewed.
No user-task text was sent for the synthetic evaluation. No browser automation was
available; component tests cover the controls, with interactive desktop/mobile review
still needed. A deterministic valid schedule is the hard gate; human usefulness,
longer-run timing distributions and comparative ordering quality require a broader
sample and cannot be established by counting explanations.

Recommended manual review:

1. Apply the additive meal migration, enable meals in Settings → Planner and inspect
   generated AI and deterministic previews on ordinary/overloaded/sparse days.
2. Move/resize a meal, complete/skip one, then generate and replan repeatedly. Verify
   one block per meal, retained overrides and useful unmet messages.
3. Add calendar conflicts or remove availability; check flexible replan changes and
   fixed-block warnings. Check same-day expiry, saved plan timezone and DST dates.
4. Choose an unavailable model, retry or select deterministic planning; confirm the
   accepted plan remains unchanged until reviewed acceptance.
5. Compare selected due/important work, unallocated minutes and explanations against
   personal intent, and review unnecessary changes after actual interruptions.

The generator remains greedy/bounded. The real runs showed ordering-dependent
task coverage under overload; a valid result does not guarantee every small task
receives time or that the packing/order is optimal. AI context is capped at 60 candidates; >60
mandatory candidates require backlog review/deterministic mode; unguided fill can
consider remaining eligible candidates. Guided planning can omit work, explicitly
reported. Rest/category/PTO semantics are preserved pending #69. Meals have no
Nutrition coupling; sleep and generalized routines remain deferred under #17.

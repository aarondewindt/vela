# Evidence-first AI extraction

> **Deferred — 2026-10-28.** Packaging-photo extraction is no longer exposed in the
> normal product editor or feature model settings. The experimental implementation
> below is retained for a future retry; it is not production-ready. The reusable
> `AiPromptComposer` multiple-model-picker API remains available. See
> [agent handoff](agent-handoff.md) for the current checkpoint.


Nutrition uses independently selected vision transcription and text interpretation,
followed by deterministic normalization. Shared primitives in `lib/ai/` receive
domain schemas/prompts and do not depend on Nutrition or Prisma. There is no
workflow engine or automatic fallback to another model.

## Reusable composer

`AiPromptComposer` keeps the existing single `modelPicker` API. Alternatively,
supply `modelPickers: ModelPickerStage[]`; these props are mutually exclusive.

| Stage property | Meaning |
| --- | --- |
| `id`, `label` | Stable stage key and visible/accessible purpose |
| `models` | Discovered models and capabilities |
| `requiredCapabilities` | All required capabilities; defaults to `chat` |
| `override` | Explicit model, or `null` to inherit |
| `resolution` | Current/default model, source, loading and errors |
| `onChange` | Controlled callback; `null` clears only this override |
| `help` | Optional descriptive content |
| `disabled`, `modelsLoading` | Interaction and discovery state |

`imageStageId` identifies the stage receiving attachments; otherwise the first
stage requiring vision is used. Each picker filters independently. Missing or
incompatible models are reported without choosing substitutes or losing pending
text/images. Consumers own persistence; the composer contains no feature/model IDs.

```tsx
<AiPromptComposer
  value={text} onChange={setText} onSubmit={submit}
  allowImages imageStageId="read"
  modelPickers={[
    {
      id: 'read', label: 'Read photographs', models,
      requiredCapabilities: ['chat', 'vision'],
      override: visionOverride, resolution: visionResolution,
      onChange: setVisionOverride,
    },
    {
      id: 'interpret', label: 'Interpret evidence', models,
      requiredCapabilities: ['chat'],
      override: textOverride, resolution: textResolution,
      onChange: setTextOverride,
    },
  ]}
/>
```

## Settings and persistence

`nutrition.productImport` remains the vision feature, preserving prior choices.
`nutrition.productInterpretation` adds the text feature. Initial selections in
the settings registry are `gemma3:12b` and `qwen3:8b`. Conversation overrides win
over feature settings; explicit feature model/profile choices and configured
profiles retain their precedence. Initial Nutrition choices apply when neither
the feature nor its profile is configured, ahead of the broad default LLM.
Explicitly choosing a profile uses normal inheritance, even if unconfigured.

Vision requires `chat` + `vision`; interpretation requires only `chat`. Installed
compatible `qwen3:14b` is therefore a valid independent interpreter. An unavailable
initial/default selection produces an error, never an unannounced substitute.

Product conversation creation accepts optional `stageOverrides`. Restoration
returns `stageOverrides` and resolved `stageSelections`.
`changeConversationStageModel({id, stage, selection})` updates just `transcription`
or `interpretation`; `null` restores inheritance. Legacy `selection` and
`changeConversationModel` remain the vision selection. Ordinary single-model chat
consumers retain their API.

Migration `20261027120000_product_extraction_stages` adds nullable JSONB columns:
`AiConversation.modelSelections` (overrides), `AiMessage.modelSelections` (turn
snapshots) and `AiMessage.pipelineCheckpoint` (validated transcription). Existing
rows and suggestions remain readable. Apply migrations and regenerate Prisma.

Both stages resolve from one settings read in the turn transaction. Concurrent
stage updates serialize before merging; changes during generation are rejected.
Reply metadata freezes resolved selections; suggestion diagnostics retain actual
stage attribution, including the original vision model on evidence reuse.
Later settings changes never rewrite historical suggestions.

## Shared execution and evidence

`generateStructuredStage` in `lib/ai/stages.ts` accepts an explicit model,
capabilities, Zod schema, prompt/schema versions, system instruction, text or
multimodal messages, cancellation, output/time budgets and an optional semantic
validator. It returns validated output and safe diagnostics. Its bounded retry
option uses the same model; the default makes one attempt. Failures carry a stage
label in `AiStageError`. `generateStructured` retains its defaults and adds
optional `timeoutMs` and `maxOutputTokens`.

`sourceEvidenceSchema` in `lib/ai/source-evidence.ts` is domain neutral and
versioned. Photographs contain text observations and tables. Tables preserve
captions, ordered headings, original row labels and cells with `columnId`.
Observations have `id`, original `text` and `uncertain`. IDs must be globally
unique; row cells refer to distinct columns in their own table. Nutrition verifies
the exact authorized photograph ID set. Persistent attachment IDs identify photos;
original bytes remain unchanged in private storage.

Vision inference uses the smaller `sourceTranscriptionSchema`: only authorized
photo IDs, original text, ordered headings/rows/cell slots and uncertainty.
`assignSourceIdentifiers` validates every row's slot count, checks photograph
membership and assigns stable source IDs/column relationships in TypeScript.
Models never generate internal source IDs. The persisted evidence remains version
1; transcription prompt/schema version 2 invalidates older inference checkpoints.

`indexSourceEvidence` builds a reference index; `sourceNumbers` enumerates original
numeric lexemes, preserving commas, trailing zeros and censoring. Interpretation
references cells and zero-based numeric token indices instead of supplying new
photographed numbers. Nutrition's schema/prompts/adapter live in
`pipeline-schema.ts`, `transcription.ts` and `interpretation.ts`. Explicit user
corrections retain separate trusted message IDs/text and never rewrite photographs.

## Nutrition and retries

`runProductExtractionPipeline` takes authorized model messages, photograph
occurrences, both explicit selections, separate corrections, optional checkpoint
and persistence callback, `rereadImages` and cancellation. Only vision receives
image bytes. Interpretation receives validated evidence and deterministic token
indexes. Its validated references resolve to original lexemes before the existing
normalizer handles decimals, units, per-100/serving arithmetic, printed precision,
RI exclusion, conflicts and Product validation.

Validated transcription is checkpointed before interpretation. Reuse requires the
same unique photograph IDs, vision model and pipeline/prompt/schema versions.
Attachments are immutable; changed photos receive new IDs. Text corrections and
interpretation retries can reuse transcription. Changed images/vision model,
explicit reread or recognized visual reread requests force fresh transcription.
No process-global private evidence cache is introduced.

Checkpoints are limited to 1 MiB, owner scoped and fenced by the active generation
token. Interpretation failure retains successful transcription. Completed message
retries replay saved suggestions; deliberate model/reread changes start new turns.
Only the latest incomplete turn can be retried.

`ProductSuggestion` remains version 1 with optional `pipeline`: original evidence,
interpretation references, separate corrections, field provenance and diagnostics.
Old suggestions remain valid. The review displays original tables, source cell/photo
links and actual models. Apply changes form state; Save uses the ordinary Product
service. Manual edits still require explicit replacement review.

## Limits, diagnostics and verification

Nutrition budgets: vision 240 seconds / 12,288 output tokens; interpretation
180 seconds / 8,192 tokens. Shared completion deadline: 540 seconds; generation
lease: 600 seconds. The tRPC route declares the completion duration and forwards
request cancellation. Provider transport honors explicit inference budgets.
Browser disconnect cancellation depends on the host forwarding request abort;
abandoned generations still expire under the lease.

Diagnostics retain models, prompt/schema/pipeline versions, starts, durations,
attempts, budgets, statuses, normalization validation failures and total duration.
Normal application logs contain no image/source/raw output data. Explicit opt-in
generation callbacks and the diagnostic CLI may expose private content; keep their
output private.

Jest covers source references, normalization, stage failures/retries/cancellation
and composer/conversation behavior. The PostgreSQL script creates synthetic
records in a temporary isolated schema and removes it afterward.

```sh
yarn tsx --conditions=react-server scripts/verify-extraction-stages.ts
yarn tsx --conditions=react-server scripts/verify-product-extraction.ts \
  gemma3:12b qwen3:8b front.jpg back.jpg
```

Other domains can reuse the composer, evidence schema and stage runner with their
own interpretation schema/reference checks and deterministic adapter. Persist only
validated checkpoints within an authorized lifecycle. `extractProductDirect` is
an explicit diagnostic/rollback export, never the automatic failure path.

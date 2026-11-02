# Packaged product extraction (#116, #118)

> **Deferred — 2026-10-28.** Packaging-photo extraction is no longer exposed in the
> normal product editor or feature model settings. The experimental implementation
> below is retained for a future retry; it is not production-ready. The reusable
> `AiPromptComposer` multiple-model-picker API remains available. See
> [agent handoff](agent-handoff.md) for the current checkpoint.


Extraction produces validated suggestions for human review. It never creates or
updates Product records. ProductEditor integration and selective application are
documented in [reviewed packaging import](PRODUCT_IMPORT_UI.md). No barcode lookup, external databases or meal/receipt recognition is included.

The default is now **vision transcription → text interpretation → deterministic
TypeScript normalization**, with independent inherited/explicit model choices.
Initial settings select Gemma 3 12B and Qwen3:8B. See
[reusable extraction APIs](AI_EXTRACTION_PIPELINES.md) for the composer, settings,
source schema, persistence, execution budgets and extension points. The original
single-model extractor remains an explicit diagnostic/rollback export, never an
automatic fallback.

## API for #117

Create/resume a conversation with `nutrition.productChat.createConversation` /
`getConversation`, as documented in [multimodal chat](MULTIMODAL_CHAT.md). Call the
protected mutation `nutrition.productChat.extract` with the existing `ChatInput`:

```ts
{
  conversationId,
  message: {
    id: stableUserMessageId,
    role: 'user',
    parts: [
      { type: 'text', text: 'Extract this product' },
      { type: 'data-attachment', data: { attachmentId: frontId } },
      { type: 'data-attachment', data: { attachmentId: backId } },
    ],
  },
}
```

The result is `{ messageId, suggestion: ProductSuggestion }`. Server callers can
use `extractProduct(userId, input, signal)` in
`lib/nutrition/product-extraction/service.ts`. The schema/types live in `schema.ts`.

- `product` is a **partial** ProductInput patch using existing field validators.
  Unknown nutrients are omitted; an extracted zero is the decimal string `"0"`.
  Required missing values still need manual entry before normal Product validation
  can succeed. `calculationMode` is DIRECT and `verificationStatus` is UNVERIFIED.
- `evidence` contains model observations, source units, all nutrition columns,
  per-field notes and statuses: printed, corrected (explicit user correction),
  uncertain or missing. These are model-reported evidence, not independently
  verified transcription. Null means unknown.
- `nutrition` contains each supported/observed nutrient normalized per 100 g/ml,
  with value, status and explanation. Status additionally includes calculated.
  Original values remain in evidence, including original corrected/printed status
  when the normalized result requires calculation.
- `warnings` explains missing/uncertain nutrients, unknown references, conflicts
  and label details that have no dedicated Product field.
- Optional `pipeline` retains original transcription, source-reference interpretation,
  separate user corrections, per-field provenance and actual stage models/timings.
  Old saved version-1 suggestions remain valid.

Persisted assistant parts include `data-productSuggestion` with the same validated
suggestion. Reload through `getConversation`; do not parse assistant prose. A
completed retry with the same user message ID replays the saved suggestion without
another inference. Failed turns can retry through the existing conversation lease
and message identity rules. A turn previously completed as ordinary chat cannot
be reinterpreted as extraction; use a new message ID.

For corrections send a new text-only user message to `extract` in the **same**
conversation, for example `The brand is Jumbo` or `Look again at the protein value`.
The shared store loads authoritative history and reauthorizes the photographs.
Unchanged validated transcription can be reused for text corrections or
interpretation retries. `rereadImages: true`, a visual reread request, changed
photographs or a changed vision model forces fresh transcription. Earlier
interpreted suggestions never become photographed evidence. The original
transcription and full suggestions remain available for audit. No repeated upload
is needed.

#117 should display evidence and warnings alongside individual selectable patches,
explicitly review package serving additions/merges and verification status, apply
selected fields to form state, then use the existing Product save path separately.
Never spread an entire patch over an existing product without review. Extraction
has no Product persistence authority. Existing product-conversation linking stays
in #114's service.

## Fields and deterministic normalization

Name, brand and aliases reuse existing fields. Visible variant and ingredients
are included in description, with original evidence retained. Known package size
becomes an optional named `package` serving; kg/l convert to g/ml. No Product schema
or migration is added. Ingredients are text, not recipe components.

Product nutrients are calories (kcal), protein, carbohydrates, fat and optional
fiber (grams). Sugars, saturated fat, salt and sodium remain separate evidence and
normalized review data because Product has no dedicated fields. Sodium is never
substituted for salt or converted into it.

Dutch/English labels and decimal commas/points are supported. Application Decimal
arithmetic, using the existing stored-nutrition rounding/range validator, converts
kJ to kcal using 4.184 kJ/kcal and mg to g. Known per-serving physical sizes convert
to per-100 values; unknown, estimated or ambiguous sizes do not. Package size is
never used to infer serving size. Weight/volume conversion never infers density.

Printed per-100 values take precedence over equivalent serving columns. Conflicting
same-basis values withhold that nutrient. For serving comparisons, tolerance is
at least 1 kcal or 0.1 g per 100, widened only by the combined half-step rounding
intervals implied by each printed value's decimal precision, converted into the
same per-100 unit. Trailing zeros matter: 5.8 g per 25 g may agree with 23.0 g per
100 g, while 5.80 g is more precise and may conflict. Same-basis disagreements
remain strict. Fractional serving weights also propagate half a last printed
decimal step through the division (e.g. 4.2 g has a 0.05 g half-step); integral
serving references retain their defined value. Trailing zeros in serving weights
are preserved, so 4.20 g implies a tighter interval than 4.2 g. These intervals
only control consistency checks; they do not fill missing nutrient values.
Paired kJ/kcal tolerate the larger of 2 kcal or 1% for printed
rounding. Larger disagreements withhold energy. Conflicting g/ml references
withhold all applicable nutrients. Censored values such as `<0.5`, ambiguous number
formats and unreadable values are retained as uncertain, without fabricated digits.
Uncertain or conflicting readings in comparable physical columns withhold the
affected nutrient. An extra column with an unusable reference does not invalidate
an independently usable, readable per-100 observation: it is excluded with a warning
and retained for review. Serving-only conversions remain withheld when an additional
physical reference is unresolved. This distinction avoids calling an incomparable
secondary column a contradiction.
The extraction instructions distinguish physical per-100/per-serving columns from
RI/%DV reference-intake percentages, preserve printed precision and require matching
each value to its nutrient row and column heading. RI percentages are not nutrient
amounts; they remain separate evidence and never enter quantity conversion.
Original tables remain available for human review.

## Shared AI and security boundary

`createChatService.completeTurn` reuses `beginTurn` / `finishTurn` for owner/scope
checks, serialized turns, model attribution, attachment retention, stable reply
IDs, retries and lease protection. It uses `reconstructModelMessages` from #114,
which resolves every image through authenticated attachment retrieval, deduplicates
reads and sends bytes, never internal storage paths or arbitrary client URLs.
Before inference, camera EXIF rotation/mirroring is applied to a temporary model-only
copy. A browser may display the original upright while a model decoder reads its
sideways stored pixels; physically orienting those pixels avoids that mismatch.
Upright images pass through unchanged; transformed JPEGs use quality 95 and 4:4:4
chroma, while other transformed formats use lossless PNG. No resizing/cropping is
introduced, and stored originals/attachment downloads are unchanged.
All images in history are sent together, with existing limits of eight images per
message and sixteen references per conversation. Structured suggestion text counts
toward the existing conversation context limit.

The vision stage requires chat and vision capabilities; interpretation requires
chat only. Selections inherit the two Nutrition settings or independent saved
conversation overrides. Attachments are authorized by the shared image resolver.
`generateStructured` now accepts multimodal model messages as well as existing text
prompts. It uses Vercel AI SDK `generateText` / `Output.object`, then validates with
Zod. The installed Ollama provider passes the JSON schema as Ollama's `format`.
[Ollama documents schema-constrained vision output](https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx);
[AI SDK documents schema validation](https://ai-sdk.dev/docs/reference/ai-sdk-core/output).

Generation uses temperature zero, with separate 240-second/12,288-token vision
and 180-second/8,192-token interpretation budgets inside a 540-second shared
deadline. Provider retries are disabled by default. Invalid output/source
references fail the relevant stage with a safe error and retained transcription
where available. The shared stage runner supports bounded same-model retries for
callers that explicitly request them. No automatic model fallback or raw payload
logging is introduced. The earlier single-model verification below is historical;
current two-stage verification is recorded in the shared handoff.

## Verification and limitations

Normal Jest fixtures/tests cover Dutch and English label observations, front/back
model-message reconstruction, decimal commas, per-100 g/ml, serving conversion,
kJ/kcal, mg, sodium versus salt, unknown/unreadable values, contradictions,
validation failures, owner checks, retries, model failures and corrections.

Opt-in real-model check (not part of Jest; requires configured OLLAMA_BASE_URL):

```sh
yarn tsx --conditions=react-server scripts/verify-product-extraction.ts \
  gemma3:12b qwen3:8b front.png back.png additional-photo.webp
```

The script accepts one to eight local photos and makes no database writes. It
prints extracted content only because this is an explicit local diagnostic. The
application API always uses authorized attachment IDs instead of local file paths.
Synthetic SVG front/back fixtures are in
`lib/nutrition/product-extraction/fixtures/`; render to PNG with Sharp for provider
checks. They intentionally omit fiber.

On 2026-10-25, installed `gemma3:12b` successfully extracted both rendered synthetic
fixtures together: Jumbo Halfvolle melk, 1 L, 47 kcal, protein 3.5 g,
carbohydrates 4.7 g and fat 1.5 g per 100 ml; missing fiber stayed missing.
This demonstrates the installed provider's schema/vision pipeline, not accuracy
on real photographs. Blurry tables, small digits, glare, conflicting packages and
instruction compliance still depend on the model. Schema validity cannot establish
that a printed-looking value is true; every suggestion requires review. A model
can omit a visible field or misread a digit. No automatic verification is implied.

A second live turn reused the same synthetic photographs and prior suggestion.
`gemma3:12b` applied explicit brand and 400 ml package corrections, reread protein
as 3.5 g per 100 ml and preserved missing fiber. Both provider checks bypassed
persistence intentionally; deterministic shared-lifecycle tests cover owner checks,
attachment resolution, persistence callbacks and replay. Browser smoke reached the
existing Nutrition route without page errors and unauthenticated extraction
returned 401. Signed-in ProductEditor workflow acceptance belongs to #117.

Final automated validation: 188 Jest suites / 1,557 tests passed; four opt-in
suites / 16 tests skipped. Typecheck and changed-file Oxlint/format checks passed.
Repository-wide lint retains unrelated existing auth, Planner and UI failures.
Next.js runtime diagnostics reported no current configuration/session errors.


## Phone-photo correction (2026-10-25)

A real phone JPEG pair exposed EXIF orientation=6 on both images. Passing original
bytes produced badly misaligned nutrient rows/columns; clearer instructions alone
still misread digits. With physically upright model-only copies, the same installed
model read all five Product nutrients correctly in this diagnostic. The label also
exposed legitimate 25 g serving rounding for protein/fiber, now handled by printed
precision intervals. Tests cover rotation/mirroring, unchanged stored bytes,
authorized/cached model preparation, decimal precision, and retained rejection of
real contradictions. This is evidence for the specific failure, not an accuracy
guarantee; ingredient transcription still requires human review. Saved earlier
suggestions are not rewritten—request a fresh review in the same conversation.


## Physical column contract correction (2026-10-25)

A later authenticated app run exposed a separate failure: every amount was read
correctly, but the model classified the per-25-g column as a second per-100-g
column. The deterministic conflict rejection was correct. Earlier standalone
successes were insufficient evidence for the running application workflow.

Inference now uses `columnExtractionSchema`, separate from stored canonical
evidence. Nutrition comes first and uses fixed nutrient keys (including separate
kcal/kJ energy fields), with at least one explicit column. The model copies each
physical heading; application code derives per-100 versus serving. Numeric headings
and exact `per 100 g` / `per 25 ml` / `blokje (4,2 g)` forms are accepted with matching physical units;
unknown, ambiguous or contradictory headings withhold quantities. A known unit in
a literal heading can supply an otherwise missing reference unit. Notes and ratios
are not used to guess a column basis.

The per-100 column is preferred; equivalent serving/RI columns may be omitted.
When RI/%DV columns are returned, their dimensionless values remain separate
`referenceIntake` evidence with `%` units and never participate in quantity
normalization or poison a readable physical column. Unresolved physical columns are retained for review; they block serving-only
conversions but no longer poison an independently readable per-100 value. This is an additive canonical evidence vocabulary;
older stored suggestions remain readable and are not automatically rewritten.
Empty/incomplete inference tables fail schema validation rather than producing a
misleading success with no extracted table. An explicit all-missing column is
allowed for genuinely unreadable labels. Package serving counts must not be
interpreted as printed package weights.

Verification used the exact uploaded pair through the running 375 px ProductEditor,
actual private uploads, persisted synthetic conversations and HTTP extraction:
two fresh conversations and a text-only follow-up all returned the five expected
Product nutrients. Forms remained unchanged, no Products were saved, and browser
runtime errors were absent. This is a small real-photo regression sample, not a
universal OCR accuracy claim. Continue reviewing every result against its source.


## Named servings and remaining model errors (2026-10-27)

A chocolate-label photo pair exposed a serving reference transcribed as `blokje`
with its `4,2 g` size left in a note. The secondary column could not be converted,
and the previous policy withheld every nutrient despite the usable per-100 column.
Complete named headings with explicit parenthesized g/ml are now parsed directly.
Names alone, arbitrary notes, ambiguous headings, package weights and serving
counts never supply an assumed portion size. Explicit conflicting units are still
rejected. The inference schema description/prompt asks for the complete heading.

A correct reading of that label also needs fractional-serving-weight rounding for
its energy comparison. The normalizer now includes that printed precision while
retaining real conflicts. Warnings distinguish incompatible g/ml references,
invalid/uncertain readings and actual conflicting normalized numbers, replacing
the previous blanket ambiguity message.

This change addresses normalization failures. The same model still misread the
brand and some nutrient digits on this second product. Those failures are not
fixed by adjusting arithmetic or accepting conflicting observations. All suggested
fields require review against the original photos, and unresolvable values remain
unknown. The earlier single-product successes are regression evidence, not proof
of dependable OCR across packages.

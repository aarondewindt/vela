# Reviewed packaging import (#117)

> **Deferred — 2026-10-28.** Packaging-photo extraction is no longer exposed in the
> normal product editor or feature model settings. The experimental implementation
> below is retained for a future retry; it is not production-ready. The reusable
> `AiPromptComposer` multiple-model-picker API remains available. See
> [agent handoff](agent-handoff.md) for the current checkpoint.


The #118 upgrade adds independent **Vision transcription** and **Text
interpretation** pickers to the same composer. Each supports inherited settings or
a saved conversation override. Changing one preserves the other, pending text,
photos and manual form edits. The explicit reread control invalidates cached
transcription; text-only interpretation/correction can otherwise reuse it. Review
shows original source tables, cell/photo links, separate user corrections and
actual stage models. See [pipeline APIs and settings](AI_EXTRACTION_PIPELINES.md).

ProductEditor offers the shared image composer above the ordinary direct-nutrition
form. Recipe calculation and manual product entry keep their existing save and
validation paths. No new API or database migration is introduced by #117: the UI
uses #114's owner-scoped product conversations, #115's private uploads/camera
capture and #116's structured extraction mutation.

## Review and form safety

Every response remains a suggestion. Select fields, then **Apply selected
suggestions**; **Save product** is a separate action. **Select non-conflicting**
excludes any field edited manually or applied earlier in this editor session.
Explicit selection of a conflicting field requires a second replacement
confirmation. Rejection leaves the form intact. Warnings, normalized nutrient
statuses and expandable original label observations stay visible for comparison
with the photographs. They are model observations, not verified transcriptions.

Nutrition values and their reference quantity/unit form one review group. Changing
the reference clears unavailable nutrients rather than retaining numbers from a
different basis; normal Product validation requires the missing mandatory values
before saving. With the same reference, unavailable nutrients are left intact.
Package servings merge with unrelated existing servings, and same-name replacement
remains an explicit review action. No client-side nutrient conversion is added.

## Conversation lifecycle and failures

The first submission creates a server draft. New-product editors offer explicit
selection of unlinked conversations after cancel/navigation/reload. Existing
products automatically load their newest conversation and allow selecting other
associated histories. Choosing history never applies its suggestions. Sent prompts,
images and suggestions persist; unsaved form edits and unsent uploads are local
and do not survive reload. Closing an unsaved editor leaves its server draft
recoverable. Attachment retention/pruning follows [multimodal chat](MULTIMODAL_CHAT.md).

Follow-up extraction uses the same conversation and authoritative image history.
Each response presents a fresh review; earlier accepted fields are protected as
edited values. Extraction failures preserve pending prompt/uploads, and unchanged
retries reuse the same message identity. Upload errors retain individual retry and
remove controls. Model errors leave the ordinary product form usable.

After explicit Product save, the conversation is linked through the existing
owner-checked, idempotent API. If linking fails, the editor retains the newly saved
Product identity and version: retry updates that Product instead of creating a
duplicate. The error explains that the Product is already saved. A reload during
this two-request boundary may leave a recoverable unlinked conversation; no
cross-request transaction is claimed. Existing-product extraction also confirms
its association before sending. The server prohibits moving a conversation to a
different Product.

## Validation

`ProductImport.test.tsx` is a component integration test using the actual
ProductEditor, composer, upload hook, review and validation with mocked transport.
It covers sequential two-photo capture through explicit save/link, conflicts,
follow-up/rejection, restored images, server-draft recovery, extraction retry and
failed first-save linking without duplicate creation. Review domain tests cover
unit/basis changes, missing values and serving preservation; existing composer
and editor tests cover upload errors and manual/recipe saves.

Live browser checks used an isolated synthetic account, actual private uploads,
PostgreSQL persistence and the installed vision model with synthetic packaging
fixtures. At 375 px, two camera-file selections produced reviewed 47 kcal, 3.5 g
protein, 4.7 g carbohydrates and 1.5 g fat per 100 ml; missing fiber stayed unknown.
Explicit Apply and Save were exercised. At 1280 px, reopening restored both images;
a real follow-up used previous images and proposed a corrected brand. Rejecting
it preserved the form, and reload retained the correction conversation. No
horizontal overflow or browser runtime errors were observed. This establishes the
application pipeline, not accuracy on real supermarket photographs.

### Physical phone acceptance

1. Open Vela over HTTPS on the phone, sign in, and choose Nutrition → Create product.
2. Select an installed image-capable model. Tap **Take photo** for the package front,
   then again for the nutrition table; confirm both thumbnails. Add another image
   if glare/small text requires it. Verify ordinary multi-file upload too.
3. Submit. Compare every digit/unit with the photos and review missing/uncertain
   values and original observations. Try an unreadable label; unknown values must
   remain unknown and any model misreading must be rejected manually.
4. Type a manual brand edit before applying. Select non-conflicting suggestions;
   confirm that brand stays intact. Explicitly select brand and verify the
   replacement confirmation. Apply reviewed values, manually correct as needed,
   then separately Save product.
5. Reopen the product, expand history and inspect both full-size images. Send a
   text-only correction about brand/package size/per-100-ml reference; review or
   reject the new result and reload to confirm history retention.
6. Create another unsaved import, cancel, reload and explicitly select its draft.
   Verify it is never attached to a different Product. Interrupt connectivity during
   upload/extraction: prompt/photos and form edits should remain available for retry.
7. Verify keyboard and camera behavior, touch targets, dark/light appearance and
   scrolling with the phone's browser controls/virtual keyboard. A browser that does
   not support camera capture falls back to its file picker; no Companion App is
   required.

Physical camera hardware, glare, real packaging accuracy and mobile virtual-keyboard
behavior require this manual check; desktop automation cannot establish them.

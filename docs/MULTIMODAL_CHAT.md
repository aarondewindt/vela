# Multimodal chat and Product conversations (#114)

The existing `AiConversation` / `AiMessage` store and AI SDK streaming service now
support ordered mixed text and private image references. Text-only JSON remains
compatible; no message data migration is needed. Each image part is:

```ts
{ type: 'data-attachment', data: { attachmentId: '<upload UUID>' } }
```

Text parts retain their existing `{ type: 'text', text }` representation. A user
message may contain only images, or any ordering of text and images. Limits are
32 parts / 16,000 text characters / 8 images per message and 100 messages / 64,000
text characters / 16 image occurrences per model history. Message IDs, positions,
retry rules, generation leases and response statuses retain their existing behavior.
Planner workspace chat remains text-only because it uses bounded text context.

`beginTurn` retains all history references through `retainAttachments` inside the
same short transaction that saves the message and response placeholder. Invalid,
foreign or deleting uploads roll back the turn. Files are never copied. The server
loads persisted history, checks the selected model's chat and vision capabilities
using #112, retrieves each distinct attachment through the owner-scoped storage
service, and converts custom data parts to AI SDK binary file parts in their
original order. This uses the SDK's
[custom data conversion](https://ai-sdk.dev/docs/reference/ai-sdk-ui/convert-to-model-messages).
Camera EXIF orientation is applied to temporary model input copies, so model
decoders see the same upright pixels as browser previews. Original stored files
and private downloads remain unchanged. Only the server-side model request contains bytes; saved messages and client
responses contain IDs. No remote URLs, base64 payloads, MIME claims or storage
paths are accepted as image references. Missing files fail with the attachment
service's safe 404, and the generation is marked failed for retry. Earlier photos remain in follow-up prompts. For product suggestions, only prior
proposed fields are sent as explicitly unverified context; obsolete model OCR tables
and warnings stay in saved history without being repeated as model evidence. #112's model middleware also guards provider inputs
and converts image files for Ollama; future providers can use the same SDK messages.

## Product lifecycle and API

`nutrition-product` is another scope of the shared chat infrastructure, isolated
from AI Dev and Planner. The `nutrition.productImport` model feature defaults to
the existing vision-language profile. A nullable Product FK on `AiConversation`
is sufficient for this first entity association; no polymorphic entity framework
is introduced. Multiple conversations can belong to a Product.

Protected tRPC procedures under `nutrition.productChat`:

- `createConversation({ selection: null | { provider, modelId } })` creates an
  unlinked draft and returns `{ id }`. Creation does not require a Product.
- `getConversation({ id })` returns ordered saved UI messages, model settings,
  generation status and nullable `productId`.
- `listConversations()` includes linked and unlinked drafts, so callers can offer
  draft recovery or deletion after navigation/reload.
- `linkProduct({ id, productId })` links an existing conversation after the Product
  has been explicitly saved. Both records must belong to the caller. Repeating
  the same link is safe; moving a linked conversation to another Product fails.
- `listForProduct({ productId })` returns saved conversation references, newest
  first. Load the selected history with `getConversation` when reopening an editor.
- `changeConversationModel({ id, selection })`, `deleteConversation({ id })` and
  `listChatModels()` reuse existing model switching, deletion and discovery.

`POST /api/nutrition/product-chat` accepts the same `{ conversationId, message }`
input and returns the same AI SDK UI stream as `/api/ai-dev/chat`. Both routes use
one HTTP handler with Better Auth, same-site checks and redacted errors. Images
are uploaded separately through [the attachment API](ATTACHMENTS.md), then passed
by UUID. This issue supplies persistence and transport; upload/camera composition
(#115), structured suggestions (#116) and ProductEditor integration (#117) remain
separate. No AI result saves or applies Product fields in this implementation.

Archiving a Product preserves the association. Physical Product deletion uses
`ON DELETE SET NULL`, preserving the conversation as an unlinked draft. Deleting
an abandoned draft cascades its messages. As in #113, retained images remain
permanently retained, including after conversation deletion: deleting one chat
must not destroy an image reused by another consumer. Never-retained uploads are
eligible for normal seven-day pruning. Reference-aware release/erasure remains
future work; operators should account for retained storage growth.

## Deployment and validation

Apply `20261025170000_product_conversations` with `yarn prisma migrate deploy` and
run `yarn prisma generate`. Keep the database and private attachment directory
persistent and back them up together as described in ATTACHMENTS.md.

Focused Jest tests cover mixed-part validation, serialization, owner isolation,
retention failure, model rejection, association and authenticated HTTP/tRPC calls.
Run `yarn tsx --conditions=react-server scripts/verify-multimodal-chat.ts` for real
PostgreSQL, filesystem and AI SDK conversion checks without model inference. It
creates an isolated schema, applies the repository migrations, uses synthetic
users/products/photos and removes the schema and temporary files afterward. The
database role needs schema-creation privileges. A fresh store and file backend
restore saved photos, exercise follow-up context, verify retention rollback and
check Product/conversation deletion. Live Ollama vision inference remains covered
by `scripts/verify-vision.ts` from #112.

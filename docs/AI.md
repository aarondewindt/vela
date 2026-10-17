# Shared AI infrastructure

Phase 1 adds server-only Ollama infrastructure in `lib/ai/`. It is independent of AI Dev, Prisma, tRPC and UI code. Phase 2 adds the AI Dev chat consumer, Phase 3 adds owner-scoped conversation persistence, and Phase 4 adds the temporary embeddings playground. All four implementation phases are complete.

## Configuration

Set `OLLAMA_BASE_URL` in the server environment. Either an origin such as `http://your-host:11434` or a URL ending in `/api` is accepted. Reverse proxy path prefixes are preserved. Credentials, query parameters and fragments are rejected. There is no implicit localhost fallback.

The dev container receives environment variables from `vela.env` when it is created. Recreate the container after changing that file, or supply the variable through Next.js's local environment configuration when restarting the development server. Next.js does not automatically load `vela.env`.

When Ollama runs on the host PC, `localhost` inside the container points to the container. Prefer a static LAN address or stable hostname; a configured host gateway alias is another option. Ollama must listen on an interface reachable from the container. A numeric Docker gateway can change when the network is recreated.

Configuration is validated only when an AI function is called, so missing configuration or an offline provider does not prevent the normal application from starting. The provider address is never exposed through a `NEXT_PUBLIC_` variable.

## Server API

```ts
import { discoverModels, resolveChatModel, resolveEmbeddingModel } from '@/lib/ai';

const models = await discoverModels();
const chat = models.find((model) => model.capabilities.includes('chat'));
if (chat) {
  const model = await resolveChatModel({ provider: chat.provider, modelId: chat.id });
  // Pass model to the AI SDK from an application service.
}

const embeddingModel = await resolveEmbeddingModel({
  provider: 'ollama',
  modelId: 'qwen3-embedding:0.6b',
});
// Pass embeddingModel to the AI SDK from the consuming application service.
```

Discovery uses `GET /api/tags` and `POST /api/show`, with at most four concurrent inspections. It reads model metadata without generating text or loading model weights. Ollama's `completion` capability maps to `chat`, and `embedding` maps to `embedding`. Unknown capabilities are not guessed from model names; models with neither supported capability remain discoverable with an empty capability list. Servers that omit capability metadata return an explicit error.

Both resolvers check the exact installed model ID (including its tag) and requested capability before constructing an AI SDK model. They inspect only the selected model. Discovery and resolution read fresh metadata without Next.js fetch caching. A future provider can be added behind the same entry point without importing AI Dev code; no provider registry or agent framework is needed yet.

Metadata requests have a 10-second deadline; inference requests have a 120-second deadline and preserve caller cancellation. Discovery calls do not retry automatically. AI SDK callers own inference retry policy and overall operation deadlines. HTTP and network failures, invalid responses, configuration errors and invalid model selections throw `AiError` with a stable `code`. Provider response bodies and raw network errors are not included in these messages. SDK inference responses retain the SDK's own error handling.

API adapters must authenticate callers, validate input and map errors to their transport's error types. Future AI tools must delegate state changes to Vela's deterministic application services.

## AI Dev chat

Open `/ai-dev` from the application navigation and sign in with a normal Vela account. The page checks the server-side Better Auth session before rendering the chat view. There is no separate administrator role. `aiDev.listChatModels` is a protected tRPC query over the shared discovery service and returns only chat-capable models.

Select a model and click **Start conversation** to create a saved conversation. Use **Saved conversations** to reopen one after leaving or reloading the page. Provider and model selection are fixed for each conversation; **New conversation** opens a draft where another model can be chosen. **Delete** confirms removal of the conversation and its messages. Titles are derived deterministically from the first user message, without an AI naming request.

Enter sends; Shift+Enter adds a line. AI SDK UI `useChat` owns the active stream, while tRPC/TanStack Query loads and refreshes saved history. Fresh authorized reads are required before cached conversation data is displayed after mounting. Text renders without Markdown, attachments, reasoning displays or tools. The user can stop generation, retry an incomplete response, or continue a restored conversation.

`POST /api/ai-dev/chat` verifies the session, rejects cross-site requests and non-JSON content, and validates a conversation UUID and a single text-only user UI message. The transport sends the latest user message, including its stable ID. Provider selection and previous messages are loaded from PostgreSQL; client-supplied history and model settings cannot replace them. Origin checks use the external Host header because Next.js may use an internal hostname in `request.url`. User messages are limited to 16,000 characters; the server checks the loaded inference context against 100 messages and 64,000 text characters.

Generation is capped at 2,048 output tokens and 120 seconds, with automatic inference retries disabled. Cancellation is forwarded to the SDK and shared provider. Responses use the SDK UI stream protocol and `private, no-store` caching. Safe model-selection, ownership and concurrency errors are returned to the client; unknown server and mid-stream provider failures are masked. SDK provider-error logging is disabled because errors are surfaced through the UI stream.

## Conversation persistence

`AiConversation` stores its owner, title, provider/model selection and generation lease. `AiMessage` stores structured JSONB message parts, role, position, response status and the user message it answers. Composite keys enforce unique message IDs, positions and replies within a conversation. The additive migration is `20261017183136_ai_dev_conversations`; run the normal Prisma migration workflow and regenerate the client when setting up another database.

All conversation operations use the authenticated user ID. List, read, delete, generation setup and finalization are owner-scoped. Missing and foreign conversations both return not found. Deletion cascades to messages, and completion callbacks cannot recreate deleted conversations.

Before inference, a short transaction claims the conversation, validates the existing turn and saves the user message plus an assistant placeholder. Network/model calls happen outside transactions. The server assigns a stable assistant ID and uses it in the UI stream. A duplicate completed request replays the saved reply without inference; retrying a failed or interrupted turn reuses both message rows and replaces the incomplete assistant response. Reusing a message ID with different content is rejected. Older incomplete turns cannot be rewritten after later user messages.

Only one generation can run per conversation. Concurrent attempts receive a conflict. A three-minute lease bounds abandoned generations; an authorized read or subsequent turn marks expired placeholders interrupted. Each completion must match the current generation token, so a late callback cannot overwrite a newer attempt or clear its lease. There are no background recovery jobs.

SDK stream completion/cancellation persists structured response parts and a `COMPLETED`, `INTERRUPTED` or `FAILED` status. Partial text is saved when cancellation/disconnection reaches the server. A process crash can lose partial text that has not reached finalization; the saved user message and placeholder remain recoverable after lease expiry. There are no per-token database writes. Saved text-part state is normalized for restoration, and empty or failed assistant content is omitted from inference history. A storage failure is surfaced as an error rather than treating the response as durably saved.

The implementation uses `@ai-sdk/react@4.0.146`, matching `ai@7.0.142`. Persistent embedding storage is separate future work.

Phase 3 was verified on 2026-10-17 with 117 Jest tests, typecheck, changed-file lint/format checks and a production build. Thirteen live PostgreSQL checks covered cross-user denial, concurrent requests, retry deduplication, authoritative history, lease recovery, stale callbacks and cascading deletion; temporary fixtures and the verification route were removed. Browser checks with the authorized test account confirmed streamed persistence, restoration after reload, continued context, interrupted-response retry and confirmed deletion. Retrying an interrupted three-turn conversation preserved its six rows and assistant ID; a subsequent completed-response replay returned the saved ID and a complete SDK UI stream without adding rows. Repository-wide lint still reports errors in untouched planner/UI/auth files.

## Embeddings playground

Open **AI Dev → Embeddings** at `/ai-dev/embeddings`. Like chat, the page checks the server-side Better Auth session. Select an installed embedding-capable model explicitly; there is no default application model. The navigation groups Chat and Embeddings under AI Dev.

`aiDev.listEmbeddingModels` is a protected tRPC query using shared discovery. The protected `aiDev.generateEmbedding` and `aiDev.compareEmbeddings` mutations validate inputs and delegate to `lib/ai-dev/embeddings.ts`. That service resolves the selected model through `lib/ai/` and calls AI SDK `embed` or `embedMany`. Comparison embeds both texts with the same resolved model and computes cosine similarity over the complete vectors on the server. Only dimensions and the first 16 values of each vector are returned, alongside the provider/model selection and comparison score.

Each text must be nonblank and at most 16,000 characters. Inputs are sent exactly as entered, with no automatic instructions, prefixes, normalization or chunking. Ollama truncation is disabled, so inputs exceeding the model context fail rather than producing a silently shortened embedding. Inference has a 120-second deadline and automatic retries are disabled. Model/capability errors, rejected inputs and generation failures surface safe messages without provider payloads. Invalid, non-finite, mismatched or zero comparison vectors are rejected; rounding at the cosine bounds is clamped to `[-1, 1]`.

The Mantine view uses tRPC/TanStack mutations for temporary results and local component state for text/model selection. It shows loading, empty and error states, disables changes during inference, and clears affected results when text or model selection changes. Mutation results are discarded after unmounting; there are no database writes or persistent vectors. Similarity is displayed as a raw cosine score, not a probability or a calibrated matching threshold.

Phase 4 was verified on 2026-10-17 with all 154 Jest tests (15 suites), typecheck, changed-file Oxlint/Stylelint/format checks and a production build. Browser checks with the authorized test account and `qwen3-embedding:0.6b` confirmed 1,024 dimensions, a 16-value preview, identical-text similarity `1.000000`, different-text comparison and result invalidation after editing. Signed-out discovery/generation returned 401; blank/oversized inputs, a missing model, a chat-only model and an empty comparison input returned 400. Desktop and 390-pixel layouts were inspected; the narrow layout had no horizontal overflow. The test browser was signed out and closed afterward. These checks verify functionality, not retrieval quality for a future application feature.

## Embedding configuration ownership

The agreed direction for future persistent embeddings is **one embedding configuration per collection/vector table**, with independent configurations for different collections. Vela must not require one global embedding model. For example, ingredient matching and document search can each select a model and settings suited to their own collection. The current resolver already takes an explicit model selection on every call and imposes no global embedding default.

Store or reference the configuration once at the collection level. Every vector in that collection must use it; rows do not choose their own model. A configuration can be reused by multiple collections, but a collection has only one active configuration. This is a persistence design constraint for future work, not a database-backed configuration system implemented in Phase 1.

The configuration should identify the provider, exact model ID, immutable model revision or digest where available, output dimensions, and settings that affect vector generation. Include the versions of document preprocessing/chunking and any query/document instructions or prefixes. A query and a document can use different input formatting when the configuration explicitly defines that pair. Model tags alone are insufficient to detect model replacement, and matching vector dimensions alone do not establish compatibility.

Indexing and query services must both resolve the collection's active configuration. Validate dimensions and configuration identity before writes and searches. A caller must not select an arbitrary query model for an existing collection, and a provider failure must not silently trigger a different embedding model.

Changing any vector-affecting setting requires a full reindex of the collection/table. Treat the active configuration as immutable while its vectors are in use. Rebuild every vector from source data, validate the complete replacement, and activate the new configuration and vector set together. Never expose a partially converted collection or compare vectors across configurations. The reindex implementation must either make the collection unavailable during an in-place rebuild or build a separate replacement table/collection before switching. Mixed-model rows within a table, partial model migrations and query-time handling of multiple models in one collection are outside the intended design.

The AI Dev embeddings playground may select models freely because it has no persistent collection. It should not establish a global application default. Persistent vector storage, configuration records and reindex machinery remain future work outside the initial playground phases.

## Dependencies and checks

The initial dependency set is `ai@7.0.142`, `ollama-ai-provider-v2@4.0.1` and `server-only@0.0.1`, with exact resolutions recorded in `yarn.lock`. AI SDK 7 requires Node.js 22 or newer; the development container uses Node.js 24. The AI SDK patch was selected to satisfy Yarn's release quarantine policy.

Run focused unit tests with `yarn jest --runInBand lib/ai/ollama.test.ts`. They mock the provider and network; they do not require Ollama or a database. Live discovery and inference should also be verified from a Next.js server runtime after configuration changes.

Phase 1 was verified on 2026-10-17 against Ollama 0.40.6 and `llama3.1:8b`: discovery, text generation, text streaming and rejection of a chat-only model for embeddings succeeded in a temporary guarded Next.js route. After the user installed `qwen3-embedding:0.6b`, a second Next.js check verified capability discovery, model resolution, AI SDK `embed` and `embedMany`, and cosine similarity. All three generated vectors had 1,024 finite dimensions; comparing the same input across single and batch calls gave cosine similarity approximately 1. Retrieval quality and task-specific input formatting still need evaluation for each consuming feature.

Both temporary verification routes were removed afterward. The checks explicitly loaded only the Ollama setting from `vela.env` to accommodate the running development server's existing environment.

# Shared AI infrastructure

Phase 1 adds server-only Ollama infrastructure in `lib/ai/`. It is independent of AI Dev, Prisma, tRPC and UI code. Phase 2 adds the AI Dev chat consumer. Conversation persistence and the embeddings playground are later phases.

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

Select a model and send plain text. Enter sends; Shift+Enter adds a line. AI SDK UI `useChat` owns the transient messages and stream status. A stable `DefaultChatTransport` sends the current model selection with each request, including retries. Text renders without Markdown, attachments, reasoning displays or tools. The user can stop generation, retry a failed response or start a new conversation. Starting a new conversation cancels the current request, creates fresh chat state and preserves the selected model. Leaving or reloading the page clears conversation history.

`POST /api/ai-dev/chat` verifies the session, rejects cross-site requests and non-JSON content, validates text-only user/assistant history, and delegates to `aiDevService.streamChat`. Origin checks use the external Host header because Next.js may use an internal hostname in `request.url`. Client-supplied system messages, tools and attachments are rejected. API input limits are 100 messages, 16,000 characters per text part and 64,000 text characters across the request. Oversized conversations receive an error directing the user to start a new one.

The service resolves the selected chat model and converts structured UI messages to model messages. It omits empty assistant messages left by interrupted generations. Generation is capped at 2,048 output tokens and 120 seconds, with automatic inference retries disabled. Request cancellation is forwarded to the SDK and shared provider. Responses use the SDK UI stream protocol and `private, no-store` caching. Known discovery/model-selection errors are returned as safe messages; unknown server errors and mid-stream provider failures are masked. The SDK's default provider-error logging is disabled because the error is surfaced through the UI stream instead.

The implementation uses `@ai-sdk/react@4.0.146`, matching `ai@7.0.142`. Tests cover the page's client interactions, request validation, API authentication/errors, service streaming configuration and protected model discovery. Persistence, conversation deletion and ownership of saved conversations remain Phase 3 work.

Phase 2 was verified on 2026-10-17 with the authorized test account and `llama3.1:8b`: streaming, follow-up context, cancellation, reset and recovery after a simulated network failure succeeded in the browser. Mobile layout and anonymous API rejection were also checked. All 93 Jest tests, typecheck, changed-file lint/format checks and the production build (`NODE_ENV=production yarn build`) pass. Repository-wide lint still reports errors in untouched files.

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

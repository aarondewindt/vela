# Shared AI infrastructure

Phase 1 adds server-only Ollama infrastructure in `lib/ai/`. It is independent of AI Dev, Prisma, tRPC and UI code. Phase 2 adds the AI Dev chat consumer, Phase 3 adds owner-scoped conversation persistence, and Phase 4 adds the temporary embeddings playground. All four implementation phases are complete.

## Configuration

Set `OLLAMA_BASE_URL` in the server environment. Either an origin such as `http://your-host:11434` or a URL ending in `/api` is accepted. Reverse proxy path prefixes are preserved. Credentials, query parameters and fragments are rejected. There is no implicit localhost fallback.

The dev container receives environment variables from `vela.env` when it is created. Recreate the container after changing that file, or supply the variable through Next.js's local environment configuration when restarting the development server. Next.js does not automatically load `vela.env`.

When Ollama runs on the host PC, `localhost` inside the container points to the container. Prefer a static LAN address or stable hostname; a configured host gateway alias is another option. Ollama must listen on an interface reachable from the container. A numeric Docker gateway can change when the network is recreated.

Configuration is validated only when an AI function is called, so missing configuration or an offline provider does not prevent the normal application from starting. The provider address is never exposed through a `NEXT_PUBLIC_` variable.

## User model settings

**Settings → AI & models** (`/settings#ai-models`) stores account-wide model preferences in PostgreSQL through protected `settings` procedures. Settings follow the user across devices; TanStack Query owns their client cache. `lib/model-settings/schema.ts` defines the finite feature/profile registry, boundary schemas and pure resolution. `service.ts` owns persistence and resolution for application consumers; `lib/ai/` remains independent of Prisma and receives explicit selections.

The account has **Default LLM**, **Fast**, **Balanced / Medium**, **Reasoning**, **Vision language** and **Embeddings** choices. Fast/Balanced/Reasoning inherit Default LLM when unset. Vision language requires reported chat and vision capabilities; Embeddings requires an embedding model and never falls back to a text LLM. Profiles select models, not inference parameters: structured meal interpretation still disables thinking. Model capabilities come from provider metadata, not inferred names or sizes.

Feature settings cover Planner day planning, Nutrition meal interpretation and recipe autofill, AI Dev chat and the embeddings playground. Each can inherit its assigned profile, explicitly select a compatible profile, or override with a specific model. Resolution is **conversation/draft override → feature choice → profile → Default LLM** where compatible. Unset values inherit; an unavailable configured model remains authoritative and produces an explicit error rather than falling through to a different model. Nothing picks the first installed model automatically.

New conversations and meal drafts start on **Use settings**. An inherited selection is resolved once when each turn starts, using the latest saved preferences. Updated defaults affect the next generation; they do not change an active generation or historical attribution. Model pickers can save an override between messages or clear it back to Use settings. Owner checks, conversation leases and draft revisions prevent changing models during generation. Each assistant message/draft turn stores its actual provider and model. Retrying an incomplete response uses the current selection and replaces its previous incomplete attempt; a completed-request replay returns the existing response without requiring defaults or invoking a model again.

Migration `20261018192243_user_ai_model_settings` adds `UserAiModelSetting`, inheritance flags and per-response/turn model metadata. It keeps pre-existing conversations/drafts as explicit overrides and backfills their historical attribution from their previously fixed selection. New records inherit by default. Users can opt existing records into inheritance with Use settings.

Shared task/food index model and query-instruction controls also live in Settings. Published collections retain their own authoritative configuration and maintainer permissions. The account Embeddings default may prefill setup or be explicitly chosen for a rebuild; changing it performs no rebuild and never changes the model used to query existing vectors. Search pages retain status/indexing actions and link to Settings for model maintenance.

Validation on 2026-10-18: all 400 Jest tests (58 suites), TypeScript, scoped Oxlint/format, repository Stylelint, Prisma validation/empty schema diff and production build passed. Twenty-one isolated PostgreSQL/service checks covered account isolation, inherited and explicit selections, per-turn snapshots, switching during generation, completed replay without defaults, meal drafts and unchanged shared index configurations. Browser checks used a temporary synthetic account: saved default selection, automatic meal-model inheritance and interpretation, inherited chat/streamed response, model switching with preserved earlier attribution, and inherited embedding generation (1,024 dimensions). Settings and embeddings layouts fit 390px without horizontal overflow; browser runtime errors were empty. Both test accounts and their data were removed and the isolated browser signed out/closed. Repository-wide lint continues to report existing errors in untouched planner/auth/UI files.

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

Discovery uses `GET /api/tags` and `POST /api/show`, with at most four concurrent inspections. It reads model metadata without generating text or loading model weights. Ollama's `completion` capability maps to `chat`, and `embedding` maps to `embedding`; `vision` and `thinking` metadata are also preserved. Unknown capabilities are not guessed from model names; models with neither supported capability remain discoverable with an empty capability list. Servers that omit capability metadata return an explicit error.

Both resolvers check the exact installed model ID (including its tag) and requested capability before constructing an AI SDK model. They inspect only the selected model. Discovery and resolution read fresh metadata without Next.js fetch caching. A future provider can be added behind the same entry point without importing AI Dev code; no provider registry or agent framework is needed yet.

Metadata requests have a 10-second deadline; inference requests have a 120-second deadline and preserve caller cancellation. Discovery calls do not retry automatically. AI SDK callers own inference retry policy and overall operation deadlines. HTTP and network failures, invalid responses, configuration errors and invalid model selections throw `AiError` with a stable `code`. Provider response bodies and raw network errors are not included in these messages. SDK inference responses retain the SDK's own error handling.

API adapters must authenticate callers, validate input and map errors to their transport's error types. Future AI tools must delegate state changes to Vela's deterministic application services.

## AI Dev chat

Open `/ai-dev` from the application navigation and sign in with a normal Vela account. The page checks the server-side Better Auth session before rendering the chat view. There is no separate administrator role. `aiDev.listChatModels` is a protected tRPC query over the shared discovery service and returns only chat-capable models.

Click **Start conversation** to create a saved conversation using the effective model from Settings, or choose an explicit override. Use **Saved conversations** to reopen one after leaving or reloading the page. The model picker remains available between messages; **Use settings** restores inheritance, and **New conversation** starts with inheritance again. **Delete** confirms removal of the conversation and its messages. Titles are derived deterministically from the first user message, without an AI naming request.

Enter sends; Shift+Enter adds a line. AI SDK UI `useChat` owns the active stream, while tRPC/TanStack Query loads and refreshes saved history. Fresh authorized reads are required before cached conversation data is displayed after mounting. Text renders without Markdown, attachments, reasoning displays or tools. The user can stop generation, retry an incomplete response, or continue a restored conversation.

`POST /api/ai-dev/chat` verifies the session, rejects cross-site requests and non-JSON content, and validates a conversation UUID and a single text-only user UI message. The transport sends the latest user message, including its stable ID. Provider selection and previous messages are loaded from PostgreSQL; client-supplied history and model settings cannot replace them. Origin checks use the external Host header because Next.js may use an internal hostname in `request.url`. User messages are limited to 16,000 characters; the server checks the loaded inference context against 100 messages and 64,000 text characters.

Generation is capped at 2,048 output tokens and 120 seconds, with automatic inference retries disabled. Cancellation is forwarded to the SDK and shared provider. Responses use the SDK UI stream protocol and `private, no-store` caching. Safe model-selection, ownership and concurrency errors are returned to the client; unknown server and mid-stream provider failures are masked. SDK provider-error logging is disabled because errors are surfaced through the UI stream.

## Conversation persistence

`AiConversation` stores its owner, title, inheritance/override selection and generation lease. `AiMessage` stores structured JSONB message parts, role, position, response status, the actual generation provider/model and the user message it answers. Composite keys enforce unique message IDs, positions and replies within a conversation. The additive migration is `20261017183136_ai_dev_conversations`; run the normal Prisma migration workflow and regenerate the client when setting up another database.

All conversation operations use the authenticated user ID. List, read, delete, generation setup and finalization are owner-scoped. Missing and foreign conversations both return not found. Deletion cascades to messages, and completion callbacks cannot recreate deleted conversations.

Before inference, a short transaction claims the conversation, validates the existing turn and saves the user message plus an assistant placeholder. Network/model calls happen outside transactions. The server assigns a stable assistant ID and uses it in the UI stream. A duplicate completed request replays the saved reply without inference; retrying a failed or interrupted turn reuses both message rows and replaces the incomplete assistant response. Reusing a message ID with different content is rejected. Older incomplete turns cannot be rewritten after later user messages.

Only one generation can run per conversation. Concurrent attempts receive a conflict. A three-minute lease bounds abandoned generations; an authorized read or subsequent turn marks expired placeholders interrupted. Each completion must match the current generation token, so a late callback cannot overwrite a newer attempt or clear its lease. There are no background recovery jobs.

SDK stream completion/cancellation persists structured response parts and a `COMPLETED`, `INTERRUPTED` or `FAILED` status. Partial text is saved when cancellation/disconnection reaches the server. A process crash can lose partial text that has not reached finalization; the saved user message and placeholder remain recoverable after lease expiry. There are no per-token database writes. Saved text-part state is normalized for restoration, and empty or failed assistant content is omitted from inference history. A storage failure is surfaced as an error rather than treating the response as durably saved.

The implementation uses `@ai-sdk/react@4.0.146`, matching `ai@7.0.142`. Persistent embedding collections are documented below.

Phase 3 was verified on 2026-10-17 with 117 Jest tests, typecheck, changed-file lint/format checks and a production build. Thirteen live PostgreSQL checks covered cross-user denial, concurrent requests, retry deduplication, authoritative history, lease recovery, stale callbacks and cascading deletion; temporary fixtures and the verification route were removed. Browser checks with the authorized test account confirmed streamed persistence, restoration after reload, continued context, interrupted-response retry and confirmed deletion. Retrying an interrupted three-turn conversation preserved its six rows and assistant ID; a subsequent completed-response replay returned the saved ID and a complete SDK UI stream without adding rows. Repository-wide lint still reports errors in untouched planner/UI/auth files.

## Embeddings playground

Open **AI Dev → Embeddings** at `/ai-dev/embeddings`. Like chat, the page checks the server-side Better Auth session. The model picker starts on **Use settings**, resolving the feature override or account Embeddings default. An explicit temporary selection overrides it for this playground visit. The navigation groups Chat and Embeddings under AI Dev.

`aiDev.listEmbeddingModels` is a protected tRPC query using shared discovery. The protected `aiDev.generateEmbedding` and `aiDev.compareEmbeddings` mutations validate inputs and delegate to `lib/ai-dev/embeddings.ts`. That service resolves the selected model through `lib/ai/` and calls AI SDK `embed` or `embedMany`. Comparison embeds both texts with the same resolved model and computes cosine similarity over the complete vectors on the server. Only dimensions and the first 16 values of each vector are returned, alongside the provider/model selection and comparison score.

Each text must be nonblank and at most 16,000 characters. Inputs are sent exactly as entered, with no automatic instructions, prefixes, normalization or chunking. Ollama truncation is disabled, so inputs exceeding the model context fail rather than producing a silently shortened embedding. Inference has a 120-second deadline and automatic retries are disabled. Model/capability errors, rejected inputs and generation failures surface safe messages without provider payloads. Invalid, non-finite, mismatched or zero comparison vectors are rejected; rounding at the cosine bounds is clamped to `[-1, 1]`.

The Mantine view uses tRPC/TanStack mutations for temporary results and local component state for text/model selection. It shows loading, empty and error states, disables changes during inference, and clears affected results when text or model selection changes. Mutation results are discarded after unmounting; there are no database writes or persistent vectors. Similarity is displayed as a raw cosine score, not a probability or a calibrated matching threshold.

Phase 4 was verified on 2026-10-17 with all 154 Jest tests (15 suites), typecheck, changed-file Oxlint/Stylelint/format checks and a production build. Browser checks with the authorized test account and `qwen3-embedding:0.6b` confirmed 1,024 dimensions, a 16-value preview, identical-text similarity `1.000000`, different-text comparison and result invalidation after editing. Signed-out discovery/generation returned 401; blank/oversized inputs, a missing model, a chat-only model and an empty comparison input returned 400. Desktop and 390-pixel layouts were inspected; the narrow layout had no horizontal overflow. The test browser was signed out and closed afterward. These checks verify functionality, not retrieval quality for a future application feature.

## PostgreSQL vector support

The development database image is built from `.devcontainer/postgres/Dockerfile`, extending `postgres:18-alpine` with pgvector 0.8.7. The release archive is pinned and SHA-256 checked. Build dependencies and downloaded source are removed in the same layer; `OPTFLAGS=""` avoids host-specific CPU compilation and `with_llvm=no` avoids the optional LLVM build toolchain. Extension installation happens during the image build, before PostgreSQL starts.

`.devcontainer/docker-compose.inner.yml` builds this image and preserves the `vela-postgres-data` volume at `/var/lib/postgresql`. The dev container's `postStartCommand` runs Compose with `--build`, which reuses cached layers when the Dockerfile is unchanged. To rebuild the database manually from the repository root:

```sh
docker compose -f .devcontainer/docker-compose.inner.yml up -d --build db
```

After PostgreSQL is ready, run `yarn prisma migrate dev` during development, or `yarn prisma migrate deploy` when applying existing migrations to another environment. Migration `20261017210033_enable_pgvector` executes `CREATE EXTENSION IF NOT EXISTS vector`. Keeping activation in migration history enables the extension in both existing databases and Prisma shadow databases. A fresh-init script alone would not cover an existing data volume. Other environments must install pgvector on the database server before applying this migration. No Prisma package, generator setting or application schema change is required for this extension-only migration; future Prisma 7 vector fields and operations will use `Unsupported` types and parameterized SQL.

Run the repeatable SQL verification after migrating:

```sh
docker compose -f .devcontainer/docker-compose.inner.yml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
  < .devcontainer/postgres/verify.sql
```

This checks temporary vectors at 1,024, 2,560 and 4,096 dimensions, including identical/opposite/orthogonal cosine scores and exact nearest-neighbor ordering. All test rows are rolled back. On 2026-10-17 the image build, isolated fresh-database test, normal Prisma migration/shadow workflow and live development database checks passed with PostgreSQL 18.6 and pgvector 0.8.7. The replacement container retained the existing volume and all application table row counts were unchanged. The infrastructure-only migration created no persistent embedding collection; task collection storage was added subsequently.

Dimension count belongs to each collection's configuration; 1,024 is not an application-wide limit. The current pgvector `vector` type stores up to 16,000 dimensions, while its HNSW/IVFFlat indexes support up to 2,000 dimensions for `vector` or 4,000 for `halfvec`. Exact cosine search supports all three verified sizes. Future approximate search at 4,096 dimensions needs a different indexing representation, such as binary quantization with reranking against the stored original vectors; it must not silently discard dimensions. See the [pgvector type reference](https://github.com/pgvector/pgvector#vector-type) and [indexing guidance](https://github.com/pgvector/pgvector#frequently-asked-questions).

## Embedding configuration ownership

Persistent embeddings use **one embedding configuration per collection/vector table**, with independent configurations for different collections. Vela does not require one global embedding model. For example, ingredient matching and document search can each select a model and settings suited to their own collection. The shared provider resolver takes an explicit model selection on every call. Account-level embedding defaults apply to the playground and setup/rebuild forms; existing indexes always use their published collection configuration.

Store configuration once at the collection level. Every vector in that collection must use it; rows do not choose their own model. A collection has only one active configuration. The current `EmbeddingCollectionConfig` model stores a named collection key, validated JSON configuration, publication revision, indexing lease and safe failure status. Configuration records are independent per collection; they are not a global application setting.

The configuration should identify the provider, exact model ID, immutable model revision or digest where available, output dimensions, and settings that affect vector generation. Include the versions of document preprocessing/chunking and any query/document instructions or prefixes. A query and a document can use different input formatting when the configuration explicitly defines that pair. Model tags alone are insufficient to detect model replacement, and matching vector dimensions alone do not establish compatibility.

Indexing and query services must both resolve the collection's active configuration. Validate dimensions and configuration identity before writes and searches. A caller must not select an arbitrary query model for an existing collection, and a provider failure must not silently trigger a different embedding model.

Changing any vector-affecting setting requires a full reindex of the collection/table. Treat the active configuration as immutable while its vectors are in use. Rebuild every vector from source data, validate the complete replacement, and activate the new configuration and vector set together. Never expose a partially converted collection or compare vectors across configurations. The reindex implementation must either make the collection unavailable during an in-place rebuild or build a separate replacement table/collection before switching. Mixed-model rows within a table, partial model migrations and query-time handling of multiple models in one collection are outside the intended design.

The AI Dev embeddings playground may select models freely because it has no persistent collection. It inherits account preferences without changing any collection configuration.

## Persistent collections and task search experiment

The task search prototype at **Planner → Fuzzy task search** (`/planner/task-search`) exercises the collection infrastructure without modifying existing task pages or task services. It searches by embedding similarity, not a typo-distance algorithm. The page and every tRPC procedure require authentication. Search results and index counts are scoped to the signed-in user's tasks, including all task statuses. The current UI has no similarity threshold: it returns up to the requested number of nearest current vectors and displays raw cosine scores.

`lib/embeddings/collection.ts` constructs a collection service from an adapter in `types.ts`. The adapter defines its collection key, text preparation version, source loading, vector persistence and owner-filtered search. The common engine handles configuration validation, batched inference, unchanged-source reuse, lease renewal, model identity checks, safe publication and complete rebuilds. Add another indexed entity by defining a dedicated vector table through a migration and providing its adapter; callers cannot supply arbitrary SQL table names or select a query model independently of the saved collection configuration.

The task adapter in `lib/task-search/` binds `tasks.semantic` to `task_embeddings`. `TaskEmbedding.taskId` is a unique foreign key to `Task.id` with cascading deletion. Rows contain the pgvector value, a source text SHA-256, the source's `updatedAt` and the embedding time; they contain no per-row model selection. The vector column uses `vector` without a fixed dimension declaration to permit full-collection model changes without a schema migration. The service validates every vector against the collection's configured dimensions, including finite/nonzero values representable in PostgreSQL's float32 storage. There are no approximate-search indexes or mixed-model query paths.

`task-text-v1` combines title, brief, first step, sorted tags and plain text extracted from BlockNote content, including nested blocks, links and tables. Editor IDs, styles, link URLs and unrelated task metadata are not embedded. Text preparation is deterministic and its version is part of the configuration. Inputs over 16,000 characters are rejected, and Ollama truncation is disabled. Inference uses batches of eight with a 120-second deadline per batch and no automatic retries. The configuration stores the exact model ID, reported digest, discovered output dimensions, preparation version, document prefix and query prefix. The maintainer's optional query instruction becomes `Instruct: ...\nQuery: `; leave it empty to use raw query text.

**Index my tasks** generates only missing or changed text embeddings. A metadata-only edit can reuse its vector while refreshing the source timestamp. New/edited tasks are not indexed automatically; search joins the source task and excludes vectors whose source timestamp differs, before ranking and limiting. Status computes hashes as well as timestamp freshness. Publication rechecks current source text, omits rows changed/deleted during inference, and locks source rows only during the short database transaction. The next indexing pass picks up any skipped or newly created rows.

One five-minute renewable database lease serializes indexing per collection across users and processes. Inference and in-memory staging happen outside transactions. Finalization checks the lease token and expiry, preventing abandoned attempts from overwriting newer work. **Rebuild shared task index** stages embeddings for every user's tasks, validates model identity and source consistency, then replaces all vector rows and activates the new configuration/revision in one transaction. Search can use the previous published configuration while a replacement is being prepared. Query publication checks the configuration revision under a database row lock, so a query embedded with an old configuration cannot search new vectors. Failed inference, changed sources or failed publication retain the previous index. Model digests are checked before and after inference; a replaced tag requires a full rebuild rather than silently comparing incompatible vectors.

Model switching and complete rebuilds are maintenance operations over all users' task embeddings. Only user IDs listed in the server-only comma-separated `EMBEDDING_MAINTAINER_USER_IDS` setting may perform them. The service enforces this independently of the UI; an absent setting denies everyone. The authorized test account was designated locally in ignored `vela.env` and `.env.local`, without committing its ID or credentials. Keep these settings aligned when recreating the dev container. Ordinary users can index/search only their own tasks under the active shared configuration. The page confirms the scope before a maintainer rebuild.

Migration `20261017211829_task_embedding_collection` adds collection metadata and the task vector table, leaving task data intact. This is a manually operated prototype: requests perform indexing synchronously, and full rebuilds stage the replacement in server memory. Closing the page does not guarantee server-side cancellation; a process crash abandons the attempt until lease expiry. Large collections will need a separately scoped durable worker/staging design. No automatic task mutation hooks, job queue, production search integration or global embedding default were added.

Verification on 2026-10-17 included all 197 Jest tests, typecheck, scoped lint/format, Prisma validation/migration status and a production build. Twelve live PostgreSQL checks covered owner-scoped indexing/search, unchanged vector reuse, stale exclusion, semantic versus metadata edits, non-maintainer denial, concurrent claims, rollback of forced publication failure, model-digest mismatch and cascading deletion. Browser checks confirmed a shared rebuild from 1,024-dimensional `qwen3-embedding:0.6b` to 2,560-dimensional `qwen3-embedding:4b`; every stored task vector had the new dimension count. A semantic query ranked a synthetic dental task first. The initial 0.6b configuration was restored afterward, all temporary tasks/users/routes were removed, and the browser was signed out and closed. Desktop and 390-pixel layouts fit without horizontal overflow. These checks validate mechanics, not production retrieval quality.

## Dependencies and checks

The initial dependency set is `ai@7.0.142`, `ollama-ai-provider-v2@4.0.1` and `server-only@0.0.1`, with exact resolutions recorded in `yarn.lock`. AI SDK 7 requires Node.js 22 or newer; the development container uses Node.js 24. The AI SDK patch was selected to satisfy Yarn's release quarantine policy.

Run focused unit tests with `yarn jest --runInBand lib/ai/ollama.test.ts`. They mock the provider and network; they do not require Ollama or a database. Live discovery and inference should also be verified from a Next.js server runtime after configuration changes.

Phase 1 was verified on 2026-10-17 against Ollama 0.40.6 and `llama3.1:8b`: discovery, text generation, text streaming and rejection of a chat-only model for embeddings succeeded in a temporary guarded Next.js route. After the user installed `qwen3-embedding:0.6b`, a second Next.js check verified capability discovery, model resolution, AI SDK `embed` and `embedMany`, and cosine similarity. All three generated vectors had 1,024 finite dimensions; comparing the same input across single and batch calls gave cosine similarity approximately 1. Retrieval quality and task-specific input formatting still need evaluation for each consuming feature.

Both temporary verification routes were removed afterward. The checks explicitly loaded only the Ollama setting from `vela.env` to accommodate the running development server's existing environment.


## Shared structured generation and Nutrition drafts

`generateStructured` from `lib/ai/structured.ts` (also exported by `lib/ai`) accepts an explicit `AiModelSelection`, caller-owned Zod schema, system instructions, serialized context and optional cancellation signal. It resolves through the shared Ollama adapter, uses AI SDK `generateText` with `Output.object`, validates output, and masks provider payloads on failure. Context is bounded at 64,000 characters, output at 4,096 tokens, inference at 120 seconds, retries at zero and temperature at zero. Ollama thinking is disabled for structured calls. Model discovery/identity checks also accept cancellation when used by this helper or collection searches. Existing chat/task workflows retain their defaults.

Nutrition Phase 4 consumes this helper for proposed draft operations. Its prompts, matching and persistence are feature-owned, with no infrastructure dependency on Nutrition. Protected procedures save user messages before inference and publish a whole validated operation batch only while its owner/revision/lease still matches. Model calls and semantic matching happen outside database transactions. Confirmation is deterministic application behavior and requires explicit user review. See [Nutrition](NUTRITION.md) for draft limits, retry/recovery and transactional confirmation.

Synthetic live checks on 2026-10-18 verified structured generation and conversational correction with installed `qwen3:8b`. Initial `llama3.1:8b` results could satisfy the schema while omitting foods/category; schema validity is not semantic accuracy. The UI requires reviewing and resolving the draft. Account defaults are now resolved by the application settings service described above; there is no automatic model fallback. Product indexing uses its own dedicated collection/configuration and durable worker, while task indexing stays manual.

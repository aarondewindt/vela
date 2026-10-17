import 'server-only';

import { createOllama } from 'ollama-ai-provider-v2';
import { z } from 'zod';
import { AiError } from './errors';

export type AiModelSelection = { provider: 'ollama'; modelId: string };
export type AiModelCapability = 'chat' | 'embedding';
export type AiModel = {
  provider: 'ollama';
  id: string;
  capabilities: AiModelCapability[];
};

const discoveryTimeoutMs = 10_000;
const inferenceTimeoutMs = 120_000;
const discoveryBatchSize = 4;
const modelsSchema = z.object({ models: z.array(z.object({ name: z.string().min(1) })) });
const modelInfoSchema = z.object({ capabilities: z.array(z.string()) });

function getBaseURL(): string {
  const value = process.env.OLLAMA_BASE_URL?.trim();
  if (!value) {
    throw new AiError('CONFIGURATION_ERROR', 'Set OLLAMA_BASE_URL to enable Ollama.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiError('CONFIGURATION_ERROR', 'OLLAMA_BASE_URL must be an HTTP or HTTPS URL.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AiError(
      'CONFIGURATION_ERROR',
      'OLLAMA_BASE_URL must be an HTTP or HTTPS URL without credentials, query parameters or a fragment.'
    );
  }

  url.search = '';
  url.hash = '';
  const baseURL = url.toString().replace(/\/+$/, '');
  return baseURL.endsWith('/api') ? baseURL : `${baseURL}/api`;
}

async function fetchOllama(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = discoveryTimeoutMs
): Promise<Response> {
  const requestSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(input, { ...init, cache: 'no-store', signal });
  } catch {
    throw new AiError(
      'PROVIDER_UNAVAILABLE',
      'Ollama could not be reached or the request was interrupted. Check the server and OLLAMA_BASE_URL.'
    );
  }
}

async function request<T>(
  baseURL: string,
  path: string,
  schema: z.ZodType<T>,
  modelId?: string
): Promise<T> {
  const response = await fetchOllama(`${baseURL}/${path}`, {
    ...(modelId
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId }),
        }
      : {}),
  });

  if (!response.ok) {
    if (response.status === 404 && modelId) {
      throw new AiError('MODEL_NOT_FOUND', 'The selected Ollama model is no longer installed.');
    }
    throw new AiError('PROVIDER_UNAVAILABLE', `Ollama returned HTTP ${response.status}.`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new AiError(
        'PROVIDER_UNAVAILABLE',
        'The Ollama response timed out or was interrupted.'
      );
    }
    throw new AiError('INVALID_PROVIDER_RESPONSE', 'Ollama returned an unreadable response.');
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AiError(
      'INVALID_PROVIDER_RESPONSE',
      'Ollama returned unexpected model metadata. Check that the server supports model capabilities.'
    );
  }
  return result.data;
}

async function describeModel(baseURL: string, id: string): Promise<AiModel> {
  const { capabilities } = await request(baseURL, 'show', modelInfoSchema, id);
  const supported: AiModelCapability[] = [];
  if (capabilities.includes('completion')) {
    supported.push('chat');
  }
  if (capabilities.includes('embedding')) {
    supported.push('embedding');
  }
  return { provider: 'ollama', id, capabilities: supported };
}

/** Discover installed models and their reported capabilities without loading model weights. */
export async function discoverModels(): Promise<AiModel[]> {
  const baseURL = getBaseURL();
  const { models } = await request(baseURL, 'tags', modelsSchema);
  const ids = [...new Set(models.map(({ name }) => name))];
  const discovered: AiModel[] = [];

  for (let offset = 0; offset < ids.length; offset += discoveryBatchSize) {
    discovered.push(
      ...(await Promise.all(
        ids.slice(offset, offset + discoveryBatchSize).map((id) => describeModel(baseURL, id))
      ))
    );
  }
  return discovered;
}

async function resolveModel(selection: AiModelSelection, capability: AiModelCapability) {
  if (selection.provider !== 'ollama') {
    throw new AiError('PROVIDER_NOT_SUPPORTED', 'The selected AI provider is not supported.');
  }

  const baseURL = getBaseURL();
  const { models } = await request(baseURL, 'tags', modelsSchema);
  if (!models.some(({ name }) => name === selection.modelId)) {
    throw new AiError('MODEL_NOT_FOUND', 'Select an installed Ollama model.');
  }

  const model = await describeModel(baseURL, selection.modelId);
  if (!model.capabilities.includes(capability)) {
    throw new AiError(
      'MODEL_NOT_SUPPORTED',
      `The selected Ollama model does not support ${capability}.`
    );
  }

  return createOllama({
    baseURL,
    fetch: (input, init) => fetchOllama(input, init, inferenceTimeoutMs),
  });
}

export async function resolveChatModel(selection: AiModelSelection) {
  const provider = await resolveModel(selection, 'chat');
  return provider.languageModel(selection.modelId);
}

export async function resolveEmbeddingModel(selection: AiModelSelection) {
  const provider = await resolveModel(selection, 'embedding');
  return provider.embeddingModel(selection.modelId);
}

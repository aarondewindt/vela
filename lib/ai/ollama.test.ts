/** @jest-environment node */

jest.mock('server-only', () => ({}));
// Exercise the middleware for both operations; the opt-in smoke test uses the real SDK.
jest.mock('ai', () => ({
  wrapLanguageModel: ({ model, middleware }: any) => ({
    ...model,
    doGenerate: async (params: any) =>
      model.doGenerate(await middleware.transformParams({ params, type: 'generate', model })),
    doStream: async (params: any) =>
      model.doStream(await middleware.transformParams({ params, type: 'stream', model })),
  }),
}));
jest.mock('ollama-ai-provider-v2', () => ({ createOllama: jest.fn() }));

import { createOllama } from 'ollama-ai-provider-v2';
import {
  discoverModels,
  resolveChatModel,
  resolveEmbeddingModel,
  resolveEmbeddingModelWithIdentity,
  validateModelSelection,
} from './ollama';

const originalBaseURL = process.env.OLLAMA_BASE_URL;
const originalFetch = global.fetch;
const originalOverrides = process.env.AI_MODEL_CAPABILITY_OVERRIDES;
const fetchMock = jest.fn();
const chatModel = {
  specificationVersion: 'v3',
  provider: 'ollama',
  modelId: 'chat:latest',
  supportedUrls: {},
  doGenerate: jest.fn(),
  doStream: jest.fn(),
};
const embeddingModel = { modelId: 'vectors:latest' };
const provider = {
  languageModel: jest.fn(() => chatModel),
  embeddingModel: jest.fn(() => embeddingModel),
};

describe('persistent embedding identity', () => {
  it('returns the exact installed model digest with the resolved model', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ models: [{ name: 'vectors:latest', digest: 'sha256:abc' }] })
      )
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['embedding'] }));
    await expect(
      resolveEmbeddingModelWithIdentity({ provider: 'ollama', modelId: 'vectors:latest' })
    ).resolves.toEqual({ model: embeddingModel, digest: 'sha256:abc' });
  });
  it('refuses persistent embedding without a reported model digest', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('vectors:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['embedding'] }));
    await expect(
      resolveEmbeddingModelWithIdentity({ provider: 'ollama', modelId: 'vectors:latest' })
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

function installedModels(...names: string[]) {
  return jsonResponse({ models: names.map((name) => ({ name })) });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AI_MODEL_CAPABILITY_OVERRIDES;
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test:11434';
  (createOllama as jest.Mock).mockReturnValue(provider);
});

afterAll(() => {
  global.fetch = originalFetch;
  if (originalOverrides === undefined) {
    delete process.env.AI_MODEL_CAPABILITY_OVERRIDES;
  } else {
    process.env.AI_MODEL_CAPABILITY_OVERRIDES = originalOverrides;
  }
  if (originalBaseURL === undefined) {
    delete process.env.OLLAMA_BASE_URL;
  } else {
    process.env.OLLAMA_BASE_URL = originalBaseURL;
  }
});

describe('discoverModels', () => {
  it('uses reported capabilities, preserves tags and deduplicates installed models', async () => {
    fetchMock
      .mockResolvedValueOnce(
        installedModels('chat:latest', 'vectors:latest', 'chat:latest', 'both:v1')
      )
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['completion', 'tools'] }))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['embedding'] }))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['embedding', 'completion'] }));

    await expect(discoverModels()).resolves.toEqual([
      { provider: 'ollama', id: 'chat:latest', capabilities: ['chat'] },
      { provider: 'ollama', id: 'vectors:latest', capabilities: ['embedding'] },
      { provider: 'ollama', id: 'both:v1', capabilities: ['chat', 'embedding'] },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://ollama.test:11434/api/tags',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://ollama.test:11434/api/show',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ model: 'chat:latest' }) })
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns an empty list when no models are installed', async () => {
    fetchMock.mockResolvedValueOnce(installedModels());
    await expect(discoverModels()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('limits concurrent model inspections to four', async () => {
    let active = 0;
    let maximum = 0;
    fetchMock.mockResolvedValueOnce(
      installedModels(...Array.from({ length: 9 }, (_, i) => `model:${i}`))
    );
    fetchMock.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return jsonResponse({ capabilities: ['completion'] });
    });
    await expect(discoverModels()).resolves.toHaveLength(9);
    expect(maximum).toBe(4);
  });

  it('aborts discovery when the request deadline expires', async () => {
    const controller = new AbortController();
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
    fetchMock.mockImplementationOnce(
      (_input, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('timed out')));
        })
    );
    const discovery = discoverModels();
    expect(timeout).toHaveBeenCalledWith(10_000);
    controller.abort();
    try {
      await expect(discovery).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    } finally {
      timeout.mockRestore();
    }
  });

  it.each(['http://ollama.test:11434/', 'http://ollama.test:11434/api/'])(
    'normalizes the base URL %s',
    async (baseURL) => {
      process.env.OLLAMA_BASE_URL = baseURL;
      fetchMock.mockResolvedValueOnce(installedModels());
      await discoverModels();
      expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test:11434/api/tags');
    }
  );

  it.each([
    '',
    'not-a-url',
    'file:///tmp/ollama',
    'http://user:secret@ollama.test',
    'http://ollama.test?secret=x',
    'http://ollama.test/#fragment',
  ])('rejects invalid configuration without contacting the provider', async (baseURL) => {
    process.env.OLLAMA_BASE_URL = baseURL;
    await expect(discoverModels()).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports missing configuration only when AI is requested', async () => {
    delete process.env.OLLAMA_BASE_URL;
    await expect(discoverModels()).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('reports an unavailable server without exposing its raw error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private upstream details'));
    await expect(discoverModels()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: expect.not.stringContaining('private'),
    });
  });

  it('reports an HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'private' }, 503));
    await expect(discoverModels()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it.each([{ models: null }, { models: [{ name: '' }] }])(
    'rejects malformed model lists',
    async (response) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));
      await expect(discoverModels()).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    }
  );

  it('rejects invalid JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>not Ollama</html>'));
    await expect(discoverModels()).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('reports an interrupted response body as a provider failure', async () => {
    const response = jsonResponse({});
    jest.spyOn(response, 'json').mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    fetchMock.mockResolvedValueOnce(response);
    await expect(discoverModels()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('does not guess capabilities when the server omits them', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('chat:latest'))
      .mockResolvedValueOnce(jsonResponse({ details: { family: 'llama' } }));
    await expect(discoverModels()).resolves.toEqual([
      { provider: 'ollama', id: 'chat:latest', capabilities: [] },
    ]);
  });

  it('handles a model being removed between listing and inspection', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('chat:latest'))
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));
    await expect(discoverModels()).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
  });
});

describe('model resolution', () => {
  it('discovers vision-language and thinking capabilities from metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('vision:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['completion', 'vision', 'thinking'] }));
    expect(await discoverModels()).toEqual([
      { provider: 'ollama', id: 'vision:latest', capabilities: ['chat', 'vision', 'thinking'] },
    ]);
  });
  it('requires both chat and vision for vision-language settings without inference', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('text:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['completion'] }));
    await expect(
      validateModelSelection({ provider: 'ollama', modelId: 'text:latest' }, ['chat', 'vision'])
    ).rejects.toMatchObject({ code: 'MODEL_NOT_SUPPORTED' });
    expect(provider.languageModel).not.toHaveBeenCalled();
  });
  it('resolves a chat model using the configured server', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('chat:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['completion'] }));
    await expect(
      resolveChatModel({ provider: 'ollama', modelId: 'chat:latest' })
    ).resolves.toMatchObject({ modelId: chatModel.modelId });
    expect(provider.languageModel).toHaveBeenCalledWith('chat:latest');
    expect(createOllama).toHaveBeenCalledWith({
      baseURL: 'http://ollama.test:11434/api',
      fetch: expect.any(Function),
    });
  });

  it('resolves an embedding model', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('vectors:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['embedding'] }));
    await expect(
      resolveEmbeddingModel({ provider: 'ollama', modelId: 'vectors:latest' })
    ).resolves.toBe(embeddingModel);
    expect(provider.embeddingModel).toHaveBeenCalledWith('vectors:latest');
  });

  it('rejects an uninstalled model before creating a provider', async () => {
    fetchMock.mockResolvedValueOnce(installedModels('chat:latest'));
    await expect(
      resolveChatModel({ provider: 'ollama', modelId: 'missing' })
    ).rejects.toMatchObject({
      code: 'MODEL_NOT_FOUND',
    });
    expect(createOllama).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { resolve: resolveChatModel, capabilities: ['embedding'] },
    { resolve: resolveEmbeddingModel, capabilities: ['completion'] },
  ])('rejects a model without the requested capability', async ({ resolve, capabilities }) => {
    fetchMock
      .mockResolvedValueOnce(installedModels('wrong:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities }));
    await expect(resolve({ provider: 'ollama', modelId: 'wrong:latest' })).rejects.toMatchObject({
      code: 'MODEL_NOT_SUPPORTED',
    });
    expect(createOllama).not.toHaveBeenCalled();
  });

  it('bounds inference requests and preserves caller cancellation', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('chat:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['completion'] }));
    await resolveChatModel({ provider: 'ollama', modelId: 'chat:latest' });
    const providerFetch = (createOllama as jest.Mock).mock.calls[0][0].fetch;
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await providerFetch('http://ollama.test:11434/api/chat', { signal: controller.signal });
    const signal = fetchMock.mock.calls[2][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe('capability overrides and input guards', () => {
  async function resolve(capabilities: string[] | undefined) {
    fetchMock
      .mockResolvedValueOnce(installedModels('chat:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities }));
    return resolveChatModel({ provider: 'ollama', modelId: 'chat:latest' });
  }
  const imagePrompt = {
    prompt: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Lees deze Nederlandse verpakking.' },
          {
            type: 'file' as const,
            mediaType: 'image/jpeg',
            data: { type: 'data' as const, data: new Uint8Array([1, 2]) },
          },
          {
            type: 'file' as const,
            mediaType: 'image/png',
            data: { type: 'data' as const, data: new Uint8Array([3, 4]) },
          },
        ],
      },
    ],
  };
  it.each(['doGenerate', 'doStream'] as const)(
    'rejects images before provider %s',
    async (method) => {
      const model = await resolve(['completion']);
      await expect(model[method](imagePrompt)).rejects.toMatchObject({
        code: 'MODEL_NOT_SUPPORTED',
        message: expect.stringContaining('image inputs'),
      });
      expect(chatModel[method]).not.toHaveBeenCalled();
    }
  );
  it.each(['doGenerate', 'doStream'] as const)(
    'preserves text and multiple images for %s',
    async (method) => {
      const model = await resolve(['completion', 'vision']);
      await model[method](imagePrompt);
      expect(chatModel[method]).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: [
            {
              role: 'user',
              content: [
                imagePrompt.prompt[0].content[0],
                { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: 'AQI=' } },
                { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'AwQ=' } },
              ],
            },
          ],
        })
      );
      expect(imagePrompt.prompt[0].content[1].data?.data).toEqual(new Uint8Array([1, 2]));
    }
  );
  it('still accepts text-only generation', async () => {
    const model = await resolve(['completion']);
    const options = {
      prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hallo' }] }],
    };
    await model.doGenerate(options);
    expect(chatModel.doGenerate).toHaveBeenCalled();
  });
  it('rejects images in history even when the latest user message is text-only', async () => {
    const model = await resolve(['completion']);
    await expect(
      model.doGenerate({
        prompt: [
          ...imagePrompt.prompt,
          { role: 'assistant', content: [{ type: 'text', text: 'Earlier reply' }] },
          { role: 'user', content: [{ type: 'text', text: 'Correct the name' }] },
        ],
      })
    ).rejects.toMatchObject({ code: 'MODEL_NOT_SUPPORTED' });
    expect(chatModel.doGenerate).not.toHaveBeenCalled();
  });
  it('allows an explicit override for missing metadata', async () => {
    process.env.AI_MODEL_CAPABILITY_OVERRIDES = JSON.stringify([
      { provider: 'ollama', modelId: 'chat:latest', capabilities: { chat: true, vision: true } },
    ]);
    const model = await resolve(undefined);
    await model.doGenerate(imagePrompt);
    expect(chatModel.doGenerate).toHaveBeenCalled();
  });
  it('can disable reported vision support', async () => {
    process.env.AI_MODEL_CAPABILITY_OVERRIDES = JSON.stringify([
      { provider: 'ollama', modelId: 'chat:latest', capabilities: { vision: false } },
    ]);
    const model = await resolve(['completion', 'vision']);
    await expect(model.doGenerate(imagePrompt)).rejects.toMatchObject({
      code: 'MODEL_NOT_SUPPORTED',
    });
  });
  it('matches overrides by exact model tag', async () => {
    process.env.AI_MODEL_CAPABILITY_OVERRIDES = JSON.stringify([
      { provider: 'ollama', modelId: 'chat:other', capabilities: { vision: true } },
    ]);
    const model = await resolve(['completion']);
    await expect(model.doGenerate(imagePrompt)).rejects.toMatchObject({
      code: 'MODEL_NOT_SUPPORTED',
    });
  });
  it('rejects unknown capability metadata at resolution', async () => {
    await expect(resolve(['future-capability'])).rejects.toMatchObject({
      code: 'MODEL_NOT_SUPPORTED',
    });
  });
  it.each([
    'not-json',
    '{}',
    '[{"provider":"ollama","modelId":"chat:latest","capabilities":{"vision":"yes"}}]',
    '[{"provider":"ollama","modelId":"chat:latest","capabilities":{"typo":true}}]',
  ])('rejects invalid overrides safely: %s', async (raw) => {
    process.env.AI_MODEL_CAPABILITY_OVERRIDES = raw;
    await expect(resolve(['completion'])).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(provider.languageModel).not.toHaveBeenCalled();
  });
  it('rejects duplicate override entries', async () => {
    const entry = { provider: 'ollama', modelId: 'chat:latest', capabilities: { vision: true } };
    process.env.AI_MODEL_CAPABILITY_OVERRIDES = JSON.stringify([entry, entry]);
    await expect(resolve(['completion'])).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});

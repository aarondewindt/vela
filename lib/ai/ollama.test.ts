/** @jest-environment node */

jest.mock('server-only', () => ({}));
jest.mock('ollama-ai-provider-v2', () => ({ createOllama: jest.fn() }));

import { createOllama } from 'ollama-ai-provider-v2';
import {
  discoverModels,
  resolveChatModel,
  resolveEmbeddingModel,
  resolveEmbeddingModelWithIdentity,
} from './ollama';

const originalBaseURL = process.env.OLLAMA_BASE_URL;
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const chatModel = { modelId: 'chat:latest' };
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
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test:11434';
  (createOllama as jest.Mock).mockReturnValue(provider);
});

afterAll(() => {
  global.fetch = originalFetch;
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
    await expect(discoverModels()).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('handles a model being removed between listing and inspection', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('chat:latest'))
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));
    await expect(discoverModels()).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
  });
});

describe('model resolution', () => {
  it('resolves a chat model using the configured server', async () => {
    fetchMock
      .mockResolvedValueOnce(installedModels('chat:latest'))
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['completion'] }));
    await expect(resolveChatModel({ provider: 'ollama', modelId: 'chat:latest' })).resolves.toBe(
      chatModel
    );
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

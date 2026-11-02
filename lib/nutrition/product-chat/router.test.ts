/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@/lib/ai', () => jest.requireActual('@/lib/ai/errors'));
jest.mock('../product-extraction/service', () => ({ extractProduct: jest.fn() }));
jest.mock('./service', () => ({
  productConversations: {
    create: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    listForProduct: jest.fn(),
    linkProduct: jest.fn(),
    changeStageModel: jest.fn(),
  },
  productChat: { listChatModels: jest.fn() },
}));
import { extractProduct } from '../product-extraction/service';
import { productChatRouter } from './router';
import { productConversations } from './service';
const id = '45f6af99-9a30-4638-b05f-fb826b970379';
const caller = (userId: string | null) => productChatRouter.createCaller({ userId });
beforeEach(() => jest.resetAllMocks());
it('requires a session before accessing product conversations', async () => {
  await expect(caller(null).linkProduct({ id, productId: id })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  expect(productConversations.linkProduct).not.toHaveBeenCalled();
});
it('passes the authenticated owner through draft creation, linking and restoration', async () => {
  await caller('alice').createConversation({ selection: null });
  await caller('alice').linkProduct({ id, productId: id });
  await caller('alice').listForProduct({ productId: id });
  await caller('alice').getConversation({ id });
  expect(productConversations.create).toHaveBeenCalledWith('alice', null, undefined);
  expect(productConversations.linkProduct).toHaveBeenCalledWith('alice', id, id);
  expect(productConversations.listForProduct).toHaveBeenCalledWith('alice', id);
  expect(productConversations.get).toHaveBeenCalledWith('alice', id);
});

it('protects extraction and delegates with the authenticated owner', async () => {
  const input = {
    conversationId: id,
    message: {
      id: 'extract-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'Read the photos' }],
    },
  };
  await expect(caller(null).extract(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(extractProduct).not.toHaveBeenCalled();
  await caller('alice').extract(input);
  expect(extractProduct).toHaveBeenCalledWith('alice', input, undefined);
});

it('persists independent stage overrides through owner-scoped procedures', async () => {
  const gemma = { provider: 'ollama' as const, modelId: 'gemma3:12b' };
  const qwen = { provider: 'ollama' as const, modelId: 'qwen3:14b' };
  const stageOverrides = { transcription: gemma, interpretation: qwen };
  await caller('alice').createConversation({ selection: null, stageOverrides });
  expect(productConversations.create).toHaveBeenCalledWith('alice', null, stageOverrides);
  await caller('alice').changeConversationStageModel({
    id,
    stage: 'interpretation',
    selection: null,
  });
  expect(productConversations.changeStageModel).toHaveBeenCalledWith(
    'alice',
    id,
    'interpretation',
    null
  );
  await expect(
    caller(null).changeConversationStageModel({ id, stage: 'transcription', selection: gemma })
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
});

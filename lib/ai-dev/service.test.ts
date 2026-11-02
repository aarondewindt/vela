/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/attachments/model-image', () => ({
  prepareModelImage: jest.fn(async (bytes: Buffer, mediaType: string) => ({ bytes, mediaType })),
}));
jest.mock('@/lib/ai', () => ({
  discoverModels: jest.fn(),
  resolveChatModel: jest.fn(),
  validateModelSelection: jest.fn(),
}));
jest.mock('@/lib/attachments/service', () => ({ attachmentService: { retrieve: jest.fn() } }));
jest.mock('./conversations', () => ({
  conversationService: { beginTurn: jest.fn(), finishTurn: jest.fn(), saveCheckpoint: jest.fn() },
}));
jest.mock('ai', () => ({
  stepCountIs: jest.fn(() => 'four-step-limit'),
  convertToModelMessages: jest.fn(),
  streamText: jest.fn(),
  toUIMessageStream: jest.fn(),
  createUIMessageStream: jest.fn(),
  createUIMessageStreamResponse: jest.fn(),
}));

import { convertToModelMessages, createUIMessageStream, streamText, toUIMessageStream } from 'ai';
import { discoverModels, resolveChatModel, validateModelSelection } from '@/lib/ai';
import { prepareModelImage } from '@/lib/attachments/model-image';
import { attachmentService } from '@/lib/attachments/service';
import { conversationService } from './conversations';
import { aiDevService } from './service';
import type { ChatInput } from './schema';

const input: ChatInput = {
  conversationId: '45f6af99-9a30-4638-b05f-fb826b970379',
  message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
};
const reply = { id: 'a', role: 'assistant', parts: [] };
const turn = {
  selection: { provider: 'ollama', modelId: 'saved:latest' },
  history: [input.message],
  response: reply,
  generationId: 'generation-1',
};
const signal = new AbortController().signal;

beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(prepareModelImage)
    .mockImplementation(async (bytes, mediaType) => ({ bytes, mediaType }));
  (conversationService.beginTurn as jest.Mock).mockResolvedValue(turn);
  (streamText as jest.Mock).mockReturnValue({ stream: new ReadableStream() });
});

describe('aiDevService', () => {
  it('lists only chat-capable models', async () => {
    const chat = { id: 'chat', capabilities: ['chat'] };
    (discoverModels as jest.Mock).mockResolvedValue([
      chat,
      { id: 'embedding', capabilities: ['embedding'] },
    ]);
    await expect(aiDevService.listChatModels()).resolves.toEqual([chat]);
  });
  it('uses owner-scoped saved history, saved model selection and a stable response ID', async () => {
    await aiDevService.streamChat('user-a', input, signal);
    expect(conversationService.beginTurn).toHaveBeenCalledWith('user-a', input);
    expect(resolveChatModel).toHaveBeenCalledWith(turn.selection);
    expect(convertToModelMessages).toHaveBeenCalledWith(turn.history);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: signal, timeout: 120_000, maxRetries: 0 })
    );
    const options = (toUIMessageStream as jest.Mock).mock.calls[0][0];
    expect(options.generateMessageId()).toBe('a');
    expect(options.onError(new Error('private'))).not.toContain('private');
  });
  it.each([
    { outcome: { status: 'completed' }, isAborted: false, expected: 'COMPLETED' },
    { outcome: { status: 'failed' }, isAborted: false, expected: 'FAILED' },
    { outcome: { status: 'aborted' }, isAborted: true, expected: 'INTERRUPTED' },
    { outcome: { status: 'unknown' }, isCancelled: true, expected: 'INTERRUPTED' },
  ])('persists the stream outcome $expected', async (event) => {
    await aiDevService.streamChat('user-a', input, signal);
    const responseMessage = { ...reply, parts: [{ type: 'text', text: 'Saved text' }] };
    await (toUIMessageStream as jest.Mock).mock.calls[0][0].onEnd({ ...event, responseMessage });
    expect(conversationService.finishTurn).toHaveBeenCalledWith(
      'user-a',
      input.conversationId,
      'generation-1',
      responseMessage,
      event.expected
    );
  });
  it('marks setup failures without duplicating the saved user message', async () => {
    (resolveChatModel as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(aiDevService.streamChat('user-a', input, signal)).rejects.toThrow('offline');
    expect(conversationService.finishTurn).toHaveBeenCalledWith(
      'user-a',
      input.conversationId,
      'generation-1',
      reply,
      'FAILED'
    );
  });
  it('replays a completed response without invoking the model again', async () => {
    (conversationService.beginTurn as jest.Mock).mockResolvedValue({
      ...turn,
      generationId: null,
      response: { ...reply, parts: [{ type: 'text', text: 'Existing' }] },
    });
    await aiDevService.streamChat('user-a', input, signal);
    const writer = { write: jest.fn() };
    (createUIMessageStream as jest.Mock).mock.calls[0][0].execute({ writer });
    expect(writer.write).toHaveBeenCalledWith({ type: 'start', messageId: 'a' });
    expect(resolveChatModel).not.toHaveBeenCalled();
    expect(conversationService.finishTurn).not.toHaveBeenCalled();
  });
  it('surfaces persistence failure without exposing database details', async () => {
    await aiDevService.streamChat('user-a', input, signal);
    (conversationService.finishTurn as jest.Mock).mockRejectedValue(new Error('private SQL'));
    await expect(
      (toUIMessageStream as jest.Mock).mock.calls[0][0].onEnd({
        responseMessage: reply,
        outcome: { status: 'completed' },
      })
    ).rejects.toThrow('The response could not be saved.');
  });
});

it('replays saved planning cards and diagnostics without calling the model', async () => {
  const output = { date: '2030-01-07', reply: 'Preview only' };
  const debug = { events: [], omittedEvents: 0 };
  jest.mocked(conversationService.beginTurn).mockResolvedValue({
    ...turn,
    generationId: null,
    response: {
      ...reply,
      parts: [
        { type: 'data-planning', data: output },
        { type: 'data-plannerDebug', data: debug },
      ],
    },
  } as any);
  await aiDevService.streamChat('owner', input, signal);
  const writer = { write: jest.fn() };
  (jest.mocked(createUIMessageStream).mock.calls[0][0] as any).execute({ writer });
  expect(writer.write).toHaveBeenCalledWith({ type: 'data-planning', data: output });
  expect(writer.write).toHaveBeenCalledWith({ type: 'data-plannerDebug', data: debug });
  expect(resolveChatModel).not.toHaveBeenCalled();
});

it('rejects a text-only model when an earlier message contains an image and saves the failure', async () => {
  jest.mocked(conversationService.beginTurn).mockResolvedValue({
    ...turn,
    history: [
      {
        ...input.message,
        parts: [{ type: 'data-attachment', data: { attachmentId: input.conversationId } }],
      },
      input.message,
    ],
  } as any);
  jest
    .mocked(validateModelSelection)
    .mockRejectedValue(new Error('Select a vision-language model.'));
  await expect(aiDevService.streamChat('owner', input, signal)).rejects.toThrow('vision-language');
  expect(validateModelSelection).toHaveBeenCalledWith(turn.selection, ['chat', 'vision']);
  expect(streamText).not.toHaveBeenCalled();
  expect(conversationService.finishTurn).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    reply,
    'FAILED'
  );
});

describe('completeTurn', () => {
  it('replays a saved completed suggestion without inference', async () => {
    (conversationService.beginTurn as jest.Mock).mockResolvedValue({ ...turn, generationId: null });
    const generate = jest.fn();
    expect(await aiDevService.completeTurn('owner', input, signal, generate)).toEqual(reply);
    expect(generate).not.toHaveBeenCalled();
    expect(conversationService.finishTurn).not.toHaveBeenCalled();
  });
  it('fails a new extraction without photographs and records failure', async () => {
    const generate = jest.fn();
    await expect(aiDevService.completeTurn('owner', input, signal, generate)).rejects.toThrow(
      'photographs'
    );
    expect(generate).not.toHaveBeenCalled();
    expect(conversationService.finishTurn).toHaveBeenCalledWith(
      'owner',
      input.conversationId,
      'generation-1',
      reply,
      'FAILED'
    );
  });
  it('enforces vision capability before reading image bytes or generating', async () => {
    (conversationService.beginTurn as jest.Mock).mockResolvedValue({
      ...turn,
      history: [
        {
          ...input.message,
          parts: [{ type: 'data-attachment', data: { attachmentId: input.conversationId } }],
        },
      ],
    });
    (validateModelSelection as jest.Mock).mockRejectedValue(new Error('Vision required'));
    const generate = jest.fn();
    await expect(aiDevService.completeTurn('owner', input, signal, generate)).rejects.toThrow(
      'Vision required'
    );
    expect(validateModelSelection).toHaveBeenCalledWith(
      turn.selection,
      ['chat', 'vision'],
      expect.any(AbortSignal)
    );
    expect(generate).not.toHaveBeenCalled();
  });
});

it('completes a structured turn with all authorized photos and persists the exact reply', async () => {
  const history = [
    {
      ...input.message,
      parts: [{ type: 'data-attachment', data: { attachmentId: input.conversationId } }],
    },
  ];
  (conversationService.beginTurn as jest.Mock).mockResolvedValue({ ...turn, history });
  (attachmentService.retrieve as jest.Mock).mockResolvedValue({
    bytes: Buffer.from('photo'),
    metadata: { mimeType: 'image/png' },
  });
  (convertToModelMessages as jest.Mock).mockResolvedValue([
    { role: 'user', content: 'resolved images' },
  ]);
  const parts = [{ type: 'text' as const, text: 'Validated suggestion' }];
  const generate = jest.fn().mockResolvedValue(parts);
  const result = await aiDevService.completeTurn('owner', input, signal, generate);
  expect(attachmentService.retrieve).toHaveBeenCalledWith('owner', input.conversationId);
  expect(generate).toHaveBeenCalledWith({
    messages: [{ role: 'user', content: 'resolved images' }],
    selection: turn.selection,
    stageSelections: undefined,
    history,
    checkpoint: undefined,
    saveCheckpoint: expect.any(Function),
    signal: expect.any(AbortSignal),
  });
  expect(conversationService.finishTurn).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    { ...reply, parts },
    'COMPLETED'
  );
  expect(result.parts).toEqual(parts);
});
it('does not generate when an attachment cannot be read by the owner', async () => {
  (conversationService.beginTurn as jest.Mock).mockResolvedValue({
    ...turn,
    history: [
      {
        ...input.message,
        parts: [{ type: 'data-attachment', data: { attachmentId: input.conversationId } }],
      },
    ],
  });
  (attachmentService.retrieve as jest.Mock).mockRejectedValue(new Error('Attachment not found.'));
  const generate = jest.fn();
  await expect(aiDevService.completeTurn('owner', input, signal, generate)).rejects.toThrow(
    'Attachment not found.'
  );
  expect(generate).not.toHaveBeenCalled();
  expect(conversationService.finishTurn).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    reply,
    'FAILED'
  );
});

it('passes independent model snapshots and saves transcription before interpretation failure', async () => {
  const stageSelections = {
    transcription: turn.selection,
    interpretation: { provider: 'ollama', modelId: 'qwen3:8b' },
  };
  const history = [
    {
      ...input.message,
      parts: [{ type: 'data-attachment', data: { attachmentId: input.conversationId } }],
    },
  ];
  const checkpoint = { version: 'v1', evidence: [] };
  (conversationService.beginTurn as jest.Mock).mockResolvedValue({
    ...turn,
    stageSelections,
    history,
    checkpoint,
  });
  (attachmentService.retrieve as jest.Mock).mockResolvedValue({
    bytes: Buffer.from('photo'),
    metadata: { mimeType: 'image/png' },
  });
  const generate = jest.fn(async (context) => {
    expect(context.stageSelections).toEqual(stageSelections);
    expect(context.checkpoint).toEqual(checkpoint);
    expect(context.history).toEqual(history);
    await context.saveCheckpoint({ ...checkpoint, evidence: ['new transcription'] });
    throw new Error('Interpretation failed');
  });
  await expect(aiDevService.completeTurn('owner', input, signal, generate)).rejects.toThrow(
    'Interpretation failed'
  );
  expect(validateModelSelection).not.toHaveBeenCalled();
  expect(conversationService.saveCheckpoint).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    'a',
    { ...checkpoint, evidence: ['new transcription'] }
  );
  expect(conversationService.finishTurn).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    reply,
    'FAILED'
  );
});

it('retains safe checkpoint diagnostics when inference is cancelled before persistence', async () => {
  const controller = new AbortController();
  const history = [
    {
      ...input.message,
      parts: [{ type: 'data-attachment', data: { attachmentId: input.conversationId } }],
    },
  ];
  (conversationService.beginTurn as jest.Mock).mockResolvedValue({ ...turn, history });
  (attachmentService.retrieve as jest.Mock).mockResolvedValue({
    bytes: Buffer.from('photo'),
    metadata: { mimeType: 'image/png' },
  });
  const checkpoint = {
    lastFailure: { stage: 'interpretation', message: 'Text interpretation interrupted.' },
  };
  const generate = jest.fn(async (context) => {
    controller.abort();
    expect(context.signal.aborted).toBe(true);
    await context.saveCheckpoint(checkpoint);
    throw new Error('Text interpretation interrupted.');
  });
  await expect(
    aiDevService.completeTurn('owner', input, controller.signal, generate)
  ).rejects.toThrow('Text interpretation interrupted.');
  expect(conversationService.saveCheckpoint).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    'a',
    checkpoint
  );
  expect(conversationService.finishTurn).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    reply,
    'INTERRUPTED'
  );
});

it('delegates stage validation and preserves the stage failure and diagnostics from the pipeline', async () => {
  const stageSelections = {
    transcription: turn.selection,
    interpretation: { provider: 'ollama', modelId: 'qwen3:8b' },
  };
  const history = [
    {
      ...input.message,
      parts: [{ type: 'data-attachment', data: { attachmentId: input.conversationId } }],
    },
  ];
  const checkpoint = {
    version: 'v1',
    evidence: ['transcription retained'],
    lastFailure: { stage: 'interpretation', message: 'Text interpretation failed safely.' },
  };
  (conversationService.beginTurn as jest.Mock).mockResolvedValue({
    ...turn,
    stageSelections,
    history,
  });
  (attachmentService.retrieve as jest.Mock).mockResolvedValue({
    bytes: Buffer.from('photo'),
    metadata: { mimeType: 'image/png' },
  });
  // The staged generator validates models itself and may reuse evidence without invoking vision.
  (validateModelSelection as jest.Mock).mockRejectedValue(
    new Error('Shared preflight must not run')
  );
  const failure = new Error('Text interpretation failed safely.');
  const generate = jest.fn(async (context) => {
    await context.saveCheckpoint(checkpoint);
    throw failure;
  });
  await expect(aiDevService.completeTurn('owner', input, signal, generate)).rejects.toBe(failure);
  expect(validateModelSelection).not.toHaveBeenCalled();
  expect(conversationService.saveCheckpoint).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    'a',
    checkpoint
  );
  expect(conversationService.finishTurn).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'generation-1',
    reply,
    'FAILED'
  );
});

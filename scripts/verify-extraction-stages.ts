/** Opt-in real PostgreSQL checks: isolated schema, synthetic text, model discovery only. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { discoverModels } from '../lib/ai';
import { createConversationService, generationLeaseMs } from '../lib/ai-dev/conversations';
import { chatInputSchema, type StageSelections } from '../lib/ai-dev/schema';
import { prisma } from '../lib/prisma';

let phase = 'initialization';
async function main() {
  const schema = `extraction_stages_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` },
      { schema }
    ),
  });
  try {
    phase = 'isolated migration setup';
    const connection = await pool.connect();
    try {
      await connection.query(`CREATE SCHEMA "${schema}"`);
      await connection.query(`SET search_path TO "${schema}", public`);
      for (const migration of (await readdir('prisma/migrations'))
        .sort()
        .filter((entry) => entry.startsWith('20'))) {
        await connection.query(
          await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8')
        );
      }
    } finally {
      connection.release();
    }
    await db.user.createMany({
      data: ['alice', 'bob'].map((id) => ({ id, name: 'Synthetic', email: `${id}@example.test` })),
    });
    phase = 'installed model capability validation';
    const models = await discoverModels();
    const gemma = { provider: 'ollama' as const, modelId: 'gemma3:12b' };
    const qwen = { provider: 'ollama' as const, modelId: 'qwen3:8b' };
    assert(
      models.some((model) => model.id === gemma.modelId && model.capabilities.includes('vision'))
    );
    assert(
      models.some((model) => model.id === qwen.modelId && model.capabilities.includes('chat'))
    );
    const alternative = {
      provider: 'ollama' as const,
      modelId: models.find((model) => model.id === 'qwen3:14b')?.id ?? gemma.modelId,
    };
    const chat = createConversationService('nutrition-product', db);
    const { id } = await chat.create('alice', null);
    const input = chatInputSchema.parse({
      conversationId: id,
      message: {
        id: 'first',
        role: 'user',
        parts: [{ type: 'text', text: 'Synthetic extraction turn' }],
      },
    });
    const assistantRow = (messageId: string) =>
      db.aiMessage.findUniqueOrThrow({
        where: { conversationId_id: { conversationId: id, id: messageId } },
      });

    phase = 'independent override mutation and reload';
    await Promise.all([
      chat.changeStageModel('alice', id, 'transcription', gemma),
      chat.changeStageModel('alice', id, 'interpretation', alternative),
    ]);
    const restarted = createConversationService('nutrition-product', db);
    assert.deepEqual((await restarted.get('alice', id)).stageOverrides, {
      transcription: gemma,
      interpretation: alternative,
    });
    await restarted.changeModel('alice', id, null);
    assert.deepEqual((await restarted.get('alice', id)).stageOverrides, {
      transcription: null,
      interpretation: alternative,
    });
    await restarted.changeStageModel('alice', id, 'transcription', gemma);
    await restarted.changeStageModel('alice', id, 'interpretation', null);
    assert.deepEqual((await restarted.get('alice', id)).stageOverrides, {
      transcription: gemma,
      interpretation: null,
    });
    await assert.rejects(() => restarted.changeStageModel('alice', id, 'transcription', qwen), {
      code: 'MODEL_NOT_SUPPORTED',
    });
    assert.deepEqual((await restarted.get('alice', id)).stageOverrides, {
      transcription: gemma,
      interpretation: null,
    });
    await assert.rejects(
      () =>
        restarted.changeStageModel('alice', id, 'interpretation', {
          provider: 'ollama',
          modelId: `missing-${randomUUID()}`,
        }),
      { code: 'MODEL_NOT_FOUND' }
    );

    phase = 'resolved submission snapshots and inheritance';
    await restarted.changeStageModel('alice', id, 'transcription', null);
    // A broad default must not erase the new initial stage configuration.
    await db.userAiModelSetting.create({
      data: { userId: 'alice', key: 'default', value: alternative },
    });
    const first = await restarted.beginTurn('alice', input);
    const initial: StageSelections = { transcription: gemma, interpretation: qwen };
    assert.deepEqual(first.stageSelections, initial);
    assert.deepEqual((await assistantRow(first.response.id)).modelSelections, initial);
    assert.deepEqual(
      (first.response.metadata as { modelSelections: StageSelections }).modelSelections,
      initial
    );
    await assert.rejects(
      () => restarted.changeStageModel('alice', id, 'interpretation', alternative),
      {
        code: 'CONFLICT',
      }
    );
    // Changing Settings while generation is active cannot mutate its captured selections.
    await db.userAiModelSetting.create({
      data: { userId: 'alice', key: 'nutrition.productInterpretation', value: alternative },
    });
    assert.deepEqual(first.stageSelections, initial);

    phase = 'durable checkpoint failure and retry';
    assert(first.generationId);
    const checkpoint = {
      version: 'synthetic-v1',
      fingerprint: 'unchanged-photos',
      evidence: { cells: [{ id: 'cell-1', text: '10,0' }] },
      lastFailure: {
        stage: 'interpretation',
        message: 'Synthetic provider message not echoed to the client',
        diagnostics: { stage: 'interpretation', durationMs: 1 },
      },
    };
    await restarted.saveCheckpoint('alice', id, first.generationId, first.response.id, checkpoint);
    await restarted.finishTurn('alice', id, first.generationId, first.response, 'FAILED');
    assert.deepEqual((await assistantRow(first.response.id)).pipelineCheckpoint, checkpoint);
    const failed = await restarted.get('alice', id);
    assert.equal(failed.lastResponseStatus, 'FAILED');
    assert.deepEqual(failed.lastStageFailure, {
      stage: 'interpretation',
      label: 'Text interpretation',
      message: 'Text interpretation failed. Check the selected model and retry.',
    });
    assert.deepEqual(failed.messages[1].metadata, first.response.metadata);
    const retry = await createConversationService('nutrition-product', db).beginTurn(
      'alice',
      input
    );
    assert.equal(retry.response.id, first.response.id);
    assert.deepEqual(retry.checkpoint, checkpoint);
    assert.deepEqual(retry.stageSelections, { transcription: gemma, interpretation: alternative });
    assert.equal(await db.aiMessage.count({ where: { conversationId: id } }), 2);
    assert(retry.generationId);
    const completed = {
      ...retry.response,
      parts: [{ type: 'text' as const, text: 'Synthetic reviewed suggestion' }],
    };
    await restarted.finishTurn('alice', id, retry.generationId, completed, 'COMPLETED');
    // Completed replay keeps original attribution even after both defaults change.
    await db.userAiModelSetting.update({
      where: { userId_key: { userId: 'alice', key: 'nutrition.productInterpretation' } },
      data: { value: qwen },
    });
    const replay = await restarted.beginTurn('alice', input);
    assert.equal(replay.generationId, null);
    assert.deepEqual(replay.stageSelections, retry.stageSelections);
    assert.deepEqual(replay.response.metadata, retry.response.metadata);
    assert.equal((await restarted.get('alice', id)).lastStageFailure, null);

    phase = 'checkpoint reuse on a new text follow-up';
    const followInput = {
      ...input,
      message: {
        ...input.message,
        id: 'follow',
        parts: [{ type: 'text' as const, text: 'Synthetic user correction' }],
      },
    };
    const follow = await restarted.beginTurn('alice', followInput);
    assert.deepEqual(follow.checkpoint, checkpoint);
    assert(follow.generationId);
    await restarted.saveCheckpoint(
      'alice',
      id,
      follow.generationId,
      follow.response.id,
      checkpoint
    );

    phase = 'owner isolation and generation fencing';
    await assert.rejects(() => restarted.get('bob', id), { code: 'NOT_FOUND' });
    await assert.rejects(() => restarted.changeStageModel('bob', id, 'interpretation', qwen), {
      code: 'NOT_FOUND',
    });
    await assert.rejects(
      () =>
        restarted.saveCheckpoint('bob', id, follow.generationId!, follow.response.id, {
          version: 'foreign',
        }),
      { code: 'CONFLICT' }
    );
    await assert.rejects(
      () =>
        restarted.saveCheckpoint('alice', id, retry.generationId!, follow.response.id, {
          version: 'superseded',
        }),
      { code: 'CONFLICT' }
    );
    await restarted.finishTurn('alice', id, retry.generationId, completed, 'FAILED');
    assert.equal(
      (await db.aiConversation.findUniqueOrThrow({ where: { id } })).activeGenerationId,
      follow.generationId
    );
    assert.deepEqual((await assistantRow(follow.response.id)).pipelineCheckpoint, checkpoint);
    const beforeForeignTurn = await db.aiMessage.count();
    await assert.rejects(() => restarted.beginTurn('bob', followInput), { code: 'NOT_FOUND' });
    assert.equal(await db.aiMessage.count(), beforeForeignTurn);

    phase = 'long generation lease and expired lease recovery';
    await db.aiConversation.update({
      where: { id },
      data: { generationStartedAt: new Date(Date.now() - 200_000) },
    });
    assert.equal((await restarted.get('alice', id)).generating, true);
    await db.aiConversation.update({
      where: { id },
      data: { generationStartedAt: new Date(Date.now() - generationLeaseMs - 10_000) },
    });
    const expired = await restarted.get('alice', id);
    assert.equal(expired.generating, false);
    assert.equal(expired.lastResponseStatus, 'INTERRUPTED');
    const recovered = await restarted.beginTurn('alice', followInput);
    assert.deepEqual(recovered.checkpoint, checkpoint);
    assert(recovered.generationId);
    await assert.rejects(
      () =>
        restarted.saveCheckpoint('alice', id, follow.generationId!, follow.response.id, {
          version: 'expired',
        }),
      { code: 'CONFLICT' }
    );
    await restarted.finishTurn('alice', id, recovered.generationId, recovered.response, 'FAILED');
    assert.deepEqual((await assistantRow(recovered.response.id)).pipelineCheckpoint, checkpoint);

    phase = 'single-model consumer compatibility';
    const legacy = createConversationService('ai-dev', db);
    const oldConversation = await legacy.create('alice', qwen);
    const oldInput = { ...input, conversationId: oldConversation.id };
    const oldTurn = await legacy.beginTurn('alice', oldInput);
    assert.deepEqual(oldTurn.selection, qwen);
    assert.equal(oldTurn.stageSelections, undefined);
    assert.equal((await legacy.get('alice', oldConversation.id)).stageOverrides, undefined);
    assert(oldTurn.generationId);
    await legacy.finishTurn(
      'alice',
      oldConversation.id,
      oldTurn.generationId,
      oldTurn.response,
      'COMPLETED'
    );
    assert.deepEqual((await legacy.get('alice', oldConversation.id)).override, qwen);
    // An existing product conversation's old explicit selection maps only to transcription.
    const historical = await db.aiConversation.create({
      data: {
        userId: 'alice',
        scope: 'nutrition-product',
        provider: 'ollama',
        modelId: gemma.modelId,
        inheritsModel: false,
      },
    });
    assert.deepEqual((await restarted.get('alice', historical.id)).stageOverrides, {
      transcription: gemma,
      interpretation: null,
    });
    process.stdout.write(
      'Extraction stage persistence, concurrent independent overrides, snapshots, checkpoints, failure retries, ownership, lease fencing and legacy consumers passed.\n'
    );
  } finally {
    try {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await db.$disconnect();
      await pool.end();
      await prisma.$disconnect();
    }
  }
}
main().catch(() => {
  process.stderr.write(`Extraction stage verification failed during ${phase}.\n`);
  process.exitCode = 1;
});

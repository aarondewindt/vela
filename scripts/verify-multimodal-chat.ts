/** Real PostgreSQL/filesystem/AI SDK checks, isolated schema and synthetic images. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import { PrismaClient } from '../generated/prisma/client';
import { createConversationService } from '../lib/ai-dev/conversations';
import { reconstructModelMessages } from '../lib/ai-dev/multimodal';
import { chatInputSchema } from '../lib/ai-dev/schema';
import { createAttachmentService } from '../lib/attachments/service';
import { LocalFileStorage } from '../lib/storage/local';
import { prisma } from '../lib/prisma';

async function main() {
  const schema = `multimodal_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` },
      { schema }
    ),
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-multimodal-'));
  try {
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const migration of (await readdir('prisma/migrations'))
        .sort()
        .filter((entry) => entry.startsWith('20'))) {
        await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
      }
    } finally {
      client.release();
    }
    await db.user.createMany({
      data: ['alice', 'bob'].map((id) => ({ id, name: 'Synthetic', email: `${id}@example.test` })),
    });
    const uploads = createAttachmentService(() => new LocalFileStorage(directory), db);
    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const front = await uploads.upload('alice', bytes, 'front.png', 'image/png');
    const back = await uploads.upload('alice', bytes, 'back.png', 'image/png');
    const foreign = await uploads.upload('bob', bytes, 'private.png', 'image/png');
    const conversation = await db.aiConversation.create({
      data: {
        userId: 'alice',
        scope: 'nutrition-product',
        provider: 'ollama',
        modelId: 'synthetic',
        inheritsModel: false,
      },
    });
    const chat = createConversationService('nutrition-product', db);
    const input = chatInputSchema.parse({
      conversationId: conversation.id,
      message: {
        id: 'first',
        role: 'user',
        parts: [
          { type: 'text', text: 'Front' },
          { type: 'data-attachment', data: { attachmentId: front.id } },
          { type: 'text', text: 'Back' },
          { type: 'data-attachment', data: { attachmentId: back.id } },
        ],
      },
    });
    const turn = await chat.beginTurn('alice', input);
    await chat.finishTurn(
      'alice',
      conversation.id,
      turn.generationId!,
      { ...turn.response, parts: [{ type: 'text', text: 'Synthetic reply' }] },
      'COMPLETED'
    );
    // Fresh service and storage instances reconstruct the persisted conversation.
    const restarted = createConversationService('nutrition-product', db);
    const saved = await restarted.get('alice', conversation.id);
    assert.deepEqual(
      saved.messages[0].parts.map((part) => part.type),
      ['text', 'data-attachment', 'text', 'data-attachment']
    );
    const follow = await restarted.beginTurn('alice', {
      ...input,
      message: {
        id: 'follow',
        role: 'user',
        parts: [{ type: 'text', text: 'Read the earlier back photograph again' }],
      },
    });
    const messages = await reconstructModelMessages(
      'alice',
      follow.history,
      createAttachmentService(() => new LocalFileStorage(directory), db)
    );
    const original = messages[0];
    assert.equal(original.role, 'user');
    assert(Array.isArray(original.content));
    assert.deepEqual(
      original.content.map((part) => part.type),
      ['text', 'file', 'text', 'file']
    );
    assert.deepEqual(original.content[1], { type: 'file', data: bytes, mediaType: 'image/png' });
    await restarted.finishTurn(
      'alice',
      conversation.id,
      follow.generationId!,
      follow.response,
      'FAILED'
    );
    assert.equal(await db.attachment.count(), 3); // No copied history files.
    assert.deepEqual(
      (await readdir(directory)).sort(),
      [front.id, back.id, foreign.id].map((id) => `${id}.bin`).sort()
    );
    await assert.rejects(() => restarted.get('bob', conversation.id), { code: 'NOT_FOUND' });
    await assert.rejects(() => reconstructModelMessages('bob', follow.history, uploads), {
      code: 'NOT_FOUND',
    });
    await assert.rejects(() => uploads.remove('alice', front.id), { code: 'CONFLICT' });
    const before = await db.aiMessage.count();
    await assert.rejects(
      () =>
        restarted.beginTurn('alice', {
          ...input,
          message: {
            id: 'foreign',
            role: 'user',
            parts: [{ type: 'data-attachment', data: { attachmentId: foreign.id } }],
          },
        }),
      { code: 'NOT_FOUND' }
    );
    assert.equal(await db.aiMessage.count(), before);
    assert.equal(
      (await db.aiConversation.findUniqueOrThrow({ where: { id: conversation.id } }))
        .activeGenerationId,
      null
    );
    assert.equal(
      (await db.attachment.findUniqueOrThrow({ where: { id: foreign.id } })).retainedAt,
      null
    );
    const createProduct = (userId: string) =>
      db.product.create({
        data: {
          userId,
          name: 'Synthetic product',
          normalizedName: 'synthetic product',
          searchText: 'synthetic product',
          referenceQuantity: 100,
          referenceUnit: 'G',
          calories: 0,
          protein: 0,
          carbohydrates: 0,
          fat: 0,
        },
      });
    const product = await createProduct('alice');
    const otherProduct = await createProduct('bob');
    await assert.rejects(() => restarted.linkProduct('alice', conversation.id, otherProduct.id), {
      code: 'NOT_FOUND',
    });
    await assert.rejects(() => restarted.linkProduct('bob', conversation.id, otherProduct.id), {
      code: 'NOT_FOUND',
    });
    await restarted.linkProduct('alice', conversation.id, product.id);
    await restarted.linkProduct('alice', conversation.id, product.id);
    assert.equal((await restarted.listForProduct('alice', product.id))[0].id, conversation.id);
    assert.equal((await restarted.get('alice', conversation.id)).messages.length, before);
    await db.product.delete({ where: { id: product.id } });
    assert.equal((await restarted.get('alice', conversation.id)).productId, null);
    await restarted.delete('alice', conversation.id);
    assert.equal(await db.aiMessage.count(), 0);
    assert.deepEqual((await uploads.retrieve('alice', front.id)).bytes, bytes);
    process.stdout.write(
      'Multimodal persistence, binary history reconstruction, authorization, retention rollback and product lifecycle passed.\n'
    );
  } finally {
    try {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await db.$disconnect();
      await pool.end();
      await prisma.$disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
main().catch(() => {
  process.stderr.write('Multimodal integration checks failed.\n');
  process.exitCode = 1;
});

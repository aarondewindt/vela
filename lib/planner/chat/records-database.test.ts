/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@/generated/prisma/client');
  const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
  const schema = `planner_records_${require('node:crypto').randomBytes(8).toString('hex')}`;
  return {
    schema,
    prisma: new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` },
        { schema }
      ),
    }),
  };
});
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { prisma } from '@/lib/prisma';
import { workspaceRecords } from './records';
const { schema } = jest.requireMock('@/lib/prisma');
const suite = process.env.VELA_PLANNER_RECORD_DB_TESTS === '1' ? describe : describe.skip;
suite('workspace record proposals on isolated PostgreSQL', () => {
  const owner = randomUUID();
  const other = randomUUID();
  const conversationId = randomUUID();
  const messageId = 'synthetic-message';
  const propose = (title: string) =>
    workspaceRecords.propose(
      owner,
      conversationId,
      randomUUID(),
      {
        type: 'record',
        entity: 'task',
        action: 'create',
        query: null,
        task: { title },
        theme: null,
      },
      messageId
    );
  beforeAll(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const directory of readdirSync('prisma/migrations').sort()) {
        if (!directory.startsWith('20')) {
          continue;
        }
        await client.query(readFileSync(`prisma/migrations/${directory}/migration.sql`, 'utf8'));
      }
    } finally {
      await client.end();
    }
    await prisma.user.createMany({
      data: [owner, other].map((id) => ({
        id,
        name: 'Synthetic record test',
        email: `${id}@example.test`,
      })),
    });
    await prisma.aiConversation.create({
      data: {
        id: conversationId,
        userId: owner,
        scope: 'planner',
        provider: 'ollama',
        modelId: 'synthetic',
      },
    });
    await prisma.aiMessage.create({
      data: { conversationId, id: messageId, role: 'user', parts: [], position: 0 },
    });
  }, 30000);
  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  });
  it('accepts concurrently once, replays after deletion, rejects foreign reads and cascades conversation deletion', async () => {
    const preview = await propose('Synthetic report');
    await expect(workspaceRecords.get(other, conversationId, preview.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const accepted = await Promise.all([
      workspaceRecords.resolve(owner, conversationId, preview.id, 'accept'),
      workspaceRecords.resolve(owner, conversationId, preview.id, 'accept'),
    ]);
    expect(accepted.every((result) => result.accepted)).toBe(true);
    expect(await prisma.task.count({ where: { userId: owner } })).toBe(1);
    await prisma.task.deleteMany({ where: { userId: owner } });
    expect(
      (await workspaceRecords.resolve(owner, conversationId, preview.id, 'accept')).accepted
    ).toBe(true);
    expect(await prisma.task.count({ where: { userId: owner } })).toBe(0);
  });
  it('rejects stale edits and rolls back application writes when receipt persistence fails', async () => {
    const stale = await propose('Stale synthetic task');
    await prisma.theme.create({ data: { userId: owner, name: 'New context' } });
    await expect(
      workspaceRecords.resolve(owner, conversationId, stale.id, 'accept')
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const fresh = await propose('Rollback synthetic task');
    // A database constraint fails after applyRecord, proving the domain write and receipt share a transaction.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${schema}".planner_record_proposals ADD CONSTRAINT reject_test_accept CHECK (status <> 'ACCEPTED') NOT VALID`
    );
    try {
      await expect(
        workspaceRecords.resolve(owner, conversationId, fresh.id, 'accept')
      ).rejects.toThrow();
      expect(await prisma.task.count({ where: { userId: owner } })).toBe(0);
      expect((await workspaceRecords.get(owner, conversationId, fresh.id)).status).toBe('PENDING');
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${schema}".planner_record_proposals DROP CONSTRAINT reject_test_accept`
      );
    }
  });
  it('corrects a pending creation, resolves theme assignment, updates status and requires explicit task/theme deletion', async () => {
    await workspaceRecords.resolve(
      owner,
      conversationId,
      (await workspaceRecords.pending(owner, conversationId))!.id,
      'discard'
    );
    const theme = await prisma.theme.findFirstOrThrow({ where: { userId: owner } });
    const first = await workspaceRecords.propose(
      owner,
      conversationId,
      randomUUID(),
      {
        type: 'record',
        entity: 'task',
        action: 'create',
        query: null,
        task: { title: 'Relationship task', themeQuery: theme.id, estimatedMinutes: 45 },
        theme: null,
      },
      messageId
    );
    const corrected = await workspaceRecords.propose(
      owner,
      conversationId,
      randomUUID(),
      {
        type: 'record',
        entity: 'task',
        action: 'update',
        query: null,
        task: { estimatedMinutes: 60 },
        theme: null,
      },
      messageId,
      true
    );
    expect((await workspaceRecords.get(owner, conversationId, first.id)).status).toBe('SUPERSEDED');
    expect(corrected.preview.patch).toMatchObject({
      title: 'Relationship task',
      estimatedMinutes: 60,
      themeId: theme.id,
    });
    await workspaceRecords.resolve(owner, conversationId, corrected.id, 'accept');
    const task = await prisma.task.findFirstOrThrow({ where: { userId: owner } });
    const update = await workspaceRecords.propose(
      owner,
      conversationId,
      randomUUID(),
      {
        type: 'record',
        entity: 'task',
        action: 'update',
        query: task.id,
        task: { status: 'DONE', themeQuery: null },
        theme: null,
      },
      messageId
    );
    await workspaceRecords.resolve(owner, conversationId, update.id, 'accept');
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({
      status: 'DONE',
      themeId: null,
    });
    const deletion = await workspaceRecords.propose(
      owner,
      conversationId,
      randomUUID(),
      { type: 'record', entity: 'task', action: 'delete', query: task.id, task: null, theme: null },
      messageId
    );
    await expect(
      workspaceRecords.resolve(owner, conversationId, deletion.id, 'accept')
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await workspaceRecords.resolve(owner, conversationId, deletion.id, 'accept', true);
    expect(await prisma.task.count({ where: { userId: owner } })).toBe(0);
    const themeDeletion = await workspaceRecords.propose(
      owner,
      conversationId,
      randomUUID(),
      {
        type: 'record',
        entity: 'theme',
        action: 'delete',
        query: theme.id,
        task: null,
        theme: null,
      },
      messageId
    );
    await expect(
      workspaceRecords.resolve(owner, conversationId, themeDeletion.id, 'accept')
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await workspaceRecords.resolve(owner, conversationId, themeDeletion.id, 'accept', true);
    expect(await prisma.theme.count({ where: { userId: owner } })).toBe(0);
    await prisma.aiConversation.delete({ where: { id: conversationId } });
    expect(await prisma.plannerRecordProposal.count({ where: { conversationId } })).toBe(0);
  });
});

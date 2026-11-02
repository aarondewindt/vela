/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai/structured', () => ({ generateStructured: jest.fn() }));
jest.mock('@/lib/model-settings/service', () => ({ requireModelSelection: jest.fn() }));
jest.mock('@/lib/task-search/service', () => ({
  taskCollection: { status: jest.fn(), search: jest.fn() },
}));
jest.mock('@/lib/task-reviews/service', () => ({
  taskReviewService: { schedulerContext: jest.fn() },
}));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@/generated/prisma/client');
  const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
  const schema = `planner_drafts_${require('node:crypto').randomBytes(8).toString('hex')}`;
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
import { draftService } from './service';
import { editWorkingDraft } from './manual';
import { generateWorkingDraft } from './generation';
import { draftInstructions } from './planning';
import { draftCommandSchema } from './schema';
import type { z } from 'zod';
const { schema } = jest.requireMock('@/lib/prisma');
const suite = process.env.VELA_PLANNER_DRAFT_DB_TESTS === '1' ? describe : describe.skip;
const date = '2030-01-07';
const at = (time: string) => new Date(`${date}T${time}:00Z`);
suite('persistent draft lifecycle on isolated PostgreSQL', () => {
  let owner: string;
  let taskId: string;
  const command = async (): Promise<z.input<typeof draftCommandSchema>> => {
    const { draft } = await draftService.read(owner, date);
    return {
      date,
      requestId: randomUUID(),
      draftId: draft?.id ?? null,
      expectedVersion: draft?.version ?? 0,
    };
  };
  const add = async () => ({
    ...(await command()),
    origin: 'manual' as const,
    label: 'Place work',
    document: {
      schemaVersion: 1 as const,
      operations: [
        {
          type: 'add' as const,
          explanation: 'Place task',
          block: {
            kind: 'TASK' as const,
            taskId,
            occurrenceId: null,
            startsAt: at('10:00').toISOString(),
            endsAt: at('10:30').toISOString(),
          },
        },
      ],
    },
  });
  beforeAll(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const dir of readdirSync('prisma/migrations')
        .sort()
        .filter((d) => d.startsWith('20'))) {
        await client.query(readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8'));
      }
    } finally {
      await client.end();
    }
  }, 30000);
  beforeEach(async () => {
    owner = randomUUID();
    await prisma.user.create({
      data: {
        id: owner,
        name: 'Synthetic Planner',
        email: `${owner}@example.test`,
        timezone: 'UTC',
      },
    });
    taskId = (
      await prisma.task.create({
        data: { userId: owner, title: 'Synthetic work', estimatedMinutes: 60 },
      })
    ).id;
    await prisma.availabilityWindow.create({
      data: { userId: owner, weekday: 1, startMinute: 540, endMinute: 1020 },
    });
  });
  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  });
  it('starts empty, applies initiating edit, persists history, truncates redo and cancels safely', async () => {
    expect((await draftService.read(owner, date)).draft).toBeNull();
    const input = await add();
    const receipt = await draftService.apply(owner, input);
    expect(await draftService.apply(owner, input)).toEqual(receipt);
    expect(await prisma.dailyPlan.count({ where: { userId: owner } })).toBe(0);
    expect(await prisma.taskOccurrence.count({ where: { userId: owner } })).toBe(0);
    let draft = (await draftService.read(owner, date)).draft!;
    expect(draft.state.blocks).toHaveLength(1);
    expect(draft.canUndo).toBe(true);
    await expect(draftService.cancel(owner, await command())).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    await draftService.history(owner, await command(), 'undo');
    draft = (await draftService.read(owner, date)).draft!;
    expect(draft.modified).toBe(false);
    expect(draft.canRedo).toBe(true);
    await draftService.history(owner, await command(), 'redo');
    await draftService.history(owner, await command(), 'undo');
    await draftService.apply(owner, await add());
    expect((await draftService.read(owner, date)).draft?.canRedo).toBe(false);
    await draftService.cancel(owner, { ...(await command()), confirmed: true });
    expect((await draftService.read(owner, date)).draft).toBeNull();
    expect(await prisma.dailyPlan.count({ where: { userId: owner } })).toBe(0);
  });
  it('races create and edits without lost writes; rejects key reuse and foreign owners', async () => {
    const input = await add();
    const results = await Promise.allSettled([
      draftService.apply(owner, input),
      draftService.apply(owner, { ...input, requestId: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.plannerDraft.count({ where: { userId: owner, status: 'OPEN' } })).toBe(1);
    await expect(
      draftService.apply(owner, { ...input, label: 'Different payload' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const other = randomUUID();
    await prisma.user.create({
      data: { id: other, name: 'Other', email: `${other}@example.test` },
    });
    await expect(draftService.accept(other, await command())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('accepts atomically once, preserves old plan/checkins and never changes existing progress', async () => {
    const occurrence = await prisma.taskOccurrence.create({
      data: {
        userId: owner,
        taskId,
        occurrenceDate: at('00:00'),
        origin: 'MANUAL',
        status: 'SCHEDULED',
      },
    });
    const plan = await prisma.dailyPlan.create({
      data: { userId: owner, planDate: at('00:00'), timezone: 'UTC', status: 'ACTIVE' },
    });
    const block = await prisma.dailyBlock.create({
      data: {
        userId: owner,
        planId: plan.id,
        title: 'Original work',
        taskOccurrenceId: occurrence.id,
        startsAt: at('10:00'),
        endsAt: at('10:30'),
        durationMinutes: 30,
        source: 'PLANNER',
        category: 'WORK',
      },
    });
    const checkin = await prisma.checkin.create({
      data: {
        userId: owner,
        planId: plan.id,
        blockId: block.id,
        taskOccurrenceId: occurrence.id,
        brief: 'Synthetic historical check-in',
      },
    });
    const input = {
      ...(await command()),
      origin: 'manual' as const,
      label: 'Move task',
      document: {
        schemaVersion: 1 as const,
        operations: [
          {
            type: 'move' as const,
            blockId: block.id,
            startsAt: at('11:00').toISOString(),
            endsAt: at('11:30').toISOString(),
            explanation: 'Move work',
          },
        ],
      },
    };
    await draftService.apply(owner, input);
    expect(
      (await prisma.dailyBlock.findUniqueOrThrow({ where: { id: block.id } })).startsAt
    ).toEqual(at('10:00'));
    const accept = await command();
    const receipts = await Promise.all([
      draftService.accept(owner, accept),
      draftService.accept(owner, accept),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(await prisma.checkin.findUnique({ where: { id: checkin.id } })).toEqual(checkin);
    expect(await prisma.dailyPlan.count({ where: { userId: owner, isCurrent: true } })).toBe(1);
    expect(await prisma.dailyPlan.count({ where: { userId: owner } })).toBe(2);
    expect(
      (await prisma.dailyBlock.findUniqueOrThrow({ where: { id: block.id } })).startsAt
    ).toEqual(at('10:00'));
    expect(await prisma.taskOccurrence.findUnique({ where: { id: occurrence.id } })).toEqual(
      occurrence
    );
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('BACKLOG');
    const active = await prisma.dailyBlock.findFirstOrThrow({
      where: { userId: owner, plan: { isCurrent: true } },
    });
    expect(active).toMatchObject({
      taskOccurrenceId: occurrence.id,
      manualOverride: true,
      startsAt: at('11:00'),
    });
  });
  it('keeps stale drafts intact, supports explicit safe input refresh and rejects changed active bases', async () => {
    await draftService.apply(owner, await add());
    await prisma.task.update({ where: { id: taskId }, data: { estimatedMinutes: 75 } });
    expect((await draftService.read(owner, date)).draft?.conflicts.length).toBeGreaterThan(0);
    expect((await draftService.snapshot(owner, date, true)).draft?.stale).toBe(true);
    await expect(draftService.snapshot(owner, date)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(draftService.accept(owner, await command())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await draftService.refresh(owner, await command());
    expect((await draftService.read(owner, date)).draft?.conflicts).toEqual([]);
    await prisma.dailyPlan.create({
      data: { userId: owner, planDate: at('00:00'), timezone: 'UTC', status: 'ACTIVE' },
    });
    await expect(draftService.refresh(owner, await command())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await draftService.read(owner, date)).draft?.state.blocks).toHaveLength(1);
  });
  it('rolls promotion back if any later write fails', async () => {
    await draftService.apply(owner, await add());
    // Isolated-schema trigger exercises a real failure after plan/blocks are written.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".reject_draft_accept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'ACCEPTED' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER reject_draft_accept BEFORE UPDATE ON "${schema}".planner_drafts FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_draft_accept()`
    );
    try {
      await expect(draftService.accept(owner, await command())).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER reject_draft_accept ON "${schema}".planner_drafts`
      );
    }
    expect(await prisma.dailyPlan.count({ where: { userId: owner } })).toBe(0);
    expect(await prisma.taskOccurrence.count({ where: { userId: owner } })).toBe(0);
    expect((await draftService.read(owner, date)).draft?.state.blocks).toHaveLength(1);
  });
  it('routes manual add/move/resize through drafts, regenerates safely and retains manual placements', async () => {
    const input = {
      ...(await command()),
      action: 'add' as const,
      taskId,
      startsAt: `${date} 10:00:00`,
    };
    const first = await editWorkingDraft(owner, input);
    expect(await editWorkingDraft(owner, input)).toEqual(first);
    const before = (await draftService.read(owner, date)).draft!;
    const block = before.state.blocks[0];
    await editWorkingDraft(owner, {
      ...(await command()),
      action: 'time',
      blockId: block.id,
      startsAt: `${date} 11:00:00`,
      endsAt: `${date} 12:00:00`,
    });
    await editWorkingDraft(owner, {
      ...(await command()),
      action: 'time',
      blockId: block.id,
      startsAt: `${date} 11:00:00`,
      endsAt: `${date} 11:30:00`,
    });
    const generate = { ...(await command()), mode: 'deterministic' as const };
    const receipt = await generateWorkingDraft(owner, generate);
    expect(await generateWorkingDraft(owner, generate)).toEqual(receipt);
    const draft = (await draftService.read(owner, date)).draft!;
    expect(draft.state.blocks.find((b) => b.id === block.id)).toMatchObject({
      startsAt: at('11:00').toISOString(),
      endsAt: at('11:30').toISOString(),
      manualOverride: true,
    });
    expect(await prisma.dailyPlan.count({ where: { userId: owner } })).toBe(0);
    expect(await prisma.taskOccurrence.count({ where: { userId: owner } })).toBe(0);
    await generateWorkingDraft(owner, {
      ...(await command()),
      mode: 'deterministic',
      rebuild: true,
    });
    const rebuilt = (await draftService.read(owner, date)).draft!;
    expect(rebuilt.state.blocks.some((b) => b.id === block.id)).toBe(false);
    expect(rebuilt.state.blocks.some((b) => b.taskId === taskId)).toBe(true);
  });
  it('applies a multi-part conversational edit as exactly one persistent undo step', async () => {
    await draftService.apply(owner, await add());
    const before = (await draftService.read(owner, date)).draft!;
    const block = before.state.blocks[0];
    await draftInstructions(
      owner,
      randomUUID(),
      [
        {
          type: 'edit',
          date,
          action: 'move',
          blockQuery: block.id,
          candidateQuery: null,
          startTime: '11:00',
          endTime: '11:30',
          explanation: 'Move work',
        },
        {
          type: 'edit',
          date,
          action: 'resize',
          blockQuery: block.id,
          candidateQuery: null,
          startTime: '11:00',
          endTime: '11:45',
          explanation: 'Longer work',
        },
      ],
      'UTC'
    );
    const after = (await draftService.read(owner, date)).draft!;
    expect(after.version).toBe(before.version + 1);
    expect(after.state.blocks[0]).toMatchObject({
      taskId,
      startsAt: at('11:00').toISOString(),
      durationMinutes: 45,
    });
    await draftService.history(owner, await command(), 'undo');
    expect((await draftService.read(owner, date)).draft?.state.blocks[0].startsAt).toBe(
      at('10:00').toISOString()
    );
  });
  it('validates category edits against the same whole draft and rolls invalid reservations back', async () => {
    await draftService.apply(owner, await add());
    await draftService.slot(owner, {
      ...(await command()),
      action: 'add',
      category: 'WORK',
      startsAt: at('10:00').toISOString(),
      endsAt: at('11:00').toISOString(),
    });
    const before = (await draftService.read(owner, date)).draft!;
    await expect(
      draftService.slot(owner, {
        ...(await command()),
        action: 'add',
        category: 'LIFE',
        startsAt: at('10:00').toISOString(),
        endsAt: at('11:00').toISOString(),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await draftService.read(owner, date)).draft?.version).toBe(before.version);
    await draftService.accept(owner, await command());
    expect(
      await prisma.dailyPlanCategorySlot.count({
        where: { plan: { userId: owner, isCurrent: true } },
      })
    ).toBe(1);
  });
  it('races distinct acceptance requests without producing two active versions', async () => {
    await draftService.apply(owner, await add());
    const first = await command();
    const results = await Promise.allSettled([
      draftService.accept(owner, first),
      draftService.accept(owner, { ...first, requestId: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.dailyPlan.count({ where: { userId: owner, isCurrent: true } })).toBe(1);
  });
  it('retains unaccepted past-day drafts without promoting them', async () => {
    const past = '2000-01-03';
    await draftService.begin(owner, {
      date: past,
      requestId: randomUUID(),
      draftId: null,
      expectedVersion: 0,
    });
    const draft = (await draftService.read(owner, past)).draft!;
    await expect(
      draftService.accept(owner, {
        date: past,
        requestId: randomUUID(),
        draftId: draft.id,
        expectedVersion: draft.version,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await draftService.read(owner, past)).draft?.id).toBe(draft.id);
    expect(
      await prisma.dailyPlan.count({
        where: { userId: owner, planDate: new Date(`${past}T00:00:00Z`), isCurrent: true },
      })
    ).toBe(0);
  });
});

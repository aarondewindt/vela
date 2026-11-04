/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@/generated/prisma/client');
  const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
  const schema = `planner_availability_${require('node:crypto').randomBytes(8).toString('hex')}`;
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

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';
import { prisma } from '@/lib/prisma';
import { availabilityService } from './service';

const { schema } = jest.requireMock('@/lib/prisma');
const suite = process.env.VELA_AVAILABILITY_DB_TESTS === '1' ? describe : describe.skip;
const now = new Date('2026-11-03T12:00:00.000Z');
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const slot = (logicalSlotId?: string) => ({
  ...(logicalSlotId ? { logicalSlotId } : {}),
  startMinute: 9 * 60,
  endMinute: 12 * 60,
  name: 'Deep work',
  guidance: 'Prefer difficult work.',
  policy: { mode: 'ALLOW_ONLY' as const, categories: ['WORK' as const] },
});

suite('versioned availability persistence on isolated PostgreSQL', () => {
  let owner: string;
  let other: string;

  beforeAll(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const directory of readdirSync('prisma/migrations')
        .sort()
        .filter((entry) => entry.startsWith('20'))) {
        await client.query(readFileSync(`prisma/migrations/${directory}/migration.sql`, 'utf8'));
      }
    } finally {
      await client.end();
    }
  }, 30000);

  beforeEach(async () => {
    await prisma.plannerDraftRequest.deleteMany();
    await prisma.plannerDraftRevision.deleteMany();
    await prisma.plannerDraft.deleteMany();
    await prisma.dailyPlan.deleteMany();
    await prisma.dateAvailabilityOverride.deleteMany();
    await prisma.weeklyAvailabilityAssignment.deleteMany();
    await prisma.plannerTimezonePeriod.deleteMany();
    await prisma.availabilityTemplateRevisionSlot.deleteMany();
    await prisma.availabilityTemplateRevision.deleteMany();
    await prisma.availabilityTemplateSlot.deleteMany();
    await prisma.availabilityTemplate.deleteMany();
    await prisma.dayOverride.deleteMany();
    await prisma.user.deleteMany();
    owner = randomUUID();
    other = randomUUID();
    await prisma.user.createMany({
      data: [
        { id: owner, name: 'Owner', email: `${owner}@example.test`, timezone: 'Europe/Amsterdam' },
        { id: other, name: 'Other', email: `${other}@example.test`, timezone: 'UTC' },
      ],
    });
    await prisma.plannerTimezonePeriod.create({
      data: { userId: owner, effectiveDate: date('2020-01-01'), timezone: 'Europe/Amsterdam' },
    });
    await prisma.plannerTimezonePeriod.create({
      data: { userId: other, effectiveDate: date('2020-01-01'), timezone: 'UTC' },
    });
  });

  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('versions stable logical slots and resolves historical revisions and assignments', async () => {
    const created = await availabilityService.createTemplate(
      owner,
      { name: 'Weekday', slots: [slot()] },
      now
    );
    const templateId = created.template.id;
    const logicalSlotId = created.template.logicalSlots[0].id;
    expect(created.template.revisions[0].effectiveDate).toEqual(date('2026-11-04'));

    await availabilityService.assignWeekday(
      owner,
      { weekday: 3, templateId, effectiveDate: '2026-11-04' },
      now
    );
    const earlier = await availabilityService.resolve(owner, '2026-11-04');
    expect(earlier.snapshot).toMatchObject({
      origin: 'WEEKLY_ASSIGNMENT',
      templateName: 'Weekday',
      slots: [{ logicalSlotId, name: 'Deep work' }],
    });

    await availabilityService.reviseTemplate(
      owner,
      templateId,
      {
        name: 'Weekday v2',
        effectiveDate: '2026-11-11',
        slots: [
          { ...slot(logicalSlotId), name: 'Focused work' },
          { ...slot(), startMinute: 13 * 60, endMinute: 14 * 60 },
        ],
      },
      now
    );
    await availabilityService.assignWeekday(
      owner,
      { weekday: 3, templateId, effectiveDate: '2026-11-11' },
      now
    );
    expect((await availabilityService.resolve(owner, '2026-11-04')).snapshot.templateName).toBe(
      'Weekday'
    );
    const later = (await availabilityService.resolve(owner, '2026-11-11')).snapshot;
    expect(later.templateName).toBe('Weekday v2');
    expect(later.slots[0].logicalSlotId).toBe(logicalSlotId);
    expect(later.slots[1].logicalSlotId).not.toBe(logicalSlotId);

    const duplicate = await availabilityService.duplicateTemplate(
      owner,
      templateId,
      { name: 'Independent copy', effectiveDate: '2026-11-11' },
      now
    );
    expect(duplicate.template.logicalSlots.map(({ id }) => id)).not.toContain(logicalSlotId);

    await availabilityService.reviseTemplate(
      owner,
      templateId,
      {
        name: 'Deleted first slot',
        effectiveDate: '2026-11-12',
        slots: [
          {
            ...slot(later.slots[1].logicalSlotId!),
            startMinute: 13 * 60,
            endMinute: 14 * 60,
          },
        ],
      },
      now
    );
    await expect(
      availabilityService.reviseTemplate(
        owner,
        templateId,
        {
          name: 'Must not resurrect identity',
          effectiveDate: '2026-11-13',
          slots: [slot(logicalSlotId)],
        },
        now
      )
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('does not let an inserted revision resurrect a logical slot in an existing future revision', async () => {
    const created = await availabilityService.createTemplate(
      owner,
      { name: 'Weekday', effectiveDate: '2026-11-04', slots: [slot()] },
      now
    );
    const templateId = created.template.id;
    const logicalSlotId = created.template.logicalSlots[0].id;
    await availabilityService.reviseTemplate(
      owner,
      templateId,
      {
        name: 'Already scheduled future revision',
        effectiveDate: '2026-11-06',
        slots: [slot(logicalSlotId)],
      },
      now
    );

    await expect(
      availabilityService.reviseTemplate(
        owner,
        templateId,
        { name: 'Delete the slot first', effectiveDate: '2026-11-05', slots: [] },
        now
      )
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('versions Planner timezone and archives only after future assignments are removed', async () => {
    const draft = await prisma.plannerDraft.create({
      data: {
        userId: owner,
        planDate: date('2026-11-03'),
        timezone: 'Europe/Amsterdam',
        baseHash: 'a'.repeat(64),
        baseState: {},
        revisions: { create: { sequence: 0, state: {}, label: 'Initial' } },
      },
    });
    const timezone = await availabilityService.setTimezone(
      owner,
      { timezone: 'Europe/London' },
      now
    );
    expect(timezone.value).toMatchObject({ timezone: 'Europe/London' });
    expect(timezone.impact.openDrafts).toEqual([
      expect.objectContaining({ id: draft.id, date: '2026-11-03' }),
    ]);

    const created = await availabilityService.createTemplate(
      owner,
      { name: 'Weekday', effectiveDate: '2026-11-04', slots: [slot()] },
      now
    );
    await availabilityService.assignWeekday(
      owner,
      { weekday: 3, templateId: created.template.id, effectiveDate: '2026-11-04' },
      now
    );
    await expect(
      availabilityService.archiveTemplate(owner, created.template.id, now)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await availabilityService.assignWeekday(
      owner,
      { weekday: 3, templateId: null, effectiveDate: '2026-11-04' },
      now
    );
    await expect(
      availabilityService.archiveTemplate(other, created.template.id, now)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      availabilityService.restoreTemplate(other, created.template.id)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await availabilityService.archiveTemplate(owner, created.template.id, now)
    ).toMatchObject({
      id: created.template.id,
      archivedAt: now,
    });
    expect(await availabilityService.restoreTemplate(owner, created.template.id)).toEqual({
      id: created.template.id,
      archivedAt: null,
    });
  });

  it('uses independent date snapshots, preserves unrelated day context on reset and isolates owners', async () => {
    const created = await availabilityService.createTemplate(
      owner,
      { name: 'Weekday', effectiveDate: '2026-11-04', slots: [slot()] },
      now
    );
    const templateId = created.template.id;
    await availabilityService.assignWeekday(
      owner,
      { weekday: 4, templateId, effectiveDate: '2026-11-05' },
      now
    );
    const legacy = await prisma.dayOverride.create({
      data: { userId: owner, overrideDate: date('2026-11-05'), brief: 'Keep this context' },
    });
    await availabilityService.setDateOverride(
      owner,
      {
        date: '2026-11-05',
        slots: [{ ...slot(), startMinute: 13 * 60, endMinute: 14 * 60 }],
      },
      now
    );
    const overridden = (await availabilityService.resolve(owner, '2026-11-05')).snapshot;
    expect(overridden).toMatchObject({ origin: 'DATE_OVERRIDE' });
    expect(overridden.slots[0].id).not.toBe(created.template.logicalSlots[0].id);

    await availabilityService.setDateOverride(owner, { date: '2026-11-05', slots: [] }, now);
    expect((await availabilityService.resolve(owner, '2026-11-05')).snapshot).toMatchObject({
      origin: 'DATE_OVERRIDE',
      slots: [],
    });
    await availabilityService.resetDateOverride(owner, '2026-11-05', now);
    expect((await availabilityService.resolve(owner, '2026-11-05')).snapshot.origin).toBe(
      'WEEKLY_ASSIGNMENT'
    );
    expect(await prisma.dayOverride.findUnique({ where: { id: legacy.id } })).toMatchObject({
      brief: 'Keep this context',
    });

    await expect(
      availabilityService.assignWeekday(
        other,
        { weekday: 4, templateId, effectiveDate: '2026-11-05' },
        now
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports only open drafts whose canonical availability changes and exposes provenance fields', async () => {
    const created = await availabilityService.createTemplate(
      owner,
      { name: 'Weekday', effectiveDate: '2026-11-04', slots: [slot()] },
      now
    );
    const templateId = created.template.id;
    const logicalSlotId = created.template.logicalSlots[0].id;
    await availabilityService.assignWeekday(
      owner,
      { weekday: 4, templateId, effectiveDate: '2026-11-05' },
      now
    );
    const draft = await prisma.plannerDraft.create({
      data: {
        userId: owner,
        planDate: date('2026-11-05'),
        timezone: 'Europe/Amsterdam',
        baseHash: 'a'.repeat(64),
        baseState: {},
        revisions: { create: { sequence: 0, state: {}, label: 'Initial' } },
      },
    });
    const revision = await availabilityService.reviseTemplate(
      owner,
      templateId,
      {
        name: 'Renamed',
        effectiveDate: '2026-11-05',
        slots: [{ ...slot(logicalSlotId), guidance: 'Changed guidance only.' }],
      },
      now
    );
    expect(revision.impact.openDrafts).toEqual([
      expect.objectContaining({ id: draft.id, date: '2026-11-05' }),
    ]);

    const resolved = await availabilityService.resolve(owner, '2026-11-05');
    const storedSnapshot = JSON.parse(JSON.stringify(resolved.snapshot));
    const plan = await prisma.dailyPlan.create({
      data: {
        userId: owner,
        planDate: date('2026-11-05'),
        timezone: 'Europe/Amsterdam',
        availabilityHash: resolved.hash,
        availabilitySnapshot: storedSnapshot,
      },
    });
    await prisma.plannerDraftRevision.update({
      where: { draftId_sequence: { draftId: draft.id, sequence: 0 } },
      data: {
        generationAvailabilityHash: resolved.hash,
        generationAvailabilitySnapshot: storedSnapshot,
      },
    });
    expect(resolved.hash).toHaveLength(64);
    expect(await prisma.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({
      availabilityHash: resolved.hash,
      availabilitySnapshot: expect.objectContaining({ schemaVersion: 1 }),
    });
    expect(
      await prisma.plannerDraftRevision.findUniqueOrThrow({
        where: { draftId_sequence: { draftId: draft.id, sequence: 0 } },
      })
    ).toMatchObject({
      generationAvailabilityHash: resolved.hash,
      generationAvailabilitySnapshot: expect.objectContaining({ schemaVersion: 1 }),
    });
  });

  it('cascades owner deletion through versioned records', async () => {
    const disposableOwner = randomUUID();
    await prisma.user.create({
      data: {
        id: disposableOwner,
        name: 'Disposable',
        email: `${disposableOwner}@example.test`,
        timezone: 'UTC',
      },
    });
    const created = await availabilityService.createTemplate(
      disposableOwner,
      { name: 'Disposable template', effectiveDate: '2026-11-04', slots: [slot()] },
      now
    );
    await availabilityService.assignWeekday(
      disposableOwner,
      { weekday: 3, templateId: created.template.id, effectiveDate: '2026-11-04' },
      now
    );
    await prisma.user.delete({ where: { id: disposableOwner } });
    expect(await prisma.availabilityTemplate.count({ where: { id: created.template.id } })).toBe(0);
    expect(
      await prisma.availabilityTemplateSlot.count({
        where: { templateId: created.template.id },
      })
    ).toBe(0);
    expect(
      await prisma.weeklyAvailabilityAssignment.count({ where: { userId: disposableOwner } })
    ).toBe(0);
  });

  it('serializes competing revisions and rolls the conflict back without partial slots', async () => {
    const created = await availabilityService.createTemplate(
      owner,
      { name: 'Weekday', effectiveDate: '2026-11-04', slots: [slot()] },
      now
    );
    const templateId = created.template.id;
    const logicalSlotId = created.template.logicalSlots[0].id;
    const results = await Promise.allSettled([
      availabilityService.reviseTemplate(
        owner,
        templateId,
        { name: 'Revision A', effectiveDate: '2026-11-05', slots: [slot(logicalSlotId)] },
        now
      ),
      availabilityService.reviseTemplate(
        owner,
        templateId,
        { name: 'Revision B', effectiveDate: '2026-11-05', slots: [slot(logicalSlotId)] },
        now
      ),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await prisma.availabilityTemplateRevision.count({ where: { templateId } })).toBe(2);
    expect(await prisma.availabilityTemplateSlot.count({ where: { templateId } })).toBe(1);
  });
});

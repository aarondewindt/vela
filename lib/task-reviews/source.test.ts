/** @jest-environment node */
jest.mock('server-only', () => ({}));
import type { Prisma } from '@/generated/prisma/client';
import { loadReviewSource } from './source';

const notes = [{ content: [{ text: 'Recorded progress' }] }];
let task: Record<string, unknown>;
let dependencies: Record<string, unknown>[];
let blocks: Record<string, unknown>[];
let checkins: Record<string, unknown>[];
let themes: Record<string, unknown>[];
let occurrences: Record<string, unknown>[];
const db = {
  theme: { findMany: jest.fn(async () => themes) },
  task: { findFirst: jest.fn(async () => task) },
  user: { findUniqueOrThrow: jest.fn(async () => ({ timezone: 'Europe/Amsterdam' })) },
  taskDependency: { findMany: jest.fn(async () => dependencies) },
  taskOccurrence: { findMany: jest.fn(async () => occurrences) },
  dailyBlock: { findMany: jest.fn(async () => blocks) },
  checkin: { findMany: jest.fn(async () => checkins) },
};
const load = (date = '2026-10-19T12:00:00Z') =>
  loadReviewSource(db as unknown as Prisma.TransactionClient, 'owner', 'task', new Date(date));
beforeEach(() => {
  themes = [{ id: 'theme', name: 'Project', updatedAt: 'v1' }];
  task = {
    id: 'task',
    title: 'Draft',
    updatedAt: 'v1',
    content: notes,
    theme: { id: 'theme', userId: 'owner', updatedAt: 'theme-v1', content: notes },
  };
  dependencies = [
    {
      id: 'dependency',
      blockedTask: { userId: 'owner', content: [] },
      dependsOnTask: { userId: 'owner', content: [], status: 'BACKLOG' },
    },
  ];
  blocks = [{ id: 'block', content: [], status: 'PLANNED' }];
  checkins = [{ id: 'checkin', content: notes }];
  occurrences = [{ id: 'occurrence', status: 'PENDING' }];
});
it('captures rich text, versions and recorded progress in a deterministic source', async () => {
  const first = await load();
  expect(first.source).toMatchObject({
    version: 2,
    timezone: 'Europe/Amsterdam',
    asOfDate: '2026-10-19',
    task: { notes: 'Recorded progress', updatedAt: 'v1' },
    theme: { updatedAt: 'theme-v1' },
    checkins: [{ notes: 'Recorded progress' }],
  });
  expect((await load()).hash).toBe(first.hash);
});
it.each([
  'task',
  'theme',
  'dependency',
  'block',
  'checkin',
  'occurrence',
  'available theme',
  'date',
])('invalidates after a %s change', async (kind) => {
  const initial = (await load()).hash;
  if (kind === 'task') {
    task.title = 'Changed';
  }
  if (kind === 'theme') {
    (task.theme as Record<string, unknown>).updatedAt = 'theme-v2';
  }
  if (kind === 'available theme') {
    themes[0].name = 'Changed project';
  }
  if (kind === 'dependency') {
    dependencies = [];
  }
  if (kind === 'block') {
    blocks[0].status = 'DONE';
  }
  if (kind === 'checkin') {
    checkins.push({ id: 'new', content: [] });
  }
  if (kind === 'occurrence') {
    occurrences[0].status = 'DONE';
  }
  expect((await load(kind === 'date' ? '2026-10-19T23:00:00Z' : undefined)).hash).not.toBe(initial);
});
it('uses owner filters and excludes malformed cross-owner relationships', async () => {
  task.theme = { userId: 'other', content: notes };
  dependencies[0].dependsOnTask = { userId: 'other', content: notes };
  const result = await load();
  expect(db.task.findFirst).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { id: 'task', userId: 'owner' } })
  );
  expect(db.theme.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { userId: 'owner', isActive: true } })
  );
  expect(result.source.theme).toBeNull();
  expect(result.source.dependencies).toEqual([]);
});
it('refuses oversized history and text instead of silently discarding evidence', async () => {
  occurrences = Array(201).fill({});
  await expect(load()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  occurrences = [];
  task.title = 'x'.repeat(51000);
  await expect(load()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

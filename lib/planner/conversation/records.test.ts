/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('../service', () => ({
  plannerService: {
    createTask: jest.fn(),
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
    createTheme: jest.fn(),
    updateTheme: jest.fn(),
    deleteTheme: jest.fn(),
  },
}));
import { plannerService } from '../service';
import { applyRecord, previewRecord, recordContext, type RecordContext } from './records';
import { Clarification, findMatches, resolveOne } from './resolve';
import type { Instruction } from './schema';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const task = {
  id: id(1),
  title: 'Write report',
  status: 'BACKLOG',
  themeId: id(2),
  updatedAt: new Date(0),
};
const theme = { id: id(2), name: 'Work', updatedAt: new Date(0) };
const tx = {
  task: { findMany: jest.fn() },
  theme: { findMany: jest.fn() },
  taskOccurrence: { findMany: jest.fn() },
  dailyBlock: { findMany: jest.fn() },
  taskDependency: { findMany: jest.fn() },
};
let context: RecordContext;
beforeEach(async () => {
  jest.resetAllMocks();
  tx.task.findMany.mockResolvedValue([task]);
  tx.theme.findMany.mockResolvedValue([theme]);
  tx.taskOccurrence.findMany.mockResolvedValue([]);
  tx.dailyBlock.findMany.mockResolvedValue([]);
  tx.taskDependency.findMany.mockResolvedValue([]);
  context = await recordContext(tx as any, 'owner');
});
const instruction = (
  values: Partial<Extract<Instruction, { type: 'record' }>> = {}
): Extract<Instruction, { type: 'record' }> => ({
  type: 'record',
  entity: 'task',
  action: 'update',
  query: 'Write report',
  task: { priority: 1 },
  theme: null,
  ...values,
});
it('resolves exact matches first, rejects ambiguous and missing references', () => {
  const records = [
    { id: id(1), label: 'Report' },
    { id: id(2), label: 'Report draft' },
  ];
  expect(resolveOne(records, 'report', 'task').id).toBe(id(1));
  expect(() => resolveOne([...records, { id: id(3), label: 'Report' }], 'Report', 'task')).toThrow(
    Clarification
  );
  expect(() => resolveOne(records, null, 'task')).toThrow('Which task');
  expect(() => resolveOne(records, 'foreign ID', 'task')).toThrow('No task matches');
  expect(findMatches(records, 'draft')).toEqual([records[1]]);
});
it('previews supported properties and owner-scoped theme relationships without writing', () => {
  const preview = previewRecord(
    context,
    instruction({
      task: { themeQuery: 'Work', dueDate: '2026-10-21', tags: ['urgent'], brief: null },
    })
  );
  expect(preview.patch).toEqual({
    themeId: id(2),
    dueDate: '2026-10-21',
    tags: ['urgent'],
    brief: null,
  });
  expect(preview.before?.title).toBe(task.title);
  expect(plannerService.updateTask).not.toHaveBeenCalled();
  expect(() =>
    previewRecord(context, instruction({ task: { themeQuery: 'Other owner theme' } }))
  ).toThrow(Clarification);
});
it('keeps pending creation fields through corrections and rejects duplicate creation names', () => {
  const first = previewRecord(
    context,
    instruction({
      action: 'create',
      query: null,
      task: { title: 'New task', priority: 2, themeQuery: 'Work' },
    })
  );
  const corrected = previewRecord(
    context,
    instruction({ action: 'create', query: null, task: { estimatedMinutes: 45 } }),
    first
  );
  expect(corrected.patch).toEqual({
    title: 'New task',
    priority: 2,
    themeId: id(2),
    estimatedMinutes: 45,
  });
  expect(() =>
    previewRecord(context, instruction({ action: 'create', task: { title: task.title } }))
  ).toThrow('already exists');
});
it('does not carry properties across changed source versions', () => {
  const first = previewRecord(context, instruction());
  expect(() =>
    previewRecord({ ...context, hash: 'changed' }, instruction({ task: {} }), first)
  ).toThrow('Which properties');
});
it('requires explicit deletion confirmation and rechecks the source before writes', async () => {
  const preview = previewRecord(context, instruction({ action: 'delete', task: null }));
  await expect(applyRecord(tx as any, 'owner', preview, false)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(plannerService.deleteTask).not.toHaveBeenCalled();
  tx.task.findMany.mockResolvedValue([{ ...task, title: 'Changed' }]);
  await expect(applyRecord(tx as any, 'owner', preview, true)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(plannerService.deleteTask).not.toHaveBeenCalled();
});
it('creates and patches atomically using the existing task service and supplied transaction', async () => {
  const preview = previewRecord(
    context,
    instruction({ action: 'create', task: { title: 'New', priority: 1, status: 'DONE' } })
  );
  jest.mocked(plannerService.createTask).mockResolvedValue({ id: id(3) } as any);
  expect(await applyRecord(tx as any, 'owner', preview, false)).toEqual({ id: id(3) });
  expect(plannerService.updateTask).toHaveBeenCalledWith('owner', id(3), preview.patch, tx);
});
it('supports explicit theme deletion with affected-task preview', async () => {
  const preview = previewRecord(
    context,
    instruction({ entity: 'theme', action: 'delete', query: 'Work', task: null })
  );
  expect(preview.warnings[0]).toContain('1 tasks will lose this theme');
  await applyRecord(tx as any, 'owner', preview, true);
  expect(plannerService.deleteTheme).toHaveBeenCalledWith('owner', id(2), tx);
});
it('bounds inventory and scopes every source query to the owner', async () => {
  expect(tx.task.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'owner' } })
  );
  tx.task.findMany.mockResolvedValue(Array(1001).fill(task));
  await expect(recordContext(tx as any, 'owner')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
it('resolves explicit relative deadlines deterministically without interpreting quoted titles', async () => {
  const { relativeDueDate } = await import('./resolve');
  expect(relativeDueDate('Create "Report" due tomorrow', '2026-10-20')).toBe('2026-10-21');
  expect(relativeDueDate('Make it due by yesterday', '2026-01-01')).toBe('2025-12-31');
  expect(relativeDueDate('Create "Something due tomorrow"', '2026-10-20')).toBeUndefined();
  expect(
    relativeDueDate('Create a task called Due tomorrow', '2026-10-20', 'Due tomorrow')
  ).toBeUndefined();
  expect(relativeDueDate('Due today or due tomorrow', '2026-10-20')).toBeUndefined();
});
it('creates and edits theme properties through the shared transactional service', async () => {
  const preview = previewRecord(
    context,
    instruction({
      entity: 'theme',
      action: 'create',
      query: null,
      task: null,
      theme: {
        name: 'Home',
        category: 'LIFE',
        isActive: true,
        brief: 'House projects',
        color: 'blue',
      },
    })
  );
  jest.mocked(plannerService.createTheme).mockResolvedValue({ id: id(5) } as any);
  expect(await applyRecord(tx as any, 'owner', preview, false)).toEqual({ id: id(5) });
  expect(plannerService.updateTheme).toHaveBeenCalledWith('owner', id(5), preview.patch, tx);
});

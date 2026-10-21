jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/prisma', () => {
  const model = () => ({
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  });
  return {
    prisma: {
      user: model(),
      task: model(),
      taskOccurrence: model(),
      availabilityWindow: model(),
      dayOverride: model(),
      dailyPlan: model(),
      taskDependency: model(),
      calendarEvent: model(),
      dailyBlock: model(),
      $transaction: jest.fn(),
    },
  };
});

import { prisma } from '@/lib/prisma';
import { plannerService } from './service';
import { DEFAULT_GENERATOR_OPTIONS } from './scheduling';

type Model = Record<
  | 'findMany'
  | 'findFirst'
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'create'
  | 'createMany'
  | 'updateMany'
  | 'upsert',
  jest.Mock
>;
const db = prisma as unknown as Record<
  | 'user'
  | 'task'
  | 'taskOccurrence'
  | 'availabilityWindow'
  | 'dayOverride'
  | 'dailyPlan'
  | 'taskDependency'
  | 'calendarEvent'
  | 'dailyBlock',
  Model
> & {
  $transaction: jest.Mock;
};
const date = '2026-10-19';
const instant = (time: string) => new Date(`${date}T${time}:00Z`);
const options = { ...DEFAULT_GENERATOR_OPTIONS, leisureMinutes: 0 };
const task = (id: string, overrides = {}) => ({
  id,
  title: id,
  priority: 3,
  size: 3,
  estimatedMinutes: 30,
  leadTimeDays: null,
  firstStep: null,
  dueDate: null,
  category: 'WORK',
  theme: null,
  ...overrides,
});
const block = (source: string, status: string, isFixed = false) => ({
  id: 'existing',
  title: 'Existing work',
  startsAt: instant('09:00'),
  endsAt: instant('09:30'),
  durationMinutes: 30,
  source,
  status,
  isFixed,
  taskOccurrenceId: null,
  calendarEventId: null,
  category: 'WORK',
  position: 0,
});
const writtenPlan = () => db.dailyPlan.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.resetAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'UTC' });
  db.task.findMany.mockResolvedValue([]);
  db.taskOccurrence.findMany.mockResolvedValue([]);
  db.availabilityWindow.findMany.mockResolvedValue([{ startMinute: 540, endMinute: 720 }]);
  db.dayOverride.findUnique.mockResolvedValue(null);
  db.dailyPlan.findFirst.mockResolvedValue(null);
  db.taskDependency.findMany.mockResolvedValue([]);
  db.calendarEvent.findMany.mockResolvedValue([]);
  db.dailyBlock.findMany.mockResolvedValue([]);
  db.dailyPlan.create.mockImplementation(({ data }) => Promise.resolve(data));
  db.taskOccurrence.upsert.mockResolvedValue({ id: 'new-occurrence' });
  db.$transaction.mockImplementation((operation) => operation(db));
});

describe('current generator policy baseline (#31)', () => {
  it.each([
    ['manual planned', 'MANUAL', 'PLANNED', false, true],
    ['fixed planned', 'PLANNER', 'PLANNED', true, true],
    ['active', 'PLANNER', 'IN_PROGRESS', false, true],
    ['completed', 'PLANNER', 'DONE', false, true],
    ['flexible planned', 'PLANNER', 'PLANNED', false, false],
    ['skipped', 'PLANNER', 'SKIPPED', false, false],
    ['cancelled', 'MANUAL', 'CANCELED', true, false],
  ] as const)(
    'records fill/rebuild preservation for %s',
    async (_name, source, status, fixed, rebuildKeeps) => {
      for (const fillExistingPlan of [true, false]) {
        db.dailyPlan.findFirst.mockResolvedValueOnce({
          dailyBlocks: [block(source, status, fixed)],
          categorySlots: [],
        });
        await plannerService.generateDraft('owner', date, { ...options, fillExistingPlan });
        const copied = writtenPlan().dailyBlocks.create;
        const keep = fillExistingPlan ? status !== 'CANCELED' : rebuildKeeps;
        const preserved = expect.objectContaining({
          source,
          status,
          isFixed: fixed,
          startsAt: instant('09:00'),
        });
        expect(copied).toEqual(keep ? [preserved] : []);
        db.dailyPlan.create.mockClear();
      }
    }
  );

  it.each(['NO_WORK', 'PTO'])('does not allocate ordinary task time for %s', async (workMode) => {
    db.dayOverride.findUnique.mockResolvedValue({ workMode });
    db.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([task('chore')]);
    await plannerService.generateDraft('owner', date, options);
    expect(writtenPlan().dailyBlocks.create).toEqual([]);
    expect(writtenPlan().explanationJson.unscheduled).toEqual([
      expect.objectContaining({ taskId: 'chore', reason: 'no-available-slot' }),
    ]);
  });

  it.each([true, false])(
    'only busy calendar events exclude task time (isBusy=%s)',
    async (isBusy) => {
      db.calendarEvent.findMany.mockResolvedValue([
        {
          id: 'event',
          title: 'Appointment',
          brief: null,
          startsAt: instant('09:00'),
          endsAt: instant('10:30'),
          isBusy,
        },
      ]);
      db.task.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([task('task', { estimatedMinutes: 45 })]);
      await plannerService.generateDraft('owner', date, options);
      expect(writtenPlan().dailyBlocks.create).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'PLANNER',
            startsAt: instant(isBusy ? '10:30' : '09:00'),
            durationMinutes: 45,
          }),
          expect.objectContaining({
            calendarEventId: 'event',
            source: 'AUTOMATION',
            startsAt: instant('09:00'),
          }),
        ])
      );
    }
  );

  it('uses custom windows instead of standard availability', async () => {
    db.dayOverride.findUnique.mockResolvedValue({
      workMode: 'CUSTOM',
      availabilityWindows: [{ startMinute: 780, endMinute: 840 }],
    });
    db.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([task('custom')]);
    await plannerService.generateDraft('owner', date, options);
    expect(writtenPlan().dailyBlocks.create[0]).toMatchObject({
      startsAt: instant('13:00'),
      endsAt: instant('13:30'),
    });
  });

  it.each([
    ['2026-03-29', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z', 23],
    ['2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 25],
  ])('uses local midnight bounds on Amsterdam DST date %s', async (day, start, end, hours) => {
    db.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'Europe/Amsterdam' });
    db.availabilityWindow.findMany.mockResolvedValue([{ startMinute: 0, endMinute: 1440 }]);
    await plannerService.generateDraft('owner', day, options);
    expect(db.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner',
          startsAt: { lt: new Date(end) },
          endsAt: { gt: new Date(start) },
        },
      })
    );
    expect(writtenPlan().explanationJson.availability).toEqual([{ startsAt: start, endsAt: end }]);
    expect((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000).toBe(hours);
  });

  it('rejects nonexistent spring-forward availability before writing a plan', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'Europe/Amsterdam' });
    db.availabilityWindow.findMany.mockResolvedValue([{ startMinute: 150, endMinute: 240 }]);
    await expect(
      plannerService.generateDraft('owner', '2026-03-29', options)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.dailyPlan.create).not.toHaveBeenCalled();
  });

  it('subtracts already committed minutes from an occurrence estimate', async () => {
    db.taskOccurrence.findMany.mockResolvedValue([
      {
        id: 'occurrence',
        taskId: 'task',
        occurrenceDate: new Date(`${date}T00:00:00Z`),
        dueAt: null,
        task: task('task', { estimatedMinutes: 100 }),
      },
    ]);
    db.dailyBlock.findMany.mockResolvedValueOnce([
      { taskOccurrenceId: 'occurrence', durationMinutes: 70, taskOccurrence: { taskId: 'task' } },
    ]);
    await plannerService.generateDraft('owner', date, options);
    expect(writtenPlan().dailyBlocks.create).toEqual([
      expect.objectContaining({ taskOccurrenceId: 'occurrence', durationMinutes: 30 }),
    ]);
    expect(db.dailyBlock.findMany.mock.calls[0][0].where).toMatchObject({
      userId: 'owner',
      status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
      plan: { isCurrent: true },
    });
  });

  it('inherits urgency through hard prerequisite chains and requests eligible owner records', async () => {
    db.taskDependency.findMany.mockResolvedValue([
      {
        blockedTaskId: 'dependent',
        dependsOnTaskId: 'middle',
        dependsOnTask: { status: 'BACKLOG' },
        blockedTask: { dueDate: instant('00:00') },
      },
      {
        blockedTaskId: 'middle',
        dependsOnTaskId: 'prerequisite',
        dependsOnTask: { status: 'BACKLOG' },
        blockedTask: { dueDate: null },
      },
    ]);
    db.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([task('prerequisite')]);
    await plannerService.generateDraft('owner', date, options);
    expect(writtenPlan().explanationJson.scheduled).toEqual([
      { taskId: 'prerequisite', tier: 'DUE_SOON' },
    ]);
    expect(db.taskOccurrence.findMany.mock.calls[0][0].where).toMatchObject({
      userId: 'owner',
      status: { in: ['PENDING', 'SCHEDULED'] },
      taskId: { notIn: ['dependent', 'middle'] },
      task: { status: { notIn: ['DONE', 'ARCHIVED', 'PAUSED'] } },
    });
    expect(db.task.findMany.mock.calls[1][0].where).toMatchObject({
      userId: 'owner',
      isRecurring: false,
      status: { in: ['BACKLOG', 'IN_PROGRESS'] },
      id: { notIn: ['dependent', 'middle'] },
      occurrences: { none: { status: { in: ['PENDING', 'SCHEDULED'] } } },
    });
  });

  it('materializes eight days of daily recurrence without duplicate inserts', async () => {
    db.task.findMany.mockResolvedValueOnce([
      { id: 'recurring', recurrenceRule: 'FREQ=DAILY', createdAt: instant('00:00') },
    ]);
    await plannerService.generateDraft('owner', date, options);
    const { data, skipDuplicates } = db.taskOccurrence.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(8);
    expect(data[0]).toMatchObject({
      userId: 'owner',
      taskId: 'recurring',
      origin: 'RECURRENCE',
      occurrenceDate: instant('00:00'),
    });
    expect(data[7].occurrenceDate).toEqual(new Date('2026-10-26T00:00:00Z'));
  });

  it('materializes interval recurrence from the selected anchor rather than creation', async () => {
    db.task.findMany.mockResolvedValueOnce([
      {
        id: 'recurring',
        recurrenceRule: 'FREQ=DAILY;INTERVAL=3',
        createdAt: new Date('2026-10-01T20:00:00Z'),
        recurrenceAnchorDate: new Date('2026-10-20'),
      },
    ]);
    await plannerService.generateDraft('owner', date, options);
    expect(
      db.taskOccurrence.createMany.mock.calls[0][0].data.map((row: { occurrenceDate: Date }) =>
        row.occurrenceDate.toISOString().slice(0, 10)
      )
    ).toEqual(['2026-10-20', '2026-10-23', '2026-10-26']);
  });

  it('records legacy generation replacing the current plan before acceptance', async () => {
    db.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([task('task')]);
    await plannerService.generateDraft('owner', date, options);
    expect(db.dailyPlan.updateMany).toHaveBeenCalledWith({
      where: { userId: 'owner', planDate: instant('00:00'), isCurrent: true },
      data: { isCurrent: false },
    });
    expect(writtenPlan()).toMatchObject({ status: 'DRAFT', isCurrent: true, version: 1 });
    expect(db.taskOccurrence.updateMany).toHaveBeenCalled();
    expect(db.task.updateMany).toHaveBeenCalled();
  });
});

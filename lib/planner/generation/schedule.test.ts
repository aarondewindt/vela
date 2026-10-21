import { fixture, at, date, taskId } from './fixtures';
import { planningCandidates } from './candidates';
import { scheduleDay } from './schedule';
import { validateProposal } from '../proposals/validate';
import { documentSchema } from '../proposals/schema';
import type { Snapshot } from '../proposals/snapshot';

function run(s: Snapshot, budget: number | null = null) {
  return scheduleDay(
    s,
    planningCandidates(s).candidates.map((candidate) => ({
      candidate,
      reason: 'Selected for today',
    })),
    budget,
    at('00:00')
  );
}
function placements(result: ReturnType<typeof run>) {
  return result.document.operations.flatMap((op) =>
    op.type === 'add'
      ? [
          {
            kind: op.block.kind,
            start: op.block.startsAt.slice(11, 16),
            end: op.block.endsAt.slice(11, 16),
          },
        ]
      : []
  );
}

it.each([
  [
    [60, 45, 10],
    [
      ['TASK', '09:00', '10:00'],
      ['TASK', '10:00', '10:45'],
      ['REST', '10:45', '11:00'],
      ['TASK', '11:00', '11:10'],
    ],
  ],
  [
    [70, 55],
    [
      ['TASK', '09:00', '10:10'],
      ['REST', '10:10', '10:25'],
      ['TASK', '10:25', '11:20'],
    ],
  ],
  [
    [110, 10],
    [
      ['TASK', '09:00', '10:50'],
      ['REST', '10:50', '11:05'],
      ['TASK', '11:05', '11:15'],
    ],
  ],
  [
    [150],
    [
      ['TASK', '09:00', '10:30'],
      ['REST', '10:30', '10:45'],
      ['TASK', '10:45', '11:45'],
    ],
  ],
  [
    [90, 10],
    [
      ['TASK', '09:00', '10:30'],
      ['REST', '10:30', '10:45'],
      ['TASK', '10:45', '10:55'],
    ],
  ],
] as const)('places task boundaries and qualifying breaks for %j', (durations, expected) => {
  const s = fixture([...durations]);
  const result = run(s);
  expect(placements(result).map((p) => [p.kind, p.start, p.end])).toEqual(expected);
  expect(() =>
    validateProposal(s, documentSchema.parse(result.document), at('00:00'))
  ).not.toThrow();
});

it('honors work budget without granting the finish extension to a partial allocation', () => {
  const result = run(fixture([150]), 100);
  expect([...result.scheduled.values()]).toEqual([100]);
  expect(placements(result)).toEqual([
    { kind: 'TASK', start: '09:00', end: '10:30' },
    { kind: 'REST', start: '10:30', end: '10:45' },
    { kind: 'TASK', start: '10:45', end: '10:55' },
  ]);
});

it('leaves ten minutes to review a same-day proposal and still rejects it once its start passes', () => {
  const s = fixture([30]);
  const result = scheduleDay(
    s,
    [{ candidate: planningCandidates(s).candidates[0], reason: 'Focus' }],
    null,
    at('09:00')
  );
  expect(placements(result)[0].start).toBe('09:10');
  expect(() => validateProposal(s, result.document, at('09:05'))).not.toThrow();
  expect(() => validateProposal(s, result.document, new Date(`${date}T09:10:01Z`))).toThrow(
    /start time has passed.*fresh preview/
  );
});

it('rounds the review window up after inference and does not spill into tomorrow', () => {
  const s = fixture([30]);
  const ordered = [{ candidate: planningCandidates(s).candidates[0], reason: 'Focus' }];
  expect(placements(scheduleDay(s, ordered, null, new Date(`${date}T09:00:36Z`)))[0].start).toBe(
    '09:11'
  );
  s.windows = [{ startMinute: 0, endMinute: 1440 }] as Snapshot['windows'];
  expect(scheduleDay(s, ordered, null, at('23:55')).document.operations).toEqual([]);
});

it('prefers an intact later placement over a small earlier gap', () => {
  const s = fixture([30]);
  s.windows = [
    { startMinute: 540, endMinute: 553 },
    { startMinute: 600, endMinute: 660 },
  ] as Snapshot['windows'];
  expect(placements(run(s))).toEqual([{ kind: 'TASK', start: '10:00', end: '10:30' }]);
});

it('avoids both a tiny partial block and leaving a tiny task remainder', () => {
  const s = fixture([60, 30]);
  s.windows = [
    { startMinute: 540, endMinute: 591 },
    { startMinute: 600, endMinute: 609 },
  ] as Snapshot['windows'];
  const result = run(s);
  expect(placements(result)).toEqual([{ kind: 'TASK', start: '09:00', end: '09:50' }]);
  expect([...result.scheduled.values()]).toEqual([50, 0]);
});

it('still permits genuinely short whole tasks', () => {
  expect(placements(run(fixture([2, 9])))).toEqual([
    { kind: 'TASK', start: '09:00', end: '09:02' },
    { kind: 'TASK', start: '09:02', end: '09:11' },
  ]);
});

it('does not fill two- or nine-minute evening gaps around leisure reservations', () => {
  const s = fixture([45, 30, 60, 30]);
  s.settings.leisureMinutes = 60;
  s.tasks[0].category = 'LEISURE';
  s.tasks[1].category = 'LEISURE';
  s.tasks[2].category = 'LIFE';
  s.windows = [{ startMinute: 0, endMinute: 1440 }] as Snapshot['windows'];
  const result = scheduleDay(
    s,
    planningCandidates(s).candidates.map((candidate) => ({
      candidate,
      reason: 'Good for early in the day',
    })),
    null,
    new Date(`${date}T21:46:36Z`)
  );
  const taskBlocks = result.document.operations.flatMap((op) =>
    op.type === 'add' && op.block.kind === 'TASK' ? [op.block] : []
  );
  expect(
    taskBlocks.every(
      (block) =>
        (new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 60000 >= 10
    )
  ).toBe(true);
  expect(
    result.document.operations.every((op) => !op.explanation.includes('early in the day'))
  ).toBe(true);
  expect(() => validateProposal(s, result.document, at('21:51'))).not.toThrow();
});

it('protects existing commitments, counts completed effort and does not mutate the snapshot', () => {
  const s = fixture([150]);
  s.plan = { id: 'plan', categorySlots: [] } as unknown as Snapshot['plan'];
  s.occurrences = [
    { id: taskId(50), taskId: taskId(1), status: 'SCHEDULED', occurrenceDate: at('00:00') },
  ] as Snapshot['occurrences'];
  s.blocks = [
    {
      id: taskId(51),
      planId: 'plan',
      taskOccurrenceId: taskId(50),
      title: 'History',
      category: 'WORK',
      startsAt: at('09:00'),
      endsAt: at('10:00'),
      durationMinutes: 60,
      status: 'DONE',
      source: 'MANUAL',
      isFixed: true,
      calendarEventId: null,
    },
  ] as Snapshot['blocks'];
  const original = JSON.stringify(s);
  const result = run(s);
  expect([...result.scheduled.values()]).toEqual([90]);
  expect(result.document.operations.every((op) => op.type === 'add')).toBe(true);
  expect(JSON.stringify(s)).toBe(original);
  expect(() => validateProposal(s, result.document, at('00:00'))).not.toThrow();
});

it('does not count a busy calendar event as a restorative break', () => {
  const s = fixture([90, 30]);
  s.events = [
    { id: 'event', isBusy: true, startsAt: at('10:30'), endsAt: at('11:30') },
  ] as Snapshot['events'];
  const result = run(s);
  expect(placements(result).slice(1)).toEqual([
    { kind: 'REST', start: '11:30', end: '11:45' },
    { kind: 'TASK', start: '11:45', end: '12:15' },
  ]);
});

it('enforces earliest start and future cutoff', () => {
  const s = fixture([30]);
  s.tasks[0].earliestStartAt = at('11:12');
  const candidate = planningCandidates(s).candidates[0];
  const result = scheduleDay(s, [{ candidate, reason: 'Focus' }], null, at('10:01'));
  expect(placements(result)[0].start).toBe('11:12');
});

it('rounds a sub-minute earliest start up to the next valid scheduling minute', () => {
  const s = fixture([30]);
  s.tasks[0].earliestStartAt = new Date(`${date}T11:12:30Z`);
  expect(placements(run(s))[0].start).toBe('11:13');
});

it('uses actual elapsed time through the autumn DST change', () => {
  const s = fixture([120]);
  s.date = '2030-10-27';
  s.timezone = 'Europe/Amsterdam';
  s.windows = [{ startMinute: 60, endMinute: 240 }] as Snapshot['windows'];
  const candidate = planningCandidates(s).candidates[0];
  const result = scheduleDay(
    s,
    [{ candidate, reason: 'DST work' }],
    null,
    new Date('2030-10-26T00:00:00Z')
  );
  expect(result.scheduled.get(candidate.key)).toBe(120);
  expect(() =>
    validateProposal(s, result.document, new Date('2030-10-26T00:00:00Z'))
  ).not.toThrow();
});

it('rejects ambiguous wall-time availability rather than silently choosing an offset', () => {
  const s = fixture([30]);
  s.date = '2030-10-27';
  s.timezone = 'Europe/Amsterdam';
  s.windows = [{ startMinute: 150, endMinute: 240 }] as Snapshot['windows'];
  expect(() => run(s)).toThrow(/occurs twice/);
});

it('treats a WORK to LIFE category change as the same continuous work session', () => {
  const s = fixture([60, 45, 10]);
  s.tasks[1].category = 'LIFE';
  const result = placements(run(s));
  expect(result.slice(0, 3)).toEqual([
    { kind: 'TASK', start: '09:00', end: '10:00' },
    { kind: 'TASK', start: '10:00', end: '10:45' },
    { kind: 'REST', start: '10:45', end: '11:00' },
  ]);
});

it('keeps manual reservations intact and places work only in compatible categories', () => {
  const s = fixture([60]);
  s.plan = {
    id: 'plan',
    categorySlots: [
      {
        id: 'slot',
        category: 'LIFE',
        startsAt: at('09:00'),
        endsAt: at('10:00'),
        source: 'MANUAL',
      },
    ],
  } as unknown as Snapshot['plan'];
  expect(placements(run(s))[0]).toEqual({ kind: 'TASK', start: '10:00', end: '11:00' });
});

it('rejects newly proposed leisure reservations that overlap protected work', () => {
  const s = fixture([30]);
  s.plan = { id: 'plan', categorySlots: [] } as unknown as Snapshot['plan'];
  s.blocks = [
    {
      id: 'protected',
      planId: 'plan',
      title: 'Keep',
      category: 'WORK',
      startsAt: at('09:00'),
      endsAt: at('10:00'),
      durationMinutes: 60,
      status: 'PLANNED',
      source: 'MANUAL',
      isFixed: true,
      calendarEventId: null,
      taskOccurrenceId: null,
    },
  ] as Snapshot['blocks'];
  expect(() =>
    validateProposal(
      s,
      {
        schemaVersion: 1,
        operations: [],
        reservations: [
          {
            category: 'LEISURE',
            startsAt: at('09:00').toISOString(),
            endsAt: at('09:30').toISOString(),
            explanation: 'Invalid',
          },
        ],
      },
      at('00:00')
    )
  ).toThrow(/reservations/);
});

it('reserves leisure without changing existing slots and schedules leisure inside it', () => {
  const s = fixture([60, 60]);
  s.settings.leisureMinutes = 60;
  s.tasks[1].category = 'LEISURE';
  const result = run(s);
  expect(
    result.document.reservations?.reduce(
      (n, r) => n + (new Date(r.endsAt).getTime() - new Date(r.startsAt).getTime()) / 60000,
      0
    )
  ).toBe(60);
  expect([...result.scheduled.values()]).toEqual([60, 60]);
  expect(() => validateProposal(s, result.document, at('00:00'))).not.toThrow();
});

it('reports leisure shortfall on PTO and never uses reservations to bypass availability', () => {
  const s = fixture([30]);
  s.settings.leisureMinutes = 60;
  s.override = { workMode: 'PTO' } as Snapshot['override'];
  const result = run(s);
  expect(result.document.operations).toEqual([]);
  expect(result.document.reservations).toEqual([]);
  expect(result.warnings.join()).toMatch(/shortfall: 60/);
});

it('creates only a virtual selected-day recurring candidate and rejects closed/unsupported recurrence', () => {
  const s = fixture([30]);
  s.tasks[0].isRecurring = true;
  s.tasks[0].recurrenceRule = 'FREQ=DAILY';
  expect(planningCandidates(s).candidates).toHaveLength(1);
  expect(run(s).document.operations).toHaveLength(1);
  expect(s.occurrences).toEqual([]);
  s.occurrences = [
    { id: taskId(50), taskId: taskId(1), status: 'DONE', occurrenceDate: at('00:00') },
  ] as Snapshot['occurrences'];
  expect(planningCandidates(s).candidates).toEqual([]);
  s.occurrences = [];
  s.tasks[0].recurrenceRule = 'FREQ=DAILY;COUNT=2';
  expect(planningCandidates(s)).toMatchObject({
    candidates: [],
    warnings: [expect.stringMatching(/unsupported/)],
  });
});

it('keeps mandatory due work in the candidate pool and propagates dependent deadlines', () => {
  const s = fixture([30, 30]);
  s.tasks[1].dueDate = new Date(`${date}T00:00:00Z`);
  s.dependencies = [
    {
      blockedTaskId: taskId(2),
      dependsOnTaskId: taskId(1),
      isHardBlock: true,
      dependsOnTask: { userId: 'owner', status: 'BACKLOG' },
    },
  ] as Snapshot['dependencies'];
  const result = planningCandidates(s);
  expect(result.candidates).toEqual([
    expect.objectContaining({ taskId: taskId(1), mandatory: true, due: s.tasks[1].dueDate }),
  ]);
  expect(result.warnings.join()).toMatch(/prerequisite/);
});

it('uses the adjustable recurrence anchor for virtual candidates and proposal validation', () => {
  const s = fixture([30]);
  s.tasks[0].isRecurring = true;
  s.tasks[0].recurrenceRule = 'FREQ=DAILY;INTERVAL=3';
  s.tasks[0].recurrenceAnchorDate = new Date('2030-01-06');
  expect(planningCandidates(s).candidates).toEqual([]);
  s.tasks[0].recurrenceAnchorDate = new Date('2030-01-07');
  const result = run(s);
  expect(result.document.operations).toHaveLength(1);
  expect(() => validateProposal(s, result.document)).not.toThrow();
  s.tasks[0].recurrenceAnchorDate = new Date('2030-01-08');
  expect(planningCandidates(s).candidates).toEqual([]);
  expect(() => validateProposal(s, result.document)).toThrow();
});

import { DEFAULT_GENERATOR_OPTIONS } from '../scheduling';
import type { Snapshot } from './snapshot';
import { documentSchema, type ProposalDocument, type ProposalOperation } from './schema';
import { validateProposal } from './validate';
import { wallInstant } from './time';

const date = '2030-01-07';
const at = (time: string) => new Date(`${date}T${time}:00Z`);
const now = at('00:00');
const taskId = '00000000-0000-4000-8000-000000000001';
const occurrenceId = '00000000-0000-4000-8000-000000000002';
const blockId = '00000000-0000-4000-8000-000000000003';
function snapshot() {
  return {
    userId: 'owner',
    date,
    timezone: 'UTC',
    hash: 'a'.repeat(64),
    user: { timezone: 'UTC' },
    plans: [],
    plan: { id: 'plan', timezone: 'UTC', categorySlots: [] },
    tasks: [
      {
        id: taskId,
        status: 'BACKLOG',
        title: 'Task',
        estimatedMinutes: 180,
        isRecurring: false,
        category: 'WORK',
        theme: null,
        earliestStartAt: null,
      },
    ],
    occurrences: [],
    dependencies: [],
    blocks: [],
    events: [],
    override: null,
    windows: [{ startMinute: 540, endMinute: 1020 }],
    settings: DEFAULT_GENERATOR_OPTIONS,
  } as unknown as Snapshot;
}
const add = (start: string, end: string, id = taskId) => ({
  type: 'add' as const,
  explanation: 'Fits the morning',
  block: {
    kind: 'TASK' as const,
    taskId: id,
    occurrenceId: null as string | null,
    startsAt: at(start).toISOString(),
    endsAt: at(end).toISOString(),
  },
});
const rest = (start: string, end: string) => ({
  type: 'add' as const,
  explanation: 'Rest between sessions',
  block: {
    kind: 'REST' as const,
    startsAt: at(start).toISOString(),
    endsAt: at(end).toISOString(),
  },
});
const document = (...operations: ProposalOperation[]): ProposalDocument => ({
  schemaVersion: 1,
  operations,
});
function existing(s: Snapshot) {
  s.occurrences = [
    { id: occurrenceId, taskId, status: 'SCHEDULED', occurrenceDate: at('00:00') },
  ] as Snapshot['occurrences'];
  s.blocks = [
    {
      id: blockId,
      title: 'Task',
      taskOccurrenceId: occurrenceId,
      planId: 'plan',
      startsAt: at('09:00'),
      endsAt: at('09:30'),
      durationMinutes: 30,
      category: 'WORK',
      status: 'PLANNED',
      source: 'PLANNER',
      isFixed: false,
      calendarEventId: null,
    },
  ] as Snapshot['blocks'];
}
const edit = (type: 'move' | 'resize', start: string, end: string): ProposalOperation => ({
  type,
  blockId,
  startsAt: at(start).toISOString(),
  endsAt: at(end).toISOString(),
  explanation: 'Adjust timing',
});

describe('proposal boundary validation', () => {
  it('requires typed operations, valid IDs and whole-minute instants', () => {
    expect(
      documentSchema.safeParse(
        document({ ...add('09:00', '09:30'), type: 'invent' } as unknown as ProposalOperation)
      ).success
    ).toBe(false);
    expect(
      documentSchema.safeParse(
        document({
          ...rest('09:00', '09:15'),
          block: { kind: 'REST', startsAt: `${date}T09:00:01Z`, endsAt: at('09:15').toISOString() },
        })
      ).success
    ).toBe(false);
    expect(documentSchema.safeParse(document()).success).toBe(false);
  });
  it('previews an addition without mutating its inputs', () => {
    const s = snapshot();
    const before = JSON.stringify(s);
    expect(
      validateProposal(s, document(add('09:00', '09:30')), now).changes[0].after
    ).toMatchObject({ title: 'Task', durationMinutes: 30 });
    expect(JSON.stringify(s)).toBe(before);
  });
  it.each(['PAUSED', 'DONE', 'ARCHIVED'])('rejects task status %s', (status) => {
    const s = snapshot();
    s.tasks[0].status = status as Snapshot['tasks'][number]['status'];
    expect(() => validateProposal(s, document(add('09:00', '09:30')), now)).toThrow(/eligible/);
  });
  it('rejects missing/foreign task and block references', () => {
    expect(() =>
      validateProposal(snapshot(), document(add('09:00', '09:30', 'foreign')), now)
    ).toThrow(/inaccessible/);
    expect(() =>
      validateProposal(snapshot(), document(edit('move', '10:00', '10:30')), now)
    ).toThrow(/not found/);
  });
  it('enforces earliest starts and hard dependencies', () => {
    const s = snapshot();
    s.tasks[0].earliestStartAt = at('10:00');
    expect(() => validateProposal(s, document(add('09:00', '09:30')), now)).toThrow(/earliest/);
    s.tasks[0].earliestStartAt = null;
    s.dependencies = [
      {
        blockedTaskId: taskId,
        isHardBlock: true,
        dependsOnTask: { userId: 'owner', status: 'IN_PROGRESS' },
      },
    ] as Snapshot['dependencies'];
    expect(() => validateProposal(s, document(add('09:00', '09:30')), now)).toThrow(/prerequisite/);
  });
  it('does not resurrect a closed occurrence', () => {
    const s = snapshot();
    existing(s);
    s.occurrences[0].status = 'CANCELED';
    const operation = add('10:00', '10:30');
    if (operation.type === 'add' && operation.block.kind === 'TASK') {
      operation.block.occurrenceId = occurrenceId;
    }
    expect(() => validateProposal(s, document(operation), now)).toThrow(/closed/);
  });
  it.each(['NO_WORK', 'PTO'])('rejects allocations on %s', (workMode) => {
    const s = snapshot();
    s.override = { workMode } as Snapshot['override'];
    expect(() => validateProposal(s, document(add('09:00', '09:30')), now)).toThrow(/availability/);
  });
  it('enforces availability, local day and elapsed time cutoff', () => {
    expect(() => validateProposal(snapshot(), document(add('08:30', '09:00')), now)).toThrow(
      /availability/
    );
    expect(() =>
      validateProposal(snapshot(), document(add('09:00', '09:30')), at('09:01'))
    ).toThrow(/future/);
    expect(() => validateProposal(snapshot(), document(add('09:30', '09:00')), now)).toThrow(
      /positive/
    );
  });
  it('allows touching half-open busy intervals and rejects overlap', () => {
    const s = snapshot();
    s.events = [{ isBusy: true, startsAt: at('09:00'), endsAt: at('10:00') }] as Snapshot['events'];
    expect(() => validateProposal(s, document(add('10:00', '10:30')), now)).not.toThrow();
    expect(() => validateProposal(s, document(add('09:30', '10:00')), now)).toThrow(/overlaps/);
  });
  it('rejects overlapping proposed blocks', () => {
    expect(() =>
      validateProposal(snapshot(), document(add('09:00', '09:30'), rest('09:15', '09:30')), now)
    ).toThrow(/overlaps/);
  });
  it('requires category matching and leisure reservations', () => {
    const s = snapshot();
    s.plan!.categorySlots = [
      { category: 'LIFE', startsAt: at('09:00'), endsAt: at('10:00') },
    ] as NonNullable<Snapshot['plan']>['categorySlots'];
    expect(() => validateProposal(s, document(add('09:00', '09:30')), now)).toThrow(/category/);
    s.plan!.categorySlots = [];
    s.tasks[0].category = 'LEISURE';
    expect(() => validateProposal(s, document(add('09:00', '09:30')), now)).toThrow(
      /leisure reservation/
    );
  });
  it('does not allow a reservation to bypass availability', () => {
    const s = snapshot();
    s.windows = [];
    s.plan!.categorySlots = [
      { category: 'WORK', startsAt: at('09:00'), endsAt: at('10:00') },
    ] as NonNullable<Snapshot['plan']>['categorySlots'];
    expect(() => validateProposal(s, document(add('09:00', '09:30')), now)).toThrow(/availability/);
  });
});

describe('proposal edits and preservation', () => {
  it.each([
    { source: 'MANUAL' },
    { isFixed: true },
    { status: 'IN_PROGRESS' },
    { status: 'DONE' },
    { status: 'SKIPPED' },
    { status: 'CANCELED' },
    { calendarEventId: 'calendar' },
  ])('protects %j', (patch) => {
    const s = snapshot();
    existing(s);
    Object.assign(s.blocks[0], patch);
    expect(() => validateProposal(s, document(edit('move', '10:00', '10:30')), now)).toThrow(
      /protected/
    );
  });
  it('supports moves and duration changes with distinct semantics', () => {
    const s = snapshot();
    existing(s);
    expect(
      validateProposal(s, document(edit('move', '10:00', '10:30')), now).changes[0].after?.id
    ).toBe(blockId);
    expect(
      validateProposal(s, document(edit('resize', '09:00', '09:45')), now).changes[0].after
        ?.durationMinutes
    ).toBe(45);
    expect(() => validateProposal(s, document(edit('move', '10:00', '10:45')), now)).toThrow(
      /preserve duration/
    );
    expect(() => validateProposal(s, document(edit('resize', '10:00', '10:30')), now)).toThrow(
      /preserve the start/
    );
  });
  it('supports removal and replacement without deleting the task', () => {
    const s = snapshot();
    existing(s);
    const removed = validateProposal(
      s,
      document({ type: 'remove', blockId, explanation: 'No longer needed today' }),
      now
    );
    expect(removed.final).toEqual([]);
    expect(s.tasks).toHaveLength(1);
    const replaced = validateProposal(
      s,
      document({
        type: 'replace',
        blockId,
        explanation: 'Rest instead',
        block: {
          kind: 'REST',
          startsAt: at('09:00').toISOString(),
          endsAt: at('09:15').toISOString(),
        },
      }),
      now
    );
    expect(replaced.final[0].category).toBe('REST');
  });
  it('rejects multiple mutations of the same block', () => {
    const s = snapshot();
    existing(s);
    expect(() =>
      validateProposal(
        s,
        document(edit('move', '10:00', '10:30'), edit('move', '11:00', '11:30')),
        now
      )
    ).toThrow(/only once/);
  });
  it('counts preserved commitments and credits replaced allocations', () => {
    const s = snapshot();
    existing(s);
    s.tasks[0].estimatedMinutes = 30;
    expect(() => validateProposal(s, document(edit('move', '10:00', '10:30')), now)).not.toThrow();
    expect(() => validateProposal(s, document(edit('resize', '09:00', '09:45')), now)).toThrow(
      /remaining estimate/
    );
  });
});

describe('session policy', () => {
  it('allows a 110-minute finish but rejects arbitrary extra partial work', () => {
    const s = snapshot();
    s.tasks[0].estimatedMinutes = 110;
    expect(() => validateProposal(s, document(add('09:00', '10:50')), now)).not.toThrow();
    s.tasks[0].estimatedMinutes = 150;
    expect(() => validateProposal(s, document(add('09:00', '10:50')), now)).toThrow(/extension/);
    expect(() =>
      validateProposal(
        s,
        document(add('09:00', '10:30'), rest('10:30', '10:45'), add('10:45', '11:45')),
        now
      )
    ).not.toThrow();
  });
  it('allows 60 + 45 minutes to finish the second task, but not starting it after 90', () => {
    const s = snapshot();
    s.tasks[0].estimatedMinutes = 60;
    const second = '00000000-0000-4000-8000-000000000004';
    s.tasks.push({ ...s.tasks[0], id: second, estimatedMinutes: 45 });
    expect(() =>
      validateProposal(s, document(add('09:00', '10:00'), add('10:00', '10:45', second)), now)
    ).not.toThrow();
    s.tasks[0].estimatedMinutes = 90;
    expect(() =>
      validateProposal(s, document(add('09:00', '10:30'), add('10:30', '11:15', second)), now)
    ).toThrow(/break/);
  });
  it('rejects removing a break when untouched later work would lose required rest', () => {
    const s = snapshot();
    existing(s);
    s.tasks[0].estimatedMinutes = 90;
    s.blocks[0].endsAt = at('10:30');
    s.blocks[0].durationMinutes = 90;
    const second = '00000000-0000-4000-8000-000000000004';
    const nextOccurrence = '00000000-0000-4000-8000-000000000005';
    const restId = '00000000-0000-4000-8000-000000000006';
    s.tasks.push({ ...s.tasks[0], id: second, estimatedMinutes: 30 });
    s.occurrences.push({ ...s.occurrences[0], id: nextOccurrence, taskId: second });
    s.blocks.push({
      ...s.blocks[0],
      id: restId,
      taskOccurrenceId: null,
      category: 'REST',
      startsAt: at('10:30'),
      endsAt: at('10:45'),
      durationMinutes: 15,
    });
    s.blocks.push({
      ...s.blocks[0],
      id: 'later',
      taskOccurrenceId: nextOccurrence,
      startsAt: at('10:45'),
      endsAt: at('11:15'),
      durationMinutes: 30,
    });
    // Moving the break away and moving later work earlier removes actual recovery.
    expect(() =>
      validateProposal(
        s,
        document(
          { type: 'remove', blockId: restId, explanation: 'Skip rest' },
          {
            type: 'move',
            blockId: 'later',
            startsAt: at('10:30').toISOString(),
            endsAt: at('11:00').toISOString(),
            explanation: 'Work earlier',
          }
        ),
        now
      )
    ).toThrow(/break/);
    // Removing its explicit label alone is fine: a genuine free 15-minute gap remains.
    expect(() =>
      validateProposal(
        s,
        document({ type: 'remove', blockId: restId, explanation: 'Leave free time' }),
        now
      )
    ).not.toThrow();
  });

  it('does not treat a busy event as restorative time', () => {
    const s = snapshot();
    s.events = [{ isBusy: true, startsAt: at('10:30'), endsAt: at('11:00') }] as Snapshot['events'];
    const second = '00000000-0000-4000-8000-000000000004';
    s.tasks.push({ ...s.tasks[0], id: second, estimatedMinutes: 30 });
    expect(() =>
      validateProposal(s, document(add('09:00', '10:30'), add('11:00', '11:30', second)), now)
    ).toThrow(/break/);
  });
});

describe('saved timezone input', () => {
  it('rejects nonexistent and ambiguous Amsterdam times', () => {
    expect(() => wallInstant('2026-03-29', 150, 'Europe/Amsterdam')).toThrow(/does not exist/);
    expect(() => wallInstant('2026-10-25', 150, 'Europe/Amsterdam')).toThrow(/twice/);
    expect(wallInstant('2026-10-25', 0, 'Europe/Amsterdam').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z'
    );
    expect(wallInstant('2026-10-25', 1440, 'Europe/Amsterdam').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z'
    );
  });
});

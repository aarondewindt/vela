/** @jest-environment node */
jest.mock('server-only', () => ({}));
import { fixture, at, taskId } from '../generation/fixtures';
import { progressFixture } from '../proposals/replan-fixtures';
import { wallInstant } from '../proposals/time';
import {
  applyDocument,
  initialState,
  inputHash,
  netDocument,
  scheduleHash,
  draftAcceptanceConflicts,
  validateDraft,
  withDraft,
} from './state';
import { planningCandidates } from '../generation/candidates';
import { existingBlocks, validateProposal } from '../proposals/validate';

const now = at('08:00');
it('starts empty and applies one manual batch without creating occurrences', () => {
  const s = fixture();
  const base = initialState(s);
  const next = applyDocument(
    s,
    base,
    {
      schemaVersion: 1,
      operations: [
        {
          type: 'add',
          block: {
            kind: 'TASK',
            taskId: taskId(1),
            occurrenceId: null,
            startsAt: at('09:00').toISOString(),
            endsAt: at('09:30').toISOString(),
          },
          explanation: 'Place task',
        },
      ],
    },
    'manual',
    now
  );
  expect(base.blocks).toEqual([]);
  expect(next.blocks[0]).toMatchObject({
    source: 'MANUAL',
    manualOverride: true,
    occurrenceId: null,
    status: 'PLANNED',
  });
  expect(s.occurrences).toEqual([]);
  expect(validateProposal(s, netDocument(base, next), now).final).toHaveLength(1);
  expect(withDraft(s, next).blocks[0].taskOccurrenceId).toBeNull();
});
it('retains task identity and effort for draft-only blocks without creating fake occurrences', () => {
  const s = fixture();
  const state = applyDocument(
    s,
    initialState(s),
    {
      schemaVersion: 1,
      operations: [
        {
          type: 'add',
          block: {
            kind: 'TASK',
            taskId: taskId(1),
            occurrenceId: null,
            startsAt: at('09:00').toISOString(),
            endsAt: at('09:30').toISOString(),
          },
          explanation: 'Place task',
        },
      ],
    },
    'manual',
    now
  );
  const snapshot = withDraft(s, state);
  expect(existingBlocks(snapshot)[0]).toMatchObject({ taskId: taskId(1), occurrenceId: null });
  expect(
    planningCandidates(snapshot).candidates.find((c) => c.taskId === taskId(1))?.remaining
  ).toBe(30);
  const moved = applyDocument(
    s,
    state,
    {
      schemaVersion: 1,
      operations: [
        {
          type: 'move',
          blockId: state.blocks[0].id,
          startsAt: at('10:00').toISOString(),
          endsAt: at('10:30').toISOString(),
          explanation: 'Move',
        },
      ],
    },
    'manual',
    now
  );
  expect(moved.blocks[0]).toMatchObject({ taskId: taskId(1), occurrenceId: null });
  expect(s.occurrences).toEqual([]);
});
it('manual move and move back has no net schedule difference', () => {
  const s = progressFixture();
  const base = initialState(s);
  const move = (start: string, end: string) => ({
    schemaVersion: 1 as const,
    operations: [
      {
        type: 'move' as const,
        blockId: taskId(21),
        startsAt: at(start).toISOString(),
        endsAt: at(end).toISOString(),
        explanation: 'Move task',
      },
    ],
  });
  const changed = applyDocument(s, base, move('12:00', '12:30'), 'manual', now);
  expect(changed.blocks.find((b) => b.id === taskId(21))?.manualOverride).toBe(true);
  const restored = applyDocument(s, changed, move('10:00', '10:30'), 'manual', now);
  expect(scheduleHash(restored)).toBe(scheduleHash(base));
  expect(netDocument(base, restored).operations).toEqual([]);
});
it.each(['finish', 'extend', 'skip'] as const)('rejects %s progress in drafts', (type) => {
  const s = progressFixture();
  expect(() =>
    applyDocument(
      s,
      initialState(s),
      {
        schemaVersion: 1,
        operations: [
          {
            type,
            blockId: taskId(20),
            endsAt: at('09:30').toISOString(),
            completeTask: true,
            explanation: 'Progress',
          } as any,
        ],
      },
      'ai',
      now
    )
  ).toThrow('actual progress separately');
});
it('protects manual overrides and locks from normal AI edits', () => {
  const s = progressFixture();
  const base = initialState(s);
  base.blocks[1].manualOverride = true;
  const document = {
    schemaVersion: 1 as const,
    operations: [{ type: 'remove' as const, blockId: taskId(21), explanation: 'Rebuild' }],
  };
  expect(() => applyDocument(s, base, document, 'ai', now)).toThrow('protected');
  base.blocks[1].isLocked = true;
  expect(() => applyDocument(s, base, document, 'manual', now)).toThrow('protected');
});
it('ignores unrelated task metadata and out-of-day calendars but detects relevant commitments', () => {
  const s = progressFixture();
  const state = initialState(s);
  const hash = inputHash(s, state);
  s.tasks[0].brief = 'Changed description';
  s.tasks[0].title = 'Changed title';
  expect(inputHash(s, state)).toBe(hash);
  s.tasks[0].estimatedMinutes = 999;
  expect(inputHash(s, state)).not.toBe(hash);
});
it('keeps protected in-progress history intact when validating net edits', () => {
  const s = progressFixture();
  const base = initialState(s);
  const next = applyDocument(
    s,
    base,
    {
      schemaVersion: 1,
      operations: [{ type: 'remove', blockId: taskId(22), explanation: 'Remove future work' }],
    },
    'manual',
    at('09:30')
  );
  expect(
    validateProposal(s, netDocument(base, next), at('09:30')).final.find((b) => b.id === taskId(20))
  ).toMatchObject({ status: 'IN_PROGRESS', occurrenceId: taskId(10) });
  expect(() => validateProposal(s, netDocument(base, next), at('11:01'))).toThrow('protected');
});
it('uses saved-zone 23/25 hour days and rejects ambiguous local times', () => {
  expect(
    (wallInstant('2030-03-31', 1440, 'Europe/Amsterdam').getTime() -
      wallInstant('2030-03-31', 0, 'Europe/Amsterdam').getTime()) /
      3600000
  ).toBe(23);
  expect(
    (wallInstant('2030-10-27', 1440, 'Europe/Amsterdam').getTime() -
      wallInstant('2030-10-27', 0, 'Europe/Amsterdam').getTime()) /
      3600000
  ).toBe(25);
  expect(() => wallInstant('2030-10-27', 150, 'Europe/Amsterdam')).toThrow('twice');
});

const addTask = (id: string, start: string, end: string) => ({
  type: 'add' as const,
  block: {
    kind: 'TASK' as const,
    taskId: id,
    occurrenceId: null,
    startsAt: at(start).toISOString(),
    endsAt: at(end).toISOString(),
  },
  explanation: 'Manual placement',
});

it('manual policy persists overlaps with blocks and busy/non-busy calendar events', () => {
  const s = fixture();
  s.events.push(
    {
      id: taskId(91),
      title: 'Busy appointment',
      startsAt: at('09:10'),
      endsAt: at('09:40'),
      isBusy: true,
    } as (typeof s.events)[number],
    {
      id: taskId(92),
      title: 'Optional event',
      startsAt: at('09:00'),
      endsAt: at('10:00'),
      isBusy: false,
    } as (typeof s.events)[number]
  );
  const base = initialState(s);
  const first = applyDocument(
    s,
    base,
    { schemaVersion: 1, operations: [addTask(taskId(1), '09:00', '09:30')] },
    'manual',
    now
  );
  const overlapping = applyDocument(
    s,
    first,
    { schemaVersion: 1, operations: [addTask(taskId(2), '09:15', '10:00')] },
    'manual',
    now
  );
  expect(overlapping.blocks).toHaveLength(2);
  expect(() => validateDraft(s, base, overlapping, now, 'manual')).not.toThrow();
  expect(draftAcceptanceConflicts(s, overlapping, now)).toEqual(
    expect.arrayContaining([
      expect.stringContaining('overlaps block'),
      expect.stringContaining('Busy appointment'),
    ])
  );
  expect(draftAcceptanceConflicts(s, overlapping, now).join(' ')).not.toContain('Optional event');
});

it('manual policy permits availability, category, leisure and estimate overrides', () => {
  const s = fixture([30]);
  s.tasks[0].category = 'LEISURE';
  const base = initialState(s);
  const state = applyDocument(
    s,
    base,
    { schemaVersion: 1, operations: [addTask(taskId(1), '08:00', '09:30')] },
    'manual',
    now
  );
  expect(state.blocks[0]).toMatchObject({ category: 'LEISURE', durationMinutes: 90 });
  expect(() => validateDraft(s, base, state, now, 'manual')).not.toThrow();
  expect(() => validateDraft(s, base, state, now, 'acceptance')).not.toThrow();
  expect(() =>
    applyDocument(
      s,
      base,
      { schemaVersion: 1, operations: [addTask(taskId(1), '08:00', '09:30')] },
      'ai',
      now
    )
  ).toThrow();
});

it('manual retime supports leading-edge resize while retaining identity and intent', () => {
  const s = fixture();
  const placed = applyDocument(
    s,
    initialState(s),
    { schemaVersion: 1, operations: [addTask(taskId(1), '10:00', '10:30')] },
    'manual',
    now
  );
  const id = placed.blocks[0].id;
  const resized = applyDocument(
    s,
    placed,
    {
      schemaVersion: 1,
      operations: [
        {
          type: 'retime',
          blockId: id,
          startsAt: at('09:45').toISOString(),
          endsAt: at('10:30').toISOString(),
          explanation: 'Resize from leading edge',
        },
      ],
    },
    'manual',
    now
  );
  expect(resized.blocks[0]).toMatchObject({
    id,
    startsAt: at('09:45').toISOString(),
    endsAt: at('10:30').toISOString(),
    durationMinutes: 45,
    manualOverride: true,
  });
});

it('manual category reservations may overlap each other and availability, but acceptance rejects them', () => {
  const s = fixture();
  const base = initialState(s);
  const state = {
    ...base,
    slots: [
      {
        id: taskId(81),
        category: 'WORK' as const,
        startsAt: at('08:00').toISOString(),
        endsAt: at('09:00').toISOString(),
        source: 'MANUAL' as const,
      },
      {
        id: taskId(82),
        category: 'LEISURE' as const,
        startsAt: at('08:30').toISOString(),
        endsAt: at('09:30').toISOString(),
        source: 'MANUAL' as const,
      },
    ],
  };
  expect(() => validateDraft(s, base, state, now, 'manual')).not.toThrow();
  expect(() => validateDraft(s, base, state, now, 'acceptance')).toThrow(
    /WORK reservation[\s\S]*overlaps LEISURE reservation/
  );
});

it('acceptance errors identify conflicting block/event IDs and local ranges', () => {
  const s = fixture();
  s.events.push({
    id: taskId(93),
    title: 'Dentist',
    startsAt: at('09:15'),
    endsAt: at('09:45'),
    isBusy: true,
  } as (typeof s.events)[number]);
  const base = initialState(s);
  const state = applyDocument(
    s,
    base,
    { schemaVersion: 1, operations: [addTask(taskId(1), '09:00', '09:30')] },
    'manual',
    now
  );
  expect(() => validateDraft(s, base, state, now, 'acceptance')).toThrow(
    new RegExp(`${taskId(93)}[\\s\\S]*09:15–09:45`)
  );
});

it('manual and acceptance policies still enforce day bounds, whole minutes and locks', () => {
  const s = progressFixture();
  const base = initialState(s);
  base.blocks[1].isLocked = true;
  expect(() =>
    applyDocument(
      s,
      base,
      {
        schemaVersion: 1,
        operations: [
          {
            type: 'retime',
            blockId: taskId(21),
            startsAt: at('11:00').toISOString(),
            endsAt: at('11:30').toISOString(),
            explanation: 'Locked edit',
          },
        ],
      },
      'manual',
      now
    )
  ).toThrow('protected');
  const fresh = fixture();
  expect(() =>
    applyDocument(
      fresh,
      initialState(fresh),
      {
        schemaVersion: 1,
        operations: [
          {
            ...addTask(taskId(1), '09:00', '09:30'),
            block: {
              ...addTask(taskId(1), '09:00', '09:30').block,
              endsAt: new Date(at('09:30').getTime() + 30_000).toISOString(),
            },
          },
        ],
      },
      'manual',
      now
    )
  ).toThrow('whole-minute');
});

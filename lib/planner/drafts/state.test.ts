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
  withDraft,
} from './state';
import { validateProposal } from '../proposals/validate';

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

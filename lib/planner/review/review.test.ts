import { reviewSchedule } from './review';
import { progressFixture } from '../proposals/replan-fixtures';
import { at, taskId } from '../generation/fixtures';
import { validateProposal } from '../proposals/validate';
import type { ProposalDocument } from '../proposals/schema';

it('reports overlapping blocks with references, ignores touching endpoints and preserves state', () => {
  const s = progressFixture();
  s.blocks[2].startsAt = at('10:15');
  s.blocks[2].endsAt = at('10:45');
  const before = JSON.stringify(s);
  const result = reviewSchedule(s, undefined, at('08:00'));
  expect(result.conflicts.filter((c) => c.code === 'OVERLAP')).toEqual([
    expect.objectContaining({ blockIds: [s.blocks[1].id, s.blocks[2].id] }),
  ]);
  expect(JSON.stringify(s)).toBe(before);
});
it('detects dependencies, availability, busy events, earliest starts and excess allocations', () => {
  const s = progressFixture();
  s.windows = [];
  s.tasks[1].estimatedMinutes = 10;
  s.tasks[1].earliestStartAt = at('12:00');
  s.dependencies = [
    {
      blockedTaskId: s.tasks[1].id,
      isHardBlock: true,
      dependsOnTask: { userId: 'owner', status: 'BACKLOG' },
    },
  ] as typeof s.dependencies;
  s.events = [
    { id: taskId(80), title: 'Meeting', isBusy: true, startsAt: at('10:00'), endsAt: at('10:30') },
  ] as typeof s.events;
  const result = reviewSchedule(s, undefined, at('08:00'));
  expect(result.conflicts.map((c) => c.code)).toEqual(
    expect.arrayContaining([
      'ELIGIBILITY',
      'AVAILABILITY',
      'BUSY_EVENT',
      'EARLIEST_START',
      'OVERALLOCATED',
    ])
  );
  expect(result.corrections.filter((c) => c.replacement)).toHaveLength(0);
});
it('offers only whole remaining replacements that validate against all other blocks and keeps protected work', () => {
  const s = progressFixture();
  const extra = { ...s.tasks[0], id: taskId(4), title: 'Alternative', estimatedMinutes: 20 };
  s.tasks.push(extra);
  s.blocks[2].isFixed = true;
  const result = reviewSchedule(s, undefined, at('09:30'));
  const replacement = result.corrections.find((c) => c.replacement?.title === 'Alternative');
  expect(replacement?.blockId).toBe(s.blocks[1].id);
  expect(replacement?.replacement?.minutes).toBe(20);
  expect(() => validateProposal(s, replacement!.document, at('09:30'))).not.toThrow();
  expect(
    result.corrections.some((c) => c.blockId === s.blocks[0].id || c.blockId === s.blocks[2].id)
  ).toBe(false);
  extra.estimatedMinutes = 31;
  expect(reviewSchedule(s, undefined, at('09:30')).corrections.some((c) => c.replacement)).toBe(
    false
  );
});
it('rejects blocked/early/leisure/session-incompatible alternatives and shows displaced deadline risk', () => {
  const s = progressFixture();
  s.tasks[1].dueDate = at('12:00');
  s.tasks.push({
    ...s.tasks[0],
    id: taskId(4),
    title: 'Too early',
    estimatedMinutes: 20,
    earliestStartAt: at('16:00'),
  });
  s.tasks.push({
    ...s.tasks[0],
    id: taskId(5),
    title: 'Leisure',
    estimatedMinutes: 20,
    category: 'LEISURE',
  });
  const result = reviewSchedule(s, undefined, at('09:30'));
  expect(result.corrections.some((c) => c.replacement)).toBe(false);
  expect(result.corrections.find((c) => c.blockId === s.blocks[1].id)?.displaced).toMatchObject({
    minutes: 30,
    deadlineRisk: true,
  });
});
it('reviews a proposed schedule and composes virtual-block corrections into a fresh document', () => {
  const s = progressFixture();
  s.tasks.push({ ...s.tasks[0], id: taskId(4), title: 'Alternative', estimatedMinutes: 20 });
  const document: ProposalDocument = {
    schemaVersion: 1,
    operations: [
      {
        type: 'add',
        explanation: 'Add work',
        block: {
          kind: 'TASK',
          taskId: taskId(4),
          occurrenceId: null,
          startsAt: at('13:00').toISOString(),
          endsAt: at('13:20').toISOString(),
        },
      },
    ],
  };
  s.tasks.push({ ...s.tasks[0], id: taskId(5), title: 'Another', estimatedMinutes: 15 });
  const result = reviewSchedule(s, document, at('08:00'));
  const correction = result.corrections.find(
    (c) => c.blockId === 'new:0' && c.replacement?.title === 'Another'
  );
  expect(correction?.document.operations[0]).toMatchObject({
    type: 'add',
    block: { taskId: taskId(5) },
  });
  expect(() => validateProposal(s, correction!.document, at('08:00'))).not.toThrow();
});
it('uses the shared session policy and does not report cancelled or skipped work', () => {
  const s = progressFixture();
  s.settings.workSessionMinutes = 30;
  const result = reviewSchedule(s, undefined, at('08:00'));
  expect(result.conflicts.some((c) => c.code === 'SESSION_POLICY')).toBe(true);
  s.blocks[1].status = 'CANCELED';
  s.blocks[2].status = 'SKIPPED';
  expect(reviewSchedule(s, undefined, at('08:00')).blocks.map((b) => b.id)).toEqual([
    s.blocks[0].id,
  ]);
});

it('composes corrections for proposed replacements and moves without duplicating source mutations', () => {
  const s = progressFixture();
  s.tasks.push({ ...s.tasks[0], id: taskId(4), title: 'Alternative', estimatedMinutes: 20 });
  s.tasks.push({ ...s.tasks[0], id: taskId(5), title: 'Another', estimatedMinutes: 15 });
  const replacement: ProposalDocument = {
    schemaVersion: 1,
    operations: [
      {
        type: 'replace',
        blockId: s.blocks[1].id,
        explanation: 'Swap',
        block: {
          kind: 'TASK',
          taskId: taskId(4),
          occurrenceId: null,
          startsAt: at('10:00').toISOString(),
          endsAt: at('10:20').toISOString(),
        },
      },
    ],
  };
  const result = reviewSchedule(s, replacement, at('08:00'));
  const correction = result.corrections.find(
    (c) => c.blockId === 'new:0' && c.replacement?.title === 'Another'
  );
  expect(correction?.document.operations).toHaveLength(1);
  expect(correction?.document.operations[0]).toMatchObject({
    type: 'replace',
    blockId: s.blocks[1].id,
    block: { taskId: taskId(5) },
  });
  expect(() => validateProposal(s, correction!.document, at('08:00'))).not.toThrow();
  const move: ProposalDocument = {
    schemaVersion: 1,
    operations: [
      {
        type: 'move',
        blockId: s.blocks[1].id,
        explanation: 'Later',
        startsAt: at('14:00').toISOString(),
        endsAt: at('14:30').toISOString(),
      },
    ],
  };
  const moved = reviewSchedule(s, move, at('08:00')).corrections.find(
    (c) => c.blockId === s.blocks[1].id && c.replacement?.title === 'Another'
  );
  expect(moved?.document.operations).toHaveLength(1);
  expect(moved?.document.operations[0]).toMatchObject({
    type: 'replace',
    blockId: s.blocks[1].id,
    block: { startsAt: at('14:00').toISOString() },
  });
});

it('excludes nonbusy calendar blocks', () => {
  const s = progressFixture();
  s.blocks[0].calendarEventId = taskId(80);
  s.events = [
    { id: taskId(80), isBusy: false, startsAt: at('09:00'), endsAt: at('10:00') },
  ] as typeof s.events;
  expect(
    reviewSchedule(s, undefined, at('08:00')).blocks.some((b) => b.id === s.blocks[0].id)
  ).toBe(false);
});

import { fixture, taskId } from './fixtures';
import { buildSlotIntentContract, candidateAllowedInSlot } from './slot-intent';
import { planningCandidates } from './candidates';

const slots = [
  {
    id: 'slot-work',
    startMinute: 540,
    endMinute: 600,
    policy: { mode: 'ALLOW_ONLY' as const, categories: ['WORK' as const] },
  },
  {
    id: 'slot-life',
    startMinute: 600,
    endMinute: 720,
    policy: { mode: 'EXCLUDE' as const, categories: ['WORK' as const] },
  },
];

test('slot policy allows deterministic task categories for all normalized modes', () => {
  expect(candidateAllowedInSlot('WORK', { mode: 'ALL', categories: [] })).toBe(true);
  expect(candidateAllowedInSlot('WORK', slots[0].policy)).toBe(true);
  expect(candidateAllowedInSlot('LIFE', slots[0].policy)).toBe(false);
  expect(candidateAllowedInSlot('WORK', slots[1].policy)).toBe(false);
  expect(candidateAllowedInSlot('LEISURE', slots[1].policy)).toBe(true);
  expect(candidateAllowedInSlot('LEISURE', { mode: 'ALLOW_ONLY', categories: [] })).toBe(false);
});

test('per-slot intent resolves bounded aliases and rejects hard-ineligible assignments', () => {
  const snapshot = fixture([60, 45]);
  snapshot.tasks[1].category = 'LIFE';
  const candidates = [
    {
      key: `${taskId(1)}:new`,
      taskId: taskId(1),
      occurrenceId: null,
      title: 'Task 1',
      remaining: 60,
      category: 'WORK' as const,
      due: null,
      mandatory: false,
    },
    {
      key: `${taskId(2)}:new`,
      taskId: taskId(2),
      occurrenceId: null,
      title: 'Task 2',
      remaining: 45,
      category: 'LIFE' as const,
      due: null,
      mandatory: false,
    },
  ];
  const contract = buildSlotIntentContract(slots, candidates);

  expect(
    contract
      .resolve({
        summary: 'Use each slot for eligible work.',
        slots: [
          {
            slotId: 'slot-work',
            targetTaskMinutes: 60,
            tasks: [{ key: 'C1', reason: 'Highest priority work.' }],
            reason: 'Focused work.',
          },
          {
            slotId: 'slot-life',
            targetTaskMinutes: 45,
            tasks: [{ key: 'C2', reason: 'Life admin fits here.' }],
            reason: 'Use the flexible slot.',
          },
        ],
      })
      .slots.map((slot) => slot.tasks[0]?.candidate.taskId)
  ).toEqual([taskId(1), taskId(2)]);

  expect(() =>
    contract.resolve({
      summary: 'Invalid assignment.',
      slots: [
        {
          slotId: 'slot-work',
          targetTaskMinutes: 45,
          tasks: [{ key: 'C2', reason: 'Wrong category.' }],
          reason: 'Invalid.',
        },
        { slotId: 'slot-life', targetTaskMinutes: 0, tasks: [], reason: 'Empty.' },
      ],
    })
  ).toThrow(/not eligible for availability slot slot-work/i);
});

test('per-slot intent requires each slot once and rejects contradictory zero targets', () => {
  const candidates = [
    {
      key: `${taskId(1)}:new`,
      taskId: taskId(1),
      occurrenceId: null,
      title: 'Task 1',
      remaining: 60,
      category: 'WORK' as const,
      due: null,
      mandatory: false,
    },
  ];
  const contract = buildSlotIntentContract(slots, candidates);
  expect(() =>
    contract.resolve({
      summary: 'Contradictory.',
      slots: [
        {
          slotId: 'slot-work',
          targetTaskMinutes: 0,
          tasks: [{ key: 'C1', reason: 'Cannot fit a task in a zero target.' }],
          reason: 'Invalid.',
        },
        { slotId: 'slot-life', targetTaskMinutes: 0, tasks: [], reason: 'Empty.' },
      ],
    })
  ).toThrow(/zero target/i);

  expect(() =>
    contract.resolve({
      summary: 'Missing a slot.',
      slots: [{ slotId: 'slot-work', targetTaskMinutes: 0, tasks: [], reason: 'Empty.' }],
    })
  ).toThrow(/exactly once/i);
});

test('candidate categories inherit from themes and leisure remains an ordinary policy category', () => {
  const snapshot = fixture([30, 30]);
  snapshot.tasks[0].category = null;
  snapshot.tasks[0].theme = {
    userId: 'owner',
    category: 'LIFE',
    name: 'Home',
  } as (typeof snapshot.tasks)[number]['theme'];
  snapshot.tasks[1].category = 'LEISURE';
  const candidates = planningCandidates(snapshot).candidates;
  expect(candidates.map((candidate) => candidate.category)).toEqual(['LIFE', 'LEISURE']);
  expect(
    candidateAllowedInSlot(candidates[0].category, {
      mode: 'ALLOW_ONLY',
      categories: ['LIFE'],
    })
  ).toBe(true);
  expect(
    candidateAllowedInSlot(candidates[1].category, {
      mode: 'ALLOW_ONLY',
      categories: ['LEISURE'],
    })
  ).toBe(true);
});

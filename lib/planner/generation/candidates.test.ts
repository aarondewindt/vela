import { planningCandidates } from './candidates';
import { scheduleDay } from './schedule';
import { fixture, taskId, at } from './fixtures';
import { eligible, validateProposal } from '../proposals/validate';
import type { Snapshot } from '../proposals/snapshot';
import { wallInstant } from '../proposals/time';

function continuedTask(offset: number, taskStatus: 'BACKLOG' | 'IN_PROGRESS', blockStatus: string) {
  const s = fixture([60]);
  s.tasks[0].status = taskStatus;
  const otherDate = new Date(at('00:00').getTime() + offset * 86400000);
  s.occurrences = [
    { id: taskId(50), taskId: taskId(1), status: 'SCHEDULED', occurrenceDate: otherDate },
  ] as Snapshot['occurrences'];
  const startsAt = new Date(otherDate.getTime() + 9 * 3600000);
  s.blocks = [
    {
      id: taskId(51),
      planId: 'other',
      taskOccurrenceId: taskId(50),
      title: 'Previous allocation',
      category: 'WORK',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600000),
      durationMinutes: 60,
      status: blockStatus,
      source: 'PLANNER',
      isFixed: false,
      calendarEventId: null,
    },
  ] as Snapshot['blocks'];
  return s;
}

it.each([-2, 2])(
  'plans unfinished work scheduled %i days away without changing existing allocations',
  (offset) => {
    for (const taskStatus of ['BACKLOG', 'IN_PROGRESS'] as const) {
      for (const blockStatus of ['PLANNED', 'IN_PROGRESS']) {
        const s = continuedTask(offset, taskStatus, blockStatus);
        const original = JSON.stringify(s);
        const { candidates } = planningCandidates(s);
        expect(candidates).toMatchObject([
          { taskId: taskId(1), occurrenceId: taskId(50), remaining: 60 },
        ]);
        const result = scheduleDay(
          s,
          candidates.map((candidate) => ({ candidate, reason: 'Continue today' })),
          null,
          at('00:00')
        );
        expect([...result.scheduled.values()]).toEqual([60]);
        expect(result.document.operations).toHaveLength(1);
        expect(result.document.operations[0]).toMatchObject({
          type: 'add',
          block: { occurrenceId: taskId(50) },
        });
        expect(validateProposal(s, result.document, at('00:00')).remaining[0].minutes).toBe(0);
        expect(JSON.stringify(s)).toBe(original);
      }
    }
  }
);

it('counts actual completed effort, but never treats a past planned block as completed', () => {
  const s = continuedTask(-2, 'IN_PROGRESS', 'DONE');
  s.blocks[0].durationMinutes = 20;
  s.blocks[0].endsAt = new Date(s.blocks[0].startsAt.getTime() + 20 * 60000);
  expect(planningCandidates(s).candidates[0].remaining).toBe(40);
  s.blocks[0].status = 'PLANNED';
  expect(planningCandidates(s).candidates[0].remaining).toBe(60);
});

it('keeps unfinished work discoverable after its estimate is exhausted, without rewriting the estimate', () => {
  const s = continuedTask(-2, 'IN_PROGRESS', 'DONE');
  const { candidates, warnings } = planningCandidates(s);
  expect(candidates[0].remaining).toBe(25);
  expect(warnings).toEqual([expect.stringContaining('25-minute continuation allowance')]);
  const result = scheduleDay(
    s,
    candidates.map((candidate) => ({ candidate, reason: 'Continue' })),
    null,
    at('00:00')
  );
  expect([...result.scheduled.values()]).toEqual([25]);
  expect(s.tasks[0].estimatedMinutes).toBe(60);
});

it('deducts selected-day commitments and rejects extra time beyond that day’s remaining effort', () => {
  const s = continuedTask(0, 'IN_PROGRESS', 'PLANNED');
  expect(planningCandidates(s).candidates).toEqual([]);
  expect(() =>
    validateProposal(
      s,
      {
        schemaVersion: 1,
        operations: [
          {
            type: 'add',
            explanation: 'Extra',
            block: {
              kind: 'TASK',
              taskId: taskId(1),
              occurrenceId: taskId(50),
              startsAt: at('11:00').toISOString(),
              endsAt: at('11:30').toISOString(),
            },
          },
        ],
      },
      at('00:00')
    )
  ).toThrow('remaining estimate');
});

it('uses the planning timezone to count day commitments', () => {
  const s = continuedTask(-1, 'IN_PROGRESS', 'PLANNED');
  s.timezone = 'Europe/Amsterdam';
  s.blocks[0].startsAt = wallInstant(s.date, 0, s.timezone);
  s.blocks[0].endsAt = wallInstant(s.date, 60, s.timezone);
  expect(planningCandidates(s).candidates).toEqual([]);
});

it('retains recurrence dates, completion, prerequisites and earliest-start eligibility', () => {
  const s = continuedTask(2, 'IN_PROGRESS', 'PLANNED');
  Object.assign(s.tasks[0], { isRecurring: true, recurrenceRule: 'FREQ=WEEKLY;BYDAY=WE' });
  expect(planningCandidates(s).candidates).toEqual([]);
  expect(() => eligible(s, taskId(1), taskId(50))).toThrow('not yet eligible');
  s.tasks[0].isRecurring = false;
  s.occurrences[0].status = 'DONE';
  expect(() => eligible(s, taskId(1), taskId(50))).toThrow('closed');
  s.occurrences[0].status = 'SCHEDULED';
  s.tasks[0].status = 'DONE';
  expect(planningCandidates(s).candidates).toEqual([]);
  s.tasks[0].status = 'IN_PROGRESS';
  s.tasks[0].earliestStartAt = new Date(at('00:00').getTime() + 86400000);
  expect(planningCandidates(s).candidates).toEqual([]);
  s.tasks[0].earliestStartAt = null;
  s.dependencies = [
    {
      blockedTaskId: taskId(1),
      isHardBlock: true,
      dependsOnTask: { userId: 'owner', status: 'BACKLOG' },
    },
  ] as Snapshot['dependencies'];
  expect(planningCandidates(s).candidates).toEqual([]);
});

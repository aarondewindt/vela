import { date, at, taskId } from '../generation/fixtures';
import type { Snapshot } from './snapshot';
import { replanSchema, documentSchema, type ReplanInput, type ProposalDocument } from './schema';
import { replanDay } from './replan';
import { progressFixture } from './replan-fixtures';
import { validateProposal } from './validate';

export const request = (patch: Partial<ReplanInput> = {}): ReplanInput => ({
  requestId: taskId(99),
  date,
  baseHash: 'a'.repeat(64),
  action: 'extend',
  blockId: taskId(20),
  endTime: '10:30',
  estimatedMinutes: 90,
  completeTask: false,
  pullForward: false,
  explanation: 'Work took longer',
  ...patch,
});
const build = (s: Snapshot, patch: Partial<ReplanInput> = {}, now = at('09:30')) =>
  replanDay(s, request(patch), 'request-hash', now);
const validate = (s: Snapshot, d: ProposalDocument, now = at('09:30')) =>
  validateProposal(s, d, now);

it('extends active work, moves only affected work, preserves identity and avoids double-counting', () => {
  const s = progressFixture();
  const before = JSON.stringify(s);
  const d = documentSchema.parse(build(s));
  const result = validate(s, d);
  expect(result.final.find((b) => b.id === taskId(20))).toMatchObject({
    startsAt: at('09:00'),
    endsAt: at('10:30'),
    durationMinutes: 90,
    status: 'IN_PROGRESS',
  });
  expect(result.final.find((b) => b.id === taskId(21))).toMatchObject({
    startsAt: at('10:45'),
    endsAt: at('11:15'),
  });
  expect(result.final.find((b) => b.id === taskId(22))).toMatchObject({
    startsAt: at('11:15'),
    endsAt: at('11:45'),
  });
  expect(result.taskChanges).toEqual([
    { taskId: taskId(1), title: 'Task 1', estimatedMinutes: 90 },
  ]);
  expect(result.remaining.every((r) => r.minutes === 0)).toBe(true);
  expect(JSON.stringify(s)).toBe(before);
});
it('requires an explicit estimate increase for an overrun', () => {
  expect(() => build(progressFixture(), { estimatedMinutes: undefined })).toThrow(
    /remaining estimate/
  );
  expect(() => build(progressFixture(), { estimatedMinutes: 10 })).toThrow(/increased/);
});
it('records early finish as actual effort, keeps unfinished task open and optionally pulls work forward', () => {
  const s = progressFixture();
  const d = build(s, {
    action: 'finish',
    endTime: '09:20',
    estimatedMinutes: undefined,
    pullForward: true,
  });
  const result = validate(s, d);
  expect(result.final.find((b) => b.id === taskId(20))).toMatchObject({
    status: 'DONE',
    durationMinutes: 20,
    startsAt: at('09:00'),
    endsAt: at('09:20'),
  });
  expect(result.final.find((b) => b.id === taskId(21))?.startsAt).toEqual(at('09:40'));
  expect(result.remaining.find((r) => r.taskId === taskId(1))?.minutes).toBe(40);
  expect(result.taskChanges).toEqual([]);
  expect(s.tasks[0].status).toBe('BACKLOG');
});
it('preserves unaffected future times by default after finishing early', () => {
  const s = progressFixture();
  const d = build(s, { action: 'finish', endTime: '09:20' });
  expect(d.operations).toHaveLength(1);
});
it('records actual overruns even when history exceeds estimates or availability, without inventing completion', () => {
  const s = progressFixture();
  s.blocks[0].startsAt = at('08:00');
  const result = validate(s, build(s, { action: 'finish', endTime: '09:20' }));
  expect(result.final.find((b) => b.id === taskId(20))?.durationMinutes).toBe(80);
  expect(result.taskChanges).toEqual([]);
});
it('releases future allocations only on explicit completion and retains completed effort', () => {
  const s = progressFixture();
  s.blocks[1].taskOccurrenceId = s.occurrences[0].id;
  const d = build(s, { action: 'finish', endTime: '09:20', completeTask: true });
  const result = validate(s, d);
  expect(result.taskChanges).toContainEqual({ taskId: taskId(1), title: 'Task 1', complete: true });
  expect(result.final.some((b) => b.id === taskId(21))).toBe(false);
  expect(result.final.find((b) => b.id === taskId(20))?.status).toBe('DONE');
  expect(result.remaining.find((r) => r.taskId === taskId(1))?.minutes).toBe(0);
});
it('does not close another recurring occurrence or count its effort', () => {
  const s = progressFixture();
  s.tasks[0].isRecurring = true;
  s.occurrences[1].taskId = s.tasks[0].id;
  const result = validate(s, build(s, { action: 'finish', endTime: '09:20', completeTask: true }));
  expect(result.final.find((b) => b.id === taskId(21))?.status).toBe('PLANNED');
});
it('rejects completion while another day still commits unfinished work', () => {
  const s = progressFixture();
  s.blocks.push({
    ...s.blocks[0],
    id: taskId(50),
    planId: taskId(91),
    startsAt: new Date('2030-01-08T09:00:00Z'),
    endsAt: new Date('2030-01-08T10:00:00Z'),
  });
  expect(() => build(s, { action: 'finish', endTime: '09:20', completeTask: true })).toThrow(
    /remaining commitments/
  );
});
it.each(['DONE', 'SKIPPED', 'CANCELED'])(
  'protects %s history even from explicit progress',
  (status) => {
    const s = progressFixture();
    s.blocks[0].status = status as Snapshot['blocks'][number]['status'];
    expect(() => build(s)).toThrow(/unfinished/);
  }
);
it('protects calendar work and rejects future finish or backwards extension', () => {
  const s = progressFixture();
  expect(() => build(s, { action: 'finish', endTime: '09:45' })).toThrow(/future/);
  expect(() => build(s, { endTime: '09:45' })).toThrow(/extension/);
  s.blocks[0].calendarEventId = taskId(60);
  expect(() => build(s)).toThrow(/non-calendar/);
});
it.each(['skip', 'cancel'])(
  '%s affects scheduled work and preserves the task and occurrence',
  (action) => {
    const s = progressFixture();
    const result = validate(
      s,
      build(s, { action: action as ReplanInput['action'], blockId: taskId(21) })
    );
    expect(result.final.find((b) => b.id === taskId(21))?.status).toBe(
      action === 'skip' ? 'SKIPPED' : undefined
    );
    expect(result.remaining.find((r) => r.taskId === taskId(2))?.minutes).toBe(30);
    expect(s.occurrences[1].status).toBe('SCHEDULED');
  }
);
it('postpones selected work and preserves unrelated manual/fixed work', () => {
  const s = progressFixture();
  s.blocks[1].source = 'MANUAL';
  s.blocks[1].isFixed = true;
  const result = validate(
    s,
    build(s, { action: 'postpone', blockId: taskId(21), startTime: '13:00' })
  );
  expect(result.final.find((b) => b.id === taskId(21))).toMatchObject({
    startsAt: at('13:00'),
    source: 'MANUAL',
    isFixed: true,
  });
  expect(result.final.find((b) => b.id === taskId(22))?.startsAt).toEqual(at('11:00'));
});
it('replaces scheduled work while keeping its old task and actual history', () => {
  const s = progressFixture();
  s.tasks.push({ ...s.tasks[1], id: taskId(4), title: 'Replacement' });
  const d = build(s, { action: 'replace', blockId: taskId(21), candidateId: `${taskId(4)}:new` });
  const result = validate(s, d);
  expect(result.final.find((b) => b.title === 'Replacement')?.durationMinutes).toBe(30);
  expect(result.remaining.find((r) => r.taskId === taskId(2))?.minutes).toBe(30);
  expect(result.final.find((b) => b.id === taskId(20))?.status).toBe('IN_PROGRESS');
});
it('shows work that no longer fits after availability changes while preserving active/fixed history', () => {
  const s = progressFixture();
  s.windows = [{ ...s.windows[0], startMinute: 540, endMinute: 600 }];
  s.blocks[2].isFixed = true;
  const d = build(s, { action: 'replan', blockId: undefined });
  expect(d.replan!.warnings.join()).toMatch(/Task 2.*30 scheduled minutes no longer fit/);
  const result = validate(s, d);
  expect(result.final.map((b) => b.id)).toEqual([taskId(20), taskId(22)]);
  expect(result.remaining[0].minutes).toBe(30);
});
it('rejects stale placement cutoffs at acceptance and keeps progress timestamps stable', () => {
  const s = progressFixture();
  const d = build(s, { action: 'finish', endTime: '09:20', pullForward: true });
  expect(d.replan?.reviewBy).toBe(at('09:40').toISOString());
  expect(() => validate(s, d, at('09:41'))).toThrow(/future|protected/);
});
it('validates request shape and explicit completion intent', () => {
  expect(replanSchema.parse({ ...request(), completeTask: undefined }).completeTask).toBe(false);
  expect(replanSchema.safeParse({ ...request(), estimatedMinutes: -1 }).success).toBe(false);
  expect(replanSchema.safeParse({ ...request(), blockId: undefined }).success).toBe(false);
  expect(
    replanSchema.safeParse({ ...request(), action: 'cancel', completeTask: true }).success
  ).toBe(false);
});

it('can move imminent future work after an overrun, while leaving review time at its new start', () => {
  const s = progressFixture();
  s.blocks[0].endsAt = at('09:35');
  s.blocks[0].durationMinutes = 35;
  s.tasks[0].estimatedMinutes = 35;
  s.blocks[1].startsAt = at('09:35');
  s.blocks[1].endsAt = at('10:05');
  const d = build(s, { endTime: '10:00', estimatedMinutes: 60 });
  expect(validate(s, d).final.find((b) => b.id === taskId(21))?.startsAt).toEqual(at('10:00'));
});
it('keeps imminent valid future work unchanged when no downstream move is needed', () => {
  const s = progressFixture();
  s.blocks[1].startsAt = at('09:35');
  s.blocks[1].endsAt = at('10:05');
  const d = build(s, { action: 'finish', endTime: '09:20' });
  expect(d.operations).toHaveLength(1);
});

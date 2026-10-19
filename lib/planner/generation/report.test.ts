import { fixture, at } from './fixtures';
import { planningCandidates } from './candidates';
import { scheduleDay } from './schedule';
import { placementReport } from './report';

it('summarizes actual evening placements instead of AI claims about morning or midday', () => {
  const s = fixture([30, 45]);
  s.windows = [{ startMinute: 0, endMinute: 1440 }] as typeof s.windows;
  const candidates = planningCandidates(s).candidates;
  const result = scheduleDay(
    s,
    [{ candidate: candidates[0], reason: 'Good for the early part of the day' }],
    null,
    at('21:46')
  );
  const report = placementReport(
    candidates,
    new Set([candidates[0].key]),
    result.document,
    s.date,
    s.timezone
  );
  expect(report.summary).toBe(
    'Planned 30 task minutes across 1 task. 45 task minutes remain unscheduled.'
  );
  expect(report.outcomes[0].reason).toContain('21:56');
  expect(report.outcomes[0].reason).toContain('22:26');
  expect(report.outcomes[1].reason).toContain('Not selected');
  expect(JSON.stringify(report)).not.toMatch(/early part|middle of the day/);
  expect(report.reviewBy).toBe(at('21:56').toISOString());
});

it('uses the earliest proposed reservation as the review deadline and retains deadline risks', () => {
  const s = fixture([30]);
  s.tasks[0].dueDate = at('00:00');
  const candidates = planningCandidates(s).candidates;
  const report = placementReport(
    candidates,
    new Set([candidates[0].key]),
    {
      schemaVersion: 1,
      operations: [],
      reservations: [
        {
          category: 'LEISURE',
          startsAt: at('10:00').toISOString(),
          endsAt: at('10:30').toISOString(),
          explanation: 'Leisure',
        },
      ],
    },
    s.date,
    s.timezone
  );
  expect(report.reviewBy).toBe(at('10:00').toISOString());
  expect(report.outcomes[0]).toMatchObject({
    scheduledMinutes: 0,
    remainingMinutes: 30,
    deadlineRisk: true,
    reason: expect.stringContaining('no suitable placement'),
  });
});

it('does not invent a review deadline when no changes fit', () => {
  expect(
    placementReport([], new Set(), { schemaVersion: 1, operations: [] }, '2030-01-07', 'UTC')
      .reviewBy
  ).toBeUndefined();
});

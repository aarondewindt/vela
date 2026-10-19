import { fixture, at, taskId } from '../generation/fixtures';
import type { Snapshot } from './snapshot';

export function progressFixture() {
  const s = fixture([60, 30, 30]);
  s.plan = { id: taskId(90), timezone: 'UTC', categorySlots: [] } as unknown as Snapshot['plan'];
  s.occurrences = s.tasks.map((t, i) => ({
    id: taskId(i + 10),
    taskId: t.id,
    userId: 'owner',
    occurrenceDate: at('00:00'),
    status: 'SCHEDULED',
  })) as Snapshot['occurrences'];
  s.blocks = s.tasks.map((t, i) => ({
    id: taskId(i + 20),
    planId: s.plan!.id,
    userId: 'owner',
    title: t.title,
    taskOccurrenceId: s.occurrences[i].id,
    startsAt: at(['09:00', '10:00', '11:00'][i]),
    endsAt: at(['10:00', '10:30', '11:30'][i]),
    durationMinutes: [60, 30, 30][i],
    category: 'WORK',
    source: 'PLANNER',
    status: i === 0 ? 'IN_PROGRESS' : 'PLANNED',
    isFixed: false,
    calendarEventId: null,
  })) as Snapshot['blocks'];
  return s;
}

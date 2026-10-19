import type { Snapshot } from '../proposals/snapshot';
import type { ProposalDocument, ProposalOperation } from '../proposals/schema';
import { availability, existingBlocks, validateProposal } from '../proposals/validate';
import { wallInstant } from '../proposals/time';
import type { Candidate } from './candidates';
import { earliestGeneratedStart, MIN_PARTIAL_TASK_MINUTES } from './policy';

type Interval = { start: number; end: number };
const MINUTE = 60000;
const iso = (time: number) => new Date(time).toISOString();

function subtract(windows: Interval[], obstacles: Interval[]) {
  return obstacles
    .reduce(
      (free, obstacle) =>
        free.flatMap((w) =>
          obstacle.end <= w.start || obstacle.start >= w.end
            ? [w]
            : [
                { start: w.start, end: Math.min(w.end, obstacle.start) },
                { start: Math.max(w.start, obstacle.end), end: w.end },
              ].filter((i) => i.end > i.start)
        ),
      windows
    )
    .map((w) => ({
      start: Math.ceil(w.start / MINUTE) * MINUTE,
      end: Math.floor(w.end / MINUTE) * MINUTE,
    }))
    .filter((w) => w.end > w.start);
}

/** Application-owned placement. Model output never supplies timestamps or constraint exceptions. */
export function scheduleDay(
  s: Snapshot,
  ordered: { candidate: Candidate; reason: string }[],
  workBudget: number | null,
  now = new Date()
) {
  const cutoff = Math.max(
    wallInstant(s.date, 0, s.timezone).getTime(),
    earliestGeneratedStart(now)
  );
  const windows = availability(s)
    .map((w) => ({ start: Math.max(w.startsAt.getTime(), cutoff), end: w.endsAt.getTime() }))
    .filter((w) => w.end > w.start);
  const occupied = existingBlocks(s).filter(
    (b) =>
      ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(b.status) &&
      (!b.calendarEventId || s.events.find((e) => e.id === b.calendarEventId)?.isBusy !== false)
  );
  const obstacles = [...occupied, ...s.events.filter((e) => e.isBusy)].map((b) => ({
    start: b.startsAt.getTime(),
    end: b.endsAt.getTime(),
  }));
  const existingSlots = s.plan?.categorySlots ?? [];
  const document: ProposalDocument = { schemaVersion: 1, operations: [], reservations: [] };
  const warnings: string[] = [];
  const existingLeisure = existingSlots
    .filter((slot) => slot.category === 'LEISURE')
    .reduce((total, slot) => total + (slot.endsAt.getTime() - slot.startsAt.getTime()) / MINUTE, 0);
  let leisureRemaining = Math.max(0, s.settings.leisureMinutes - existingLeisure);
  let free = subtract(windows, [
    ...obstacles,
    ...existingSlots.map((slot) => ({
      start: slot.startsAt.getTime(),
      end: slot.endsAt.getTime(),
    })),
  ]);
  // Spread flexible reservations across the remaining day. Manual reservations are untouched.
  while (leisureRemaining > 0 && document.reservations!.length < 16) {
    const size = Math.min(
      leisureRemaining,
      s.settings.maxLeisureBlockMinutes,
      s.settings.shortLeisureBlockMinutes
    );
    const fits = free.filter((w) => (w.end - w.start) / MINUTE >= size);
    if (!fits.length) {
      break;
    }
    const window = fits[Math.floor(fits.length / 2)];
    const start =
      Math.floor((window.start + (window.end - window.start - size * MINUTE) / 2) / MINUTE) *
      MINUTE;
    document.reservations!.push({
      category: 'LEISURE',
      startsAt: iso(start),
      endsAt: iso(start + size * MINUTE),
      explanation: 'Flexible leisure time, preserving your configured daily target.',
    });
    free = subtract(free, [{ start, end: start + size * MINUTE }]);
    leisureRemaining -= size;
  }
  if (leisureRemaining > 0) {
    warnings.push(
      `Leisure target shortfall: ${leisureRemaining} minutes could not fit around existing commitments and reservations.`
    );
  }
  const scheduled = new Map<string, number>();
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: s.timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  let workUsed = 0;
  const accepts = (operations: ProposalOperation[]) => {
    try {
      validateProposal(
        s,
        { ...document, operations: [...document.operations, ...operations] },
        now
      );
      return true;
    } catch {
      return false;
    } // Pure constraint rejection; try a different placement.
  };
  for (const { candidate } of ordered) {
    let remaining = candidate.remaining;
    let earliest =
      Math.ceil(
        (s.tasks.find((t) => t.id === candidate.taskId)?.earliestStartAt?.getTime() ?? cutoff) /
          MINUTE
      ) * MINUTE;
    const isLeisure = candidate.category === 'LEISURE';
    while (remaining > 0 && document.operations.length < 98) {
      const slots = [
        ...existingSlots,
        ...document.reservations!.map((r) => ({
          ...r,
          startsAt: new Date(r.startsAt),
          endsAt: new Date(r.endsAt),
        })),
      ];
      const taskObstacles = [
        ...obstacles,
        ...slots
          .filter((slot) => slot.category !== candidate.category)
          .map((slot) => ({ start: slot.startsAt.getTime(), end: slot.endsAt.getTime() })),
        ...document.operations.flatMap((op) =>
          op.type === 'add'
            ? [
                {
                  start: new Date(op.block.startsAt).getTime(),
                  end: new Date(op.block.endsAt).getTime(),
                },
              ]
            : []
        ),
      ];
      let choices = subtract(
        windows
          .map((w) => ({ ...w, start: Math.max(w.start, earliest) }))
          .filter((w) => w.end > w.start),
        taskObstacles
      );
      // Matching slots are boundaries even when the category is allowed on both sides.
      const boundaries = slots.flatMap((slot) => [slot.startsAt.getTime(), slot.endsAt.getTime()]);
      choices = choices.flatMap((w) => {
        const points = [w.start, ...boundaries.filter((p) => p > w.start && p < w.end), w.end].sort(
          (a, b) => a - b
        );
        return points.slice(1).map((end, i) => ({ start: points[i], end }));
      });
      if (isLeisure) {
        choices = choices.filter((w) =>
          slots.some(
            (slot) =>
              slot.category === 'LEISURE' &&
              w.start >= slot.startsAt.getTime() &&
              w.end <= slot.endsAt.getTime()
          )
        );
      }
      const allowance = isLeisure
        ? remaining
        : Math.min(remaining, (workBudget ?? 1440) - workUsed);
      if (allowance <= 0) {
        break;
      }
      let placed = false;
      // Try every intact placement before splitting into smaller gaps.
      for (const { window, partial } of [false, true].flatMap((partial) =>
        choices.map((window) => ({ window, partial }))
      )) {
        const maxSession = isLeisure
          ? s.settings.maxLeisureBlockMinutes
          : s.settings.workSessionMinutes;
        const add = (start: number, duration: number): ProposalOperation => ({
          type: 'add',
          explanation: `Allocate ${duration} minutes on ${format.format(new Date(start))}–${format.format(new Date(start + duration * MINUTE))} (${s.timezone}), within availability and scheduling constraints.`,
          block: {
            kind: 'TASK',
            taskId: candidate.taskId,
            occurrenceId: candidate.occurrenceId,
            startsAt: iso(start),
            endsAt: iso(start + duration * MINUTE),
          },
        });
        let operations: ProposalOperation[] | null = null;
        // Prefer finishing intact, or an early break before starting, over avoidable splitting.
        if (!partial && remaining <= allowance && remaining <= maxSession + (isLeisure ? 0 : 30)) {
          for (const delay of [0, s.settings.shortBreakMinutes]) {
            const start = window.start + delay * MINUTE;
            if (start + remaining * MINUTE > window.end) {
              continue;
            }
            const trial: ProposalOperation[] = delay
              ? [
                  {
                    type: 'add',
                    explanation: 'Take a break before starting the next task.',
                    block: { kind: 'REST', startsAt: iso(window.start), endsAt: iso(start) },
                  },
                  add(start, remaining),
                ]
              : [add(start, remaining)];
            if (accepts(trial)) {
              operations = trial;
              break;
            }
          }
        }
        if (partial && !operations) {
          // Find the largest valid segment at this boundary. The shared validator also
          // protects downstream existing work and includes completed/active session time.
          const maximum = Math.min(
            allowance,
            maxSession,
            Math.floor((window.end - window.start) / MINUTE)
          );
          for (let duration = maximum; duration >= MIN_PARTIAL_TASK_MINUTES; duration--) {
            if (remaining - duration > 0 && remaining - duration < MIN_PARTIAL_TASK_MINUTES) {
              continue;
            }
            const trial = [add(window.start, duration)];
            if (accepts(trial)) {
              operations = trial;
              break;
            }
          }
        }
        if (partial && !operations) {
          // A busy meeting is not rest. Search forward by a qualifying free break.
          const start = window.start + s.settings.shortBreakMinutes * MINUTE;
          const maximum = Math.min(
            allowance,
            maxSession,
            Math.floor((window.end - start) / MINUTE)
          );
          for (let duration = maximum; duration >= MIN_PARTIAL_TASK_MINUTES; duration--) {
            if (remaining - duration > 0 && remaining - duration < MIN_PARTIAL_TASK_MINUTES) {
              continue;
            }
            const trial: ProposalOperation[] = [
              {
                type: 'add',
                explanation: 'Rest between work sessions.',
                block: { kind: 'REST', startsAt: iso(window.start), endsAt: iso(start) },
              },
              add(start, duration),
            ];
            if (accepts(trial)) {
              operations = trial;
              break;
            }
          }
        }
        if (operations) {
          document.operations.push(...operations);
          const task = operations.at(-1)!;
          if (task.type !== 'add') {
            throw new Error('Invalid generated placement.');
          }
          const duration =
            (new Date(task.block.endsAt).getTime() - new Date(task.block.startsAt).getTime()) /
            MINUTE;
          remaining -= duration;
          if (!isLeisure) {
            workUsed += duration;
          }
          earliest = new Date(task.block.endsAt).getTime();
          placed = true;
          break;
        }
      }
      if (!placed) {
        break;
      }
    }
    scheduled.set(candidate.key, candidate.remaining - remaining);
  }
  if (document.operations.length || document.reservations!.length) {
    validateProposal(s, document, now);
  }
  return {
    document,
    scheduled,
    warnings,
    availableWindows: windows.map((window) => ({
      startsAt: iso(window.start),
      endsAt: iso(window.end),
    })),
  };
}

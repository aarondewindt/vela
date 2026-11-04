import { createHash } from 'node:crypto';

export const availabilityCategories = ['WORK', 'LIFE', 'LEISURE', 'REST'] as const;
export type AvailabilityCategory = (typeof availabilityCategories)[number];
export type SlotCategoryPolicyMode = 'ALL' | 'ALLOW_ONLY' | 'EXCLUDE';

export type SlotCategoryPolicy = {
  mode: SlotCategoryPolicyMode;
  categories: AvailabilityCategory[];
};

type SlotValue = {
  position: number;
  startMinute: number;
  endMinute: number;
  name: string | null;
  guidance: string | null;
  policy?: SlotCategoryPolicy | null;
};

export type TemplateRevisionSlot = SlotValue & {
  id: string;
  logicalSlotId: string;
};

export type DateAvailabilitySlot = SlotValue & {
  id: string;
  sourceTemplateId?: string | null;
  sourceTemplateRevisionId?: string | null;
  sourceLogicalSlotId?: string | null;
};

export type EffectiveAvailabilityInput = {
  date: string;
  timezonePeriods: { effectiveDate: string; timezone: string }[];
  weeklyAssignments: {
    id: string;
    weekday: number;
    effectiveDate: string;
    templateId: string | null;
  }[];
  templates: {
    id: string;
    revisions: {
      id: string;
      effectiveDate: string;
      name: string;
      slots: TemplateRevisionSlot[];
    }[];
  }[];
  dateOverrides: { id: string; date: string; slots: DateAvailabilitySlot[] }[];
};

export type EffectiveAvailabilitySlot = {
  id: string;
  logicalSlotId: string | null;
  templateRevisionSlotId: string | null;
  sourceTemplateId: string | null;
  sourceTemplateRevisionId: string | null;
  sourceLogicalSlotId: string | null;
  origin: 'TEMPLATE_REVISION' | 'DATE_OVERRIDE';
  position: number;
  startMinute: number;
  endMinute: number;
  startsAt: string;
  endsAt: string;
  name: string | null;
  guidance: string | null;
  policy: SlotCategoryPolicy;
};

export type EffectiveAvailability = {
  schemaVersion: 1;
  date: string;
  timezone: string;
  origin: 'DATE_OVERRIDE' | 'WEEKLY_ASSIGNMENT' | 'UNASSIGNED_WEEKDAY';
  dateOverrideId: string | null;
  assignmentId: string | null;
  templateId: string | null;
  templateRevisionId: string | null;
  templateName: string | null;
  slots: EffectiveAvailabilitySlot[];
};

export type CanonicalAvailabilitySnapshot = {
  schemaVersion: 1;
  date: string;
  timezone: string;
  origin: EffectiveAvailability['origin'];
  templateId: string | null;
  templateName: string | null;
  slots: {
    id: string;
    origin: EffectiveAvailabilitySlot['origin'];
    position: number;
    startMinute: number;
    endMinute: number;
    startsAt: string;
    endsAt: string;
    name: string | null;
    guidance: string | null;
    policy: SlotCategoryPolicy;
  }[];
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: string) {
  if (
    !datePattern.test(date) ||
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
}

function nextDate(date: string) {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function representedLocalMinute(format: Intl.DateTimeFormat, instant: number) {
  const parts = Object.fromEntries(
    format.formatToParts(new Date(instant)).map(({ type, value }) => [type, value])
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
}

function wallCandidates(date: string, minute: number, timezone: string) {
  const boundaryDate = minute === 1440 ? nextDate(date) : date;
  const boundaryMinute = minute === 1440 ? 0 : minute;
  const [year, month, day] = boundaryDate.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, 0, boundaryMinute);
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new Error(`Invalid Planner timezone: ${timezone}`);
  }
  const matches = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 3) {
    const sample = target + hour * 3_600_000;
    const candidate = target - (representedLocalMinute(format, sample) - sample);
    if (representedLocalMinute(format, candidate) === target) {
      matches.add(candidate);
    }
  }
  return [...matches].sort((a, b) => a - b);
}

function wallInstant(date: string, minute: number, timezone: string, fullDayBoundary: boolean) {
  const matches = wallCandidates(date, minute, timezone);
  if (matches.length === 0) {
    throw new Error(`${date} minute ${minute} does not exist in timezone ${timezone}`);
  }
  if (matches.length > 1 && !fullDayBoundary) {
    throw new Error(`${date} minute ${minute} occurs twice in timezone ${timezone}`);
  }
  return new Date(matches[0]).toISOString();
}

function normalizePolicy(policy: SlotCategoryPolicy | null | undefined): SlotCategoryPolicy {
  const mode = policy?.mode ?? 'ALL';
  if (!['ALL', 'ALLOW_ONLY', 'EXCLUDE'].includes(mode)) {
    throw new Error(`Invalid slot category policy mode: ${String(mode)}`);
  }
  const order = new Map(availabilityCategories.map((category, index) => [category, index]));
  const categories = mode === 'ALL' ? [] : [...new Set(policy?.categories ?? [])];
  for (const category of categories) {
    if (!order.has(category)) {
      throw new Error(`Invalid availability category: ${category}`);
    }
  }
  categories.sort((a, b) => order.get(a)! - order.get(b)!);
  return { mode, categories };
}

function validateAndOrderSlots<T extends SlotValue>(slots: T[]) {
  const positions = new Set<number>();
  for (const slot of slots) {
    if (!Number.isInteger(slot.position) || slot.position < 0 || positions.has(slot.position)) {
      throw new Error('Availability slot positions must be unique non-negative integers.');
    }
    positions.add(slot.position);
    if (
      !Number.isInteger(slot.startMinute) ||
      !Number.isInteger(slot.endMinute) ||
      slot.startMinute < 0 ||
      slot.endMinute > 1440 ||
      slot.endMinute <= slot.startMinute
    ) {
      throw new Error('Availability slots must use valid same-day minute boundaries.');
    }
  }
  const byTime = [...slots].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute
  );
  for (let index = 1; index < byTime.length; index += 1) {
    if (byTime[index].startMinute < byTime[index - 1].endMinute) {
      throw new Error('Availability slots overlap.');
    }
  }
  return [...slots].sort((a, b) => a.position - b.position);
}

function effective<T extends { effectiveDate: string }>(values: T[], date: string) {
  return values
    .filter((value) => value.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
}

function resolvedSlot(
  date: string,
  timezone: string,
  slot: TemplateRevisionSlot | DateAvailabilitySlot,
  origin: EffectiveAvailabilitySlot['origin']
): EffectiveAvailabilitySlot {
  const fullDay = slot.startMinute === 0 && slot.endMinute === 1440;
  const templateSlot = origin === 'TEMPLATE_REVISION' ? (slot as TemplateRevisionSlot) : null;
  const dateSlot = origin === 'DATE_OVERRIDE' ? (slot as DateAvailabilitySlot) : null;
  return {
    id: templateSlot?.logicalSlotId ?? slot.id,
    logicalSlotId: templateSlot?.logicalSlotId ?? null,
    templateRevisionSlotId: templateSlot?.id ?? null,
    sourceTemplateId: dateSlot?.sourceTemplateId ?? null,
    sourceTemplateRevisionId: dateSlot?.sourceTemplateRevisionId ?? null,
    sourceLogicalSlotId: dateSlot?.sourceLogicalSlotId ?? null,
    origin,
    position: slot.position,
    startMinute: slot.startMinute,
    endMinute: slot.endMinute,
    startsAt: wallInstant(date, slot.startMinute, timezone, fullDay),
    endsAt: wallInstant(date, slot.endMinute, timezone, fullDay),
    name: slot.name,
    guidance: slot.guidance,
    policy: normalizePolicy(slot.policy),
  };
}

export function resolveEffectiveAvailability(
  input: EffectiveAvailabilityInput
): EffectiveAvailability {
  assertDate(input.date);
  const timezonePeriod = effective(input.timezonePeriods, input.date);
  if (!timezonePeriod) {
    throw new Error(`No Planner timezone is effective on ${input.date}.`);
  }
  // Validate eagerly so an invalid IANA zone fails even when the selected date has no slots.
  wallCandidates(input.date, 0, timezonePeriod.timezone);

  const override = input.dateOverrides.find((candidate) => candidate.date === input.date);
  if (override) {
    return {
      schemaVersion: 1,
      date: input.date,
      timezone: timezonePeriod.timezone,
      origin: 'DATE_OVERRIDE',
      dateOverrideId: override.id,
      assignmentId: null,
      templateId: null,
      templateRevisionId: null,
      templateName: null,
      slots: validateAndOrderSlots(override.slots).map((slot) =>
        resolvedSlot(input.date, timezonePeriod.timezone, slot, 'DATE_OVERRIDE')
      ),
    };
  }

  const weekday = new Date(`${input.date}T00:00:00.000Z`).getUTCDay();
  const assignment = effective(
    input.weeklyAssignments.filter((candidate) => candidate.weekday === weekday),
    input.date
  );
  if (!assignment?.templateId) {
    return {
      schemaVersion: 1,
      date: input.date,
      timezone: timezonePeriod.timezone,
      origin: 'UNASSIGNED_WEEKDAY',
      dateOverrideId: null,
      assignmentId: assignment?.id ?? null,
      templateId: null,
      templateRevisionId: null,
      templateName: null,
      slots: [],
    };
  }
  const template = input.templates.find((candidate) => candidate.id === assignment.templateId);
  if (!template) {
    throw new Error(`Assigned availability template ${assignment.templateId} was not loaded.`);
  }
  const revision = effective(template.revisions, input.date);
  if (!revision) {
    throw new Error(
      `Availability template ${template.id} has no revision effective on ${input.date}.`
    );
  }
  return {
    schemaVersion: 1,
    date: input.date,
    timezone: timezonePeriod.timezone,
    origin: 'WEEKLY_ASSIGNMENT',
    dateOverrideId: null,
    assignmentId: assignment.id,
    templateId: template.id,
    templateRevisionId: revision.id,
    templateName: revision.name,
    slots: validateAndOrderSlots(revision.slots).map((slot) =>
      resolvedSlot(input.date, timezonePeriod.timezone, slot, 'TEMPLATE_REVISION')
    ),
  };
}

export function canonicalAvailabilitySnapshot(
  snapshot: EffectiveAvailability
): CanonicalAvailabilitySnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    date: snapshot.date,
    timezone: snapshot.timezone,
    origin: snapshot.origin,
    templateId: snapshot.templateId,
    templateName: snapshot.templateName,
    slots: snapshot.slots.map((slot) => ({
      id: slot.id,
      origin: slot.origin,
      position: slot.position,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      name: slot.name,
      guidance: slot.guidance,
      policy: slot.policy,
    })),
  };
}

export function availabilitySnapshotHash(snapshot: EffectiveAvailability) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalAvailabilitySnapshot(snapshot)))
    .digest('hex');
}

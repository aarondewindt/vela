import "server-only";

import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  availabilityCategories,
  availabilitySnapshotHash,
  resolveEffectiveAvailability,
  type DateAvailabilitySlot,
  type EffectiveAvailability,
  type SlotCategoryPolicy,
  type TemplateRevisionSlot,
} from "./resolver";

type AvailabilityClient = Prisma.TransactionClient | PrismaClient;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);

const policySchema = z
  .object({
    mode: z.enum(["ALL", "ALLOW_ONLY", "EXCLUDE"]).default("ALL"),
    categories: z.array(z.enum(availabilityCategories)).max(4).default([]),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === "ALL" && policy.categories.length > 0) {
      context.addIssue({ code: "custom", path: ["categories"], message: "ALL has no categories." });
    }
    if (new Set(policy.categories).size !== policy.categories.length) {
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message: "Categories must be unique.",
      });
    }
  });

const slotValueSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    name: z.string().trim().min(1).max(120).nullable().default(null),
    guidance: z.string().trim().min(1).max(1000).nullable().default(null),
    policy: policySchema.default({ mode: "ALL", categories: [] }),
  })
  .strict()
  .refine((slot) => slot.endMinute > slot.startMinute, {
    path: ["endMinute"],
    message: "End must be after start.",
  });

const templateSlotSchema = slotValueSchema.extend({ logicalSlotId: z.uuid().optional() }).strict();
const dateSlotSchema = slotValueSchema
  .extend({
    sourceTemplateId: z.uuid().nullable().optional(),
    sourceTemplateRevisionId: z.uuid().nullable().optional(),
    sourceLogicalSlotId: z.uuid().nullable().optional(),
  })
  .strict();
const effectiveDate = z.iso.date().optional();
const templateRevisionSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    effectiveDate,
    slots: z.array(templateSlotSchema).max(100),
  })
  .strict()
  .superRefine(({ slots }, context) => {
    const ids = slots.flatMap(({ logicalSlotId }) => (logicalSlotId ? [logicalSlotId] : []));
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Each logical slot can appear only once in a revision.",
      });
    }
  });
const assignmentSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    templateId: z.uuid().nullable(),
    effectiveDate,
  })
  .strict();
const dateOverrideSchema = z
  .object({
    date: z.iso.date(),
    source: z.string().trim().min(1).max(64).default("manual"),
    slots: z.array(dateSlotSchema).max(100),
  })
  .strict();
const timezoneSchema = z
  .object({ timezone: z.string().trim().max(64), effectiveDate: z.iso.date().optional() })
  .strict()
  .superRefine(({ timezone }, context) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Use a valid IANA timezone.",
      });
    }
  });
const duplicateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    effectiveDate,
  })
  .strict();

function localDate(timezone: string, now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(date: string, amount: number) {
  return dateString(new Date(day(date).getTime() + amount * 86_400_000));
}

function badRequest(message: string) {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

function validateSlotSet(
  slots: z.output<typeof templateSlotSchema>[] | z.output<typeof dateSlotSchema>[],
) {
  // The canonical resolver owns ordering, overlap and boundary validation.
  resolveEffectiveAvailability({
    date: "2030-01-01",
    timezonePeriods: [{ effectiveDate: "2000-01-01", timezone: "UTC" }],
    weeklyAssignments: [],
    templates: [],
    dateOverrides: [
      {
        id: "validation",
        date: "2030-01-01",
        slots: slots.map((slot, position) => ({
          id: randomUUID(),
          position,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          name: slot.name,
          guidance: slot.guidance,
          policy: slot.policy,
        })),
      },
    ],
  });
}

async function userToday(client: AvailabilityClient, userId: string, now: Date) {
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }
  let timezone = user.timezone;
  let today = localDate(timezone, now);
  // The legacy user timezone is only a bootstrap hint while the additive history is empty.
  // Re-evaluate once because the effective Planner zone can cross a local date boundary.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const period = await client.plannerTimezonePeriod.findFirst({
      where: { userId, effectiveDate: { lte: day(today) } },
      orderBy: { effectiveDate: "desc" },
      select: { timezone: true },
    });
    if (!period) {
      break;
    }
    timezone = period.timezone;
    today = localDate(timezone, now);
  }
  return { timezone, today };
}

async function normalizedEffectiveDate(
  client: AvailabilityClient,
  userId: string,
  requested: string | undefined,
  defaultOffset: number,
  now: Date,
) {
  const current = await userToday(client, userId, now);
  const value = requested ?? addDays(current.today, defaultOffset);
  if (value < current.today) {
    throw badRequest("Availability changes cannot start in the past.");
  }
  return value;
}

function mapPolicy(mode: string, categories: string[]): SlotCategoryPolicy {
  return {
    mode: mode as SlotCategoryPolicy["mode"],
    categories: categories as SlotCategoryPolicy["categories"],
  };
}

export async function resolveAvailabilityWithClient(
  client: AvailabilityClient,
  userId: string,
  date: string,
): Promise<EffectiveAvailability> {
  const calendarDate = day(date);
  const weekday = calendarDate.getUTCDay();
  const [timezonePeriod, fallbackUser, override, assignment] = await Promise.all([
    client.plannerTimezonePeriod.findFirst({
      where: { userId, effectiveDate: { lte: calendarDate } },
      orderBy: { effectiveDate: "desc" },
    }),
    client.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    client.dateAvailabilityOverride.findUnique({
      where: { userId_date: { userId, date: calendarDate } },
      include: { slots: { orderBy: { position: "asc" } } },
    }),
    client.weeklyAvailabilityAssignment.findFirst({
      where: { userId, weekday, effectiveDate: { lte: calendarDate } },
      orderBy: { effectiveDate: "desc" },
    }),
  ]);
  if (!fallbackUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }
  // #70 owns migration of existing owners into timezone history. Until that
  // foundation is populated, keep ordinary Planner reads available without
  // synthesizing or persisting canonical availability records.
  const resolvedTimezone = timezonePeriod?.timezone ?? fallbackUser.timezone;
  const revision =
    !override && assignment?.templateId
      ? await client.availabilityTemplateRevision.findFirst({
          where: { templateId: assignment.templateId, effectiveDate: { lte: calendarDate } },
          orderBy: { effectiveDate: "desc" },
          include: { slots: { orderBy: { position: "asc" } } },
        })
      : null;

  return resolveEffectiveAvailability({
    date,
    timezonePeriods: [
      {
        effectiveDate: timezonePeriod ? dateString(timezonePeriod.effectiveDate) : "0001-01-01",
        timezone: resolvedTimezone,
      },
    ],
    weeklyAssignments: assignment
      ? [
          {
            id: assignment.id,
            weekday: assignment.weekday,
            effectiveDate: dateString(assignment.effectiveDate),
            templateId: assignment.templateId,
          },
        ]
      : [],
    templates:
      assignment?.templateId && revision
        ? [
            {
              id: assignment.templateId,
              revisions: [
                {
                  id: revision.id,
                  effectiveDate: dateString(revision.effectiveDate),
                  name: revision.name,
                  slots: revision.slots.map(
                    (slot): TemplateRevisionSlot => ({
                      id: slot.id,
                      logicalSlotId: slot.logicalSlotId,
                      position: slot.position,
                      startMinute: slot.startMinute,
                      endMinute: slot.endMinute,
                      name: slot.name,
                      guidance: slot.guidance,
                      policy: mapPolicy(slot.policyMode, slot.policyCategories),
                    }),
                  ),
                },
              ],
            },
          ]
        : [],
    dateOverrides: override
      ? [
          {
            id: override.id,
            date,
            slots: override.slots.map(
              (slot): DateAvailabilitySlot => ({
                id: slot.id,
                position: slot.position,
                startMinute: slot.startMinute,
                endMinute: slot.endMinute,
                name: slot.name,
                guidance: slot.guidance,
                policy: mapPolicy(slot.policyMode, slot.policyCategories),
                sourceTemplateId: slot.sourceTemplateId,
                sourceTemplateRevisionId: slot.sourceTemplateRevisionId,
                sourceLogicalSlotId: slot.sourceLogicalSlotId,
              }),
            ),
          },
        ]
      : [],
  });
}

// Same coarse order as every Planner writer; no model calls run under this lock.
async function availabilityTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`LOCK TABLE "user", "themes", "tasks", "task_dependencies", "task_occurrences", "availability_windows", "day_overrides", "date_availability_windows", "availability_templates", "availability_template_slots", "availability_template_revisions", "availability_template_revision_slots", "weekly_availability_assignments", "date_availability_overrides", "date_availability_slots", "planner_timezone_periods", "calendar_events", "planner_generation_settings", "daily_plans", "daily_blocks", "daily_plan_category_slots", "planning_proposals", "planner_drafts", "planner_draft_revisions", "planner_draft_requests" IN SHARE ROW EXCLUSIVE MODE`;
        return operation(tx);
      },
      { timeout: 15000, maxWait: 5000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (["P2002", "P2034"].includes(error.code) ||
        (error.code === "P2010" && ["40001", "40P01", "55P03"].includes(String(error.meta?.code))))
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Availability changed or is busy. Refresh and retry.",
      });
    }
    throw error;
  }
}

type Impact = {
  affectedFrom: string;
  affectedWeekdays: number[];
  affectedDates: string[];
  openDrafts: {
    id: string;
    date: string;
    previousHash: string | null;
    currentHash: string | null;
  }[];
};

async function hashOrNull(client: AvailabilityClient, userId: string, date: string) {
  try {
    return availabilitySnapshotHash(await resolveAvailabilityWithClient(client, userId, date));
  } catch (error) {
    if (
      error instanceof TRPCError &&
      error.code === "BAD_REQUEST" &&
      error.message.startsWith("No Planner timezone is configured")
    ) {
      return null;
    }
    throw error;
  }
}

async function mutateWithImpact<T>(
  userId: string,
  affectedFrom: string | ((tx: Prisma.TransactionClient) => Promise<string>),
  weekdays: number[] | ((tx: Prisma.TransactionClient, resolvedFrom: string) => Promise<number[]>),
  dates: string[] | null,
  operation: (tx: Prisma.TransactionClient, resolvedFrom: string) => Promise<T>,
): Promise<{ value: T; impact: Impact }> {
  return availabilityTransaction(async (tx) => {
    const resolvedFrom = typeof affectedFrom === "string" ? affectedFrom : await affectedFrom(tx);
    const resolvedWeekdays = Array.isArray(weekdays) ? weekdays : await weekdays(tx, resolvedFrom);
    const drafts = await tx.plannerDraft.findMany({
      where: {
        userId,
        status: "OPEN",
        planDate: { gte: day(resolvedFrom) },
        ...(dates ? { planDate: { in: dates.map(day) } } : {}),
      },
      select: { id: true, planDate: true },
    });
    const candidates = drafts.filter(
      (draft) =>
        resolvedWeekdays.length === 0 || resolvedWeekdays.includes(draft.planDate.getUTCDay()),
    );
    const before = new Map<string, string | null>();
    for (const draft of candidates) {
      before.set(draft.id, await hashOrNull(tx, userId, dateString(draft.planDate)));
    }
    const value = await operation(tx, resolvedFrom);
    const changed: Impact["openDrafts"] = [];
    for (const draft of candidates) {
      const date = dateString(draft.planDate);
      const currentHash = await hashOrNull(tx, userId, date);
      const previousHash = before.get(draft.id) ?? null;
      if (currentHash !== previousHash) {
        changed.push({ id: draft.id, date, previousHash, currentHash });
      }
    }
    return {
      value,
      impact: {
        affectedFrom: resolvedFrom,
        affectedWeekdays: [...new Set(resolvedWeekdays)].sort(),
        affectedDates: dates ?? changed.map((draft) => draft.date),
        openDrafts: changed,
      },
    };
  });
}

function revisionSlotData(slots: z.output<typeof templateSlotSchema>[], logicalIds: string[]) {
  return slots.map((slot, position) => ({
    logicalSlotId: logicalIds[position],
    position,
    startMinute: slot.startMinute,
    endMinute: slot.endMinute,
    name: slot.name,
    guidance: slot.guidance,
    policyMode: slot.policy.mode,
    policyCategories: slot.policy.categories,
  }));
}

function dateSlotData(slots: z.output<typeof dateSlotSchema>[]) {
  return slots.map((slot, position) => ({
    id: randomUUID(),
    position,
    startMinute: slot.startMinute,
    endMinute: slot.endMinute,
    name: slot.name,
    guidance: slot.guidance,
    policyMode: slot.policy.mode,
    policyCategories: slot.policy.categories,
    sourceTemplateId: slot.sourceTemplateId ?? null,
    sourceTemplateRevisionId: slot.sourceTemplateRevisionId ?? null,
    sourceLogicalSlotId: slot.sourceLogicalSlotId ?? null,
  }));
}

export const availabilityService = {
  async resolve(userId: string, date: string) {
    z.iso.date().parse(date);
    const snapshot = await resolveAvailabilityWithClient(prisma, userId, date);
    return { snapshot, hash: availabilitySnapshotHash(snapshot) };
  },

  async createTemplate(
    userId: string,
    raw: z.input<typeof templateRevisionSchema>,
    now = new Date(),
  ) {
    const input = templateRevisionSchema.parse(raw);
    validateSlotSet(input.slots);
    return availabilityTransaction(async (tx) => {
      const startsOn = await normalizedEffectiveDate(tx, userId, input.effectiveDate, 1, now);
      const logicalIds = input.slots.map(() => randomUUID());
      const created = await tx.availabilityTemplate.create({ data: { userId } });
      await tx.availabilityTemplateSlot.createMany({
        data: logicalIds.map((id) => ({ id, templateId: created.id })),
      });
      await tx.availabilityTemplateRevision.create({
        data: {
          templateId: created.id,
          effectiveDate: day(startsOn),
          name: input.name,
          slots: { create: revisionSlotData(input.slots, logicalIds) },
        },
      });
      const template = await tx.availabilityTemplate.findUniqueOrThrow({
        where: { id: created.id },
        include: { revisions: true, logicalSlots: true },
      });
      return {
        template,
        impact: {
          affectedFrom: startsOn,
          affectedWeekdays: [],
          affectedDates: [],
          openDrafts: [],
        } satisfies Impact,
      };
    });
  },

  async reviseTemplate(
    userId: string,
    templateId: string,
    raw: z.input<typeof templateRevisionSchema>,
    now = new Date(),
  ) {
    const input = templateRevisionSchema.parse(raw);
    validateSlotSet(input.slots);
    return mutateWithImpact(
      userId,
      (tx) => normalizedEffectiveDate(tx, userId, input.effectiveDate, 1, now),
      async (tx, startsOn) => {
        const assignments = await tx.weeklyAvailabilityAssignment.findMany({
          where: { userId },
          orderBy: { effectiveDate: "asc" },
          select: { weekday: true, effectiveDate: true, templateId: true },
        });
        const affected: number[] = [];
        for (let weekday = 0; weekday < 7; weekday += 1) {
          const rows = assignments.filter((assignment) => assignment.weekday === weekday);
          const current = rows
            .filter((assignment) => dateString(assignment.effectiveDate) <= startsOn)
            .at(-1);
          const futureUsesTemplate = rows.some(
            (assignment) =>
              dateString(assignment.effectiveDate) > startsOn &&
              assignment.templateId === templateId,
          );
          if (current?.templateId === templateId || futureUsesTemplate) {
            affected.push(weekday);
          }
        }
        return affected;
      },
      null,
      async (tx, startsOn) => {
        const template = await tx.availabilityTemplate.findFirst({
          where: { id: templateId, userId },
          include: {
            logicalSlots: { select: { id: true } },
            revisions: {
              orderBy: { effectiveDate: "asc" },
              select: {
                effectiveDate: true,
                slots: { select: { logicalSlotId: true } },
              },
            },
          },
        });
        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Template not found." });
        }
        if (template.archivedAt) {
          throw badRequest("Restore the template before revising it.");
        }
        const owned = new Set(template.logicalSlots.map(({ id }) => id));
        const previous = template.revisions
          .filter((revision) => dateString(revision.effectiveDate) < startsOn)
          .at(-1);
        const retained = new Set(previous?.slots.map(({ logicalSlotId }) => logicalSlotId) ?? []);
        for (const slot of input.slots) {
          if (slot.logicalSlotId && !owned.has(slot.logicalSlotId)) {
            throw badRequest("A logical slot does not belong to this template.");
          }
          if (slot.logicalSlotId && !retained.has(slot.logicalSlotId)) {
            throw badRequest("A recreated slot must use a new logical identity.");
          }
        }
        const logicalIds = input.slots.map((slot) => slot.logicalSlotId ?? randomUUID());
        const nextLogicalIds = new Set(
          template.revisions
            .filter((revision) => dateString(revision.effectiveDate) > startsOn)
            .flatMap((revision) => revision.slots.map(({ logicalSlotId }) => logicalSlotId)),
        );
        if ([...retained].some((id) => !logicalIds.includes(id) && nextLogicalIds.has(id))) {
          throw badRequest(
            "Deleting this slot would resurrect its identity in an existing future revision. Revise the future configuration first.",
          );
        }
        const newIds = logicalIds.filter((id) => !owned.has(id));
        if (newIds.length) {
          await tx.availabilityTemplateSlot.createMany({
            data: newIds.map((id) => ({ id, templateId })),
          });
        }
        return tx.availabilityTemplateRevision.create({
          data: {
            templateId,
            effectiveDate: day(startsOn),
            name: input.name,
            slots: { create: revisionSlotData(input.slots, logicalIds) },
          },
          include: { slots: { orderBy: { position: "asc" } } },
        });
      },
    );
  },

  async duplicateTemplate(
    userId: string,
    sourceTemplateId: string,
    raw: z.input<typeof duplicateTemplateSchema> = {},
    now = new Date(),
  ) {
    const input = duplicateTemplateSchema.parse(raw);
    const startsOn = await normalizedEffectiveDate(prisma, userId, input.effectiveDate, 1, now);
    const source = await prisma.availabilityTemplate.findFirst({
      where: { id: sourceTemplateId, userId },
      include: {
        revisions: {
          where: { effectiveDate: { lte: day(startsOn) } },
          orderBy: { effectiveDate: "desc" },
          take: 1,
          include: { slots: { orderBy: { position: "asc" } } },
        },
      },
    });
    if (!source) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Template not found." });
    }
    const revision = source.revisions[0];
    if (!revision) {
      throw badRequest("The source template has no revision effective on that date.");
    }
    return availabilityService.createTemplate(
      userId,
      {
        name: input.name ?? `${revision.name} copy`,
        effectiveDate: startsOn,
        slots: revision.slots.map((slot) => ({
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          name: slot.name,
          guidance: slot.guidance,
          policy: mapPolicy(slot.policyMode, slot.policyCategories),
        })),
      },
      now,
    );
  },

  async assignWeekday(userId: string, raw: z.input<typeof assignmentSchema>, now = new Date()) {
    const input = assignmentSchema.parse(raw);
    return mutateWithImpact(
      userId,
      (tx) => normalizedEffectiveDate(tx, userId, input.effectiveDate, 1, now),
      [input.weekday],
      null,
      async (tx, startsOn) => {
        if (input.templateId) {
          const template = await tx.availabilityTemplate.findFirst({
            where: { id: input.templateId, userId, archivedAt: null },
            select: {
              id: true,
              revisions: {
                where: { effectiveDate: { lte: day(startsOn) } },
                take: 1,
                select: { id: true },
              },
            },
          });
          if (!template) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Template not found." });
          }
          if (template.revisions.length === 0) {
            throw badRequest("The template has no revision effective on the assignment date.");
          }
        }
        return tx.weeklyAvailabilityAssignment.upsert({
          where: {
            userId_weekday_effectiveDate: {
              userId,
              weekday: input.weekday,
              effectiveDate: day(startsOn),
            },
          },
          create: {
            userId,
            weekday: input.weekday,
            effectiveDate: day(startsOn),
            templateId: input.templateId,
          },
          update: { templateId: input.templateId },
        });
      },
    );
  },

  async setTimezone(userId: string, raw: z.input<typeof timezoneSchema>, now = new Date()) {
    const input = timezoneSchema.parse(raw);
    return mutateWithImpact(
      userId,
      (tx) => normalizedEffectiveDate(tx, userId, input.effectiveDate, 0, now),
      [0, 1, 2, 3, 4, 5, 6],
      null,
      (tx, startsOn) =>
        tx.plannerTimezonePeriod.create({
          data: { userId, effectiveDate: day(startsOn), timezone: input.timezone },
        }),
    );
  },

  async setDateOverride(userId: string, raw: z.input<typeof dateOverrideSchema>, now = new Date()) {
    const input = dateOverrideSchema.parse(raw);
    validateSlotSet(input.slots);
    return mutateWithImpact(
      userId,
      async (tx) => {
        const { today } = await userToday(tx, userId, now);
        if (input.date < today) {
          throw badRequest("Past availability cannot be edited.");
        }
        return input.date;
      },
      [],
      [input.date],
      async (tx) => {
        const templateIds = input.slots.flatMap((slot) =>
          slot.sourceTemplateId ? [slot.sourceTemplateId] : [],
        );
        const revisionIds = input.slots.flatMap((slot) =>
          slot.sourceTemplateRevisionId ? [slot.sourceTemplateRevisionId] : [],
        );
        const logicalIds = input.slots.flatMap((slot) =>
          slot.sourceLogicalSlotId ? [slot.sourceLogicalSlotId] : [],
        );
        const [templates, revisions, logicalSlots] = await Promise.all([
          tx.availabilityTemplate.findMany({
            where: { userId, id: { in: templateIds } },
            select: { id: true },
          }),
          tx.availabilityTemplateRevision.findMany({
            where: { id: { in: revisionIds }, template: { userId } },
            select: { id: true },
          }),
          tx.availabilityTemplateSlot.findMany({
            where: { id: { in: logicalIds }, template: { userId } },
            select: { id: true },
          }),
        ]);
        if (
          new Set(templates.map(({ id }) => id)).size !== new Set(templateIds).size ||
          new Set(revisions.map(({ id }) => id)).size !== new Set(revisionIds).size ||
          new Set(logicalSlots.map(({ id }) => id)).size !== new Set(logicalIds).size
        ) {
          throw badRequest("Date snapshot provenance must belong to the owner.");
        }
        const existing = await tx.dateAvailabilityOverride.findUnique({
          where: { userId_date: { userId, date: day(input.date) } },
          select: { id: true },
        });
        if (existing) {
          return tx.dateAvailabilityOverride.update({
            where: { id: existing.id },
            data: {
              source: input.source,
              slots: { deleteMany: {}, create: dateSlotData(input.slots) },
            },
            include: { slots: { orderBy: { position: "asc" } } },
          });
        }
        return tx.dateAvailabilityOverride.create({
          data: {
            userId,
            date: day(input.date),
            source: input.source,
            slots: { create: dateSlotData(input.slots) },
          },
          include: { slots: { orderBy: { position: "asc" } } },
        });
      },
    );
  },

  async resetDateOverride(userId: string, date: string, now = new Date()) {
    z.iso.date().parse(date);
    return mutateWithImpact(
      userId,
      async (tx) => {
        const { today } = await userToday(tx, userId, now);
        if (date < today) {
          throw badRequest("Past availability cannot be edited.");
        }
        return date;
      },
      [],
      [date],
      (tx) => tx.dateAvailabilityOverride.deleteMany({ where: { userId, date: day(date) } }),
    );
  },

  async archiveTemplate(userId: string, templateId: string, now = new Date()) {
    return availabilityTransaction(async (tx) => {
      const { today } = await userToday(tx, userId, now);
      const assignments = await tx.weeklyAvailabilityAssignment.findMany({
        where: { userId },
        orderBy: { effectiveDate: "asc" },
      });
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const rows = assignments.filter((assignment) => assignment.weekday === weekday);
        const current = rows
          .filter((assignment) => dateString(assignment.effectiveDate) <= today)
          .at(-1);
        if (current?.templateId === templateId) {
          throw badRequest("Unassign this template from current weekdays before archiving it.");
        }
        if (
          rows.some(
            (assignment) =>
              dateString(assignment.effectiveDate) > today && assignment.templateId === templateId,
          )
        ) {
          throw badRequest("Remove future weekday assignments before archiving this template.");
        }
      }
      const updated = await tx.availabilityTemplate.updateMany({
        where: { id: templateId, userId },
        data: { archivedAt: now },
      });
      if (updated.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found." });
      }
      return { id: templateId, archivedAt: now };
    });
  },

  async restoreTemplate(userId: string, templateId: string) {
    return availabilityTransaction(async (tx) => {
      const updated = await tx.availabilityTemplate.updateMany({
        where: { id: templateId, userId },
        data: { archivedAt: null },
      });
      if (updated.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found." });
      }
      return { id: templateId, archivedAt: null };
    });
  },
};

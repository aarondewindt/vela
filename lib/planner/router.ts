import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { viewConfigSchema } from '@/lib/views/types';
import { planningCategories, taskStatuses } from './tasks';
import { plannerService } from './service';

const id = z.uuid();
const generatorOptions = z.object({
  workSessionMinutes: z.number().int().min(15).max(240).refine((value) => value % 15 === 0),
  shortBreakMinutes: z.number().int().min(5).max(60).refine((value) => value % 5 === 0),
  leisureMinutes: z.number().int().min(0).max(240).refine((value) => value % 15 === 0),
  shortLeisureBlockMinutes: z.number().int().min(15).max(120).refine((value) => value % 15 === 0),
  maxLeisureBlockMinutes: z.number().int().min(15).max(240).refine((value) => value % 15 === 0),
  fillExistingPlan: z.boolean(),
}).refine((options) => options.maxLeisureBlockMinutes >= options.shortLeisureBlockMinutes, {
  path: ['maxLeisureBlockMinutes'],
  message: 'Maximum leisure block must be at least the short block size',
});

export const plannerRouter = router({
  listTasks: protectedProcedure.query(({ ctx }) => plannerService.listTasks(ctx.userId)),
  createTask: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(240),
        brief: z.string().optional(),
        themeId: id.nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => plannerService.createTask(ctx.userId, input)),
  updateTask: protectedProcedure
    .input(
      z.object({
        id,
        patch: z.object({
          title: z.string().trim().min(1).max(240).optional(),
          brief: z.string().nullable().optional(),
          status: z.enum(taskStatuses).optional(),
          priority: z.number().int().min(1).max(5).optional(),
          size: z.number().int().min(0).max(5).optional(),
          dueDate: z.iso.date().nullable().optional(),
          estimatedMinutes: z.number().int().min(0).nullable().optional(),
          leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
          themeId: id.nullable().optional(),
          category: z.enum(planningCategories).nullable().optional(),
          tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
        }),
      })
    )
    .mutation(({ ctx, input }) => plannerService.updateTask(ctx.userId, input.id, input.patch)),
  deleteTask: protectedProcedure
    .input(z.object({ id }))
    .mutation(({ ctx, input }) => plannerService.deleteTask(ctx.userId, input.id)),
  getTaskContent: protectedProcedure
    .input(z.object({ id }))
    .query(({ ctx, input }) => plannerService.getTaskContent(ctx.userId, input.id)),
  updateTaskContent: protectedProcedure
    .input(z.object({ id, content: z.array(z.record(z.string(), z.unknown())).max(5000) }))
    .mutation(({ ctx, input }) =>
      plannerService.updateTaskContent(ctx.userId, input.id, input.content)
    ),

  listThemes: protectedProcedure.query(({ ctx }) => plannerService.listThemes(ctx.userId)),
  createTheme: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(120) }))
    .mutation(({ ctx, input }) => plannerService.createTheme(ctx.userId, input)),
  updateTheme: protectedProcedure
    .input(
      z.object({
        id,
        patch: z.object({
          name: z.string().trim().min(1).max(120).optional(),
          brief: z.string().nullable().optional(),
          color: z.string().max(32).nullable().optional(),
          category: z.enum(planningCategories).optional(),
          isActive: z.boolean().optional(),
        }),
      })
    )
    .mutation(({ ctx, input }) => plannerService.updateTheme(ctx.userId, input.id, input.patch)),
  reorderThemes: protectedProcedure
    .input(z.object({ orderedIds: z.array(id) }))
    .mutation(({ ctx, input }) => plannerService.reorderThemes(ctx.userId, input.orderedIds)),

  getThemeContent: protectedProcedure
    .input(z.object({ id }))
    .query(({ ctx, input }) => plannerService.getThemeContent(ctx.userId, input.id)),
  updateThemeContent: protectedProcedure
    .input(z.object({ id, content: z.array(z.record(z.string(), z.unknown())).max(5000) }))
    .mutation(({ ctx, input }) =>
      plannerService.updateThemeContent(ctx.userId, input.id, input.content)
    ),

  listViews: protectedProcedure
    .input(z.object({ scope: z.string().max(64) }))
    .query(({ ctx, input }) => plannerService.listViews(ctx.userId, input.scope)),
  createView: protectedProcedure
    .input(
      z.object({
        scope: z.string().max(64),
        name: z.string().trim().min(1).max(120),
        config: viewConfigSchema,
      })
    )
    .mutation(({ ctx, input }) => plannerService.createView(ctx.userId, input)),
  updateView: protectedProcedure
    .input(
      z.object({
        id,
        patch: z.object({
          name: z.string().trim().min(1).max(120).optional(),
          config: viewConfigSchema.optional(),
        }),
      })
    )
    .mutation(({ ctx, input }) => plannerService.updateView(ctx.userId, input.id, input.patch)),
  deleteView: protectedProcedure
    .input(z.object({ id }))
    .mutation(({ ctx, input }) => plannerService.deleteView(ctx.userId, input.id)),

  getPlan: protectedProcedure
    .input(z.object({ date: z.iso.date() }))
    .query(({ ctx, input }) => plannerService.getPlan(ctx.userId, input.date)),
  getDayData: protectedProcedure
    .input(z.object({ date: z.iso.date() }))
    .query(({ ctx, input }) => plannerService.getDayData(ctx.userId, input.date)),
  getGeneratorSettings: protectedProcedure.query(({ ctx }) =>
    plannerService.getGeneratorSettings(ctx.userId)
  ),
  saveGeneratorSettings: protectedProcedure
    .input(generatorOptions)
    .mutation(({ ctx, input }) => plannerService.saveGeneratorSettings(ctx.userId, input)),
  applyStandardAvailability: protectedProcedure
    .input(z.object({ date: z.iso.date(), scope: z.enum(['date', 'recurring']) }))
    .mutation(({ ctx, input }) => plannerService.applyStandardAvailability(ctx.userId, input)),
  updateDayAvailability: protectedProcedure
    .input(
      z.object({
        date: z.iso.date(),
        windows: z
          .array(
            z.object({
              startMinute: z
                .number()
                .int()
                .min(0)
                .max(1425)
                .refine((value) => value % 15 === 0),
              endMinute: z
                .number()
                .int()
                .min(15)
                .max(1440)
                .refine((value) => value % 15 === 0),
            })
          )
          .max(96),
      })
    )
    .mutation(({ ctx, input }) => plannerService.updateDayAvailability(ctx.userId, input)),
  createManualBlock: protectedProcedure
    .input(
      z.object({
        date: z.iso.date(),
        taskId: id,
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/),
      })
    )
    .mutation(({ ctx, input }) => plannerService.createManualBlock(ctx.userId, input)),
  createManualCategoryBlock: protectedProcedure
    .input(
      z.object({
        date: z.iso.date(),
        category: z.enum(planningCategories),
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/),
      })
    )
    .mutation(({ ctx, input }) => plannerService.createManualCategoryBlock(ctx.userId, input)),
  removeCategorySlot: protectedProcedure
    .input(z.object({ date: z.iso.date(), slotId: id }))
    .mutation(({ ctx, input }) => plannerService.removeCategorySlot(ctx.userId, input)),
  updateBlockTime: protectedProcedure
    .input(
      z.object({
        date: z.iso.date(),
        blockId: id,
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/),
      })
    )
    .mutation(({ ctx, input }) => plannerService.updateBlockTime(ctx.userId, input)),
  updateBlockOutcome: protectedProcedure
    .input(
      z.object({
        date: z.iso.date(),
        blockId: id,
        outcome: z.enum(['DONE', 'SKIPPED']),
        completeTask: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => plannerService.updateBlockOutcome(ctx.userId, input)),
  removeBlockFromDay: protectedProcedure
    .input(z.object({ date: z.iso.date(), blockId: id }))
    .mutation(({ ctx, input }) => plannerService.removeBlockFromDay(ctx.userId, input)),
  unskipBlock: protectedProcedure
    .input(z.object({ date: z.iso.date(), blockId: id }))
    .mutation(({ ctx, input }) => plannerService.unskipBlock(ctx.userId, input)),
  acceptDraft: protectedProcedure
    .input(z.object({ date: z.iso.date() }))
    .mutation(({ ctx, input }) => plannerService.acceptDraft(ctx.userId, input.date)),
  clearDayPlan: protectedProcedure
    .input(z.object({ date: z.iso.date() }))
    .mutation(({ ctx, input }) => plannerService.clearDayPlan(ctx.userId, input.date)),
  generateDraft: protectedProcedure
    .input(z.object({ date: z.iso.date(), options: generatorOptions.optional() }))
    .mutation(({ ctx, input }) =>
      plannerService.generateDraft(ctx.userId, input.date, input.options)
    ),
});

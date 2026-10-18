import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { settingsService } from './service';
import { modelSettingsService } from '@/lib/model-settings/service';
import { updateModelSettingSchema } from '@/lib/model-settings/schema';
import { AiError } from '@/lib/ai';
import { TRPCError } from '@trpc/server';

async function modelCall<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AiError) {
      throw new TRPCError({
        code: ['MODEL_NOT_FOUND', 'MODEL_NOT_SUPPORTED', 'PROVIDER_NOT_SUPPORTED'].includes(
          error.code
        )
          ? 'BAD_REQUEST'
          : 'INTERNAL_SERVER_ERROR',
        message: error.message,
      });
    }
    throw error;
  }
}

const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid time zone');

export const settingsRouter = router({
  getAiModels: protectedProcedure.query(({ ctx }) => modelSettingsService.get(ctx.userId)),
  listAiModels: protectedProcedure.query(() => modelCall(() => modelSettingsService.models())),
  updateAiModel: protectedProcedure
    .input(updateModelSettingSchema)
    .mutation(({ ctx, input }) => modelCall(() => modelSettingsService.update(ctx.userId, input))),
  getPreferences: protectedProcedure.query(({ ctx }) => settingsService.getPreferences(ctx.userId)),
  updateTimezone: protectedProcedure
    .input(z.object({ timezone: timezoneSchema }))
    .mutation(({ ctx, input }) => settingsService.updateTimezone(ctx.userId, input.timezone)),
});

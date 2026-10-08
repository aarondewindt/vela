import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { settingsService } from './service';

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
  getPreferences: protectedProcedure.query(({ ctx }) => settingsService.getPreferences(ctx.userId)),
  updateTimezone: protectedProcedure
    .input(z.object({ timezone: timezoneSchema }))
    .mutation(({ ctx, input }) => settingsService.updateTimezone(ctx.userId, input.timezone)),
});

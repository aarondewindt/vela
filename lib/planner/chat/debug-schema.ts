import { z } from 'zod';

export const plannerDebugEventSchema = z.object({
  id: z.string().max(80),
  at: z.string().max(40),
  elapsedMs: z.number().nonnegative(),
  kind: z.enum([
    'request',
    'tool-input',
    'tool-output',
    'tool-error',
    'model-step',
    'error',
    'finish',
  ]),
  label: z.string().max(500),
  details: z.string().max(8000),
});
export const plannerDebugSchema = z.object({
  events: z.array(plannerDebugEventSchema).max(40),
  omittedEvents: z.number().int().nonnegative(),
});
export type PlannerDebug = z.infer<typeof plannerDebugSchema>;

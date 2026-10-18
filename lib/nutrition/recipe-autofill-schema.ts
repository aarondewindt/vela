import { z } from 'zod';
import { componentInputSchema } from './schema';

export const recipeAutofillSchema = z.object({
  name: z.string().trim().max(240),
  aliases: z.array(z.string().trim().min(1).max(240)).max(30),
  description: z.string().trim().max(4000).nullable(),
  components: z.array(componentInputSchema).min(1).max(40),
  yieldQuantity: z.string().max(30).nullable(),
  yieldUnit: z.enum(['G', 'ML', 'SERVING']).nullable(),
});
export const recipeAutofillResultSchema = z.object({
  name: z.string().trim().min(1).max(240),
  aliases: z.array(z.string().trim().min(1).max(240)).max(30),
  description: z.string().trim().min(1).max(4000),
});

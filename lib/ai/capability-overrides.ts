import 'server-only';
import { z } from 'zod';
import { AiError } from './errors';
import type { AiModel, AiModelCapability } from './capabilities';

const overridesSchema = z.array(
  z
    .object({
      provider: z.literal('ollama'),
      modelId: z.string().min(1),
      capabilities: z
        .object({
          chat: z.boolean().optional(),
          embedding: z.boolean().optional(),
          vision: z.boolean().optional(),
          thinking: z.boolean().optional(),
        })
        .strict(),
    })
    .strict()
);

/** Server configuration patches discovery, keyed by provider and exact tagged model ID. */
export function applyCapabilityOverrides(model: AiModel): AiModel {
  const raw = process.env.AI_MODEL_CAPABILITY_OVERRIDES;
  if (!raw) {
    return model;
  }
  let overrides: z.infer<typeof overridesSchema>;
  try {
    overrides = overridesSchema.parse(JSON.parse(raw));
    const keys = overrides.map((entry) => JSON.stringify([entry.provider, entry.modelId]));
    if (new Set(keys).size !== keys.length) {
      throw new Error('Duplicate override');
    }
  } catch {
    throw new AiError(
      'CONFIGURATION_ERROR',
      'AI_MODEL_CAPABILITY_OVERRIDES must be a valid array of unique model capability overrides.'
    );
  }
  const override = overrides.find(
    (entry) => entry.provider === model.provider && entry.modelId === model.id
  );
  const capabilities = new Set(model.capabilities);
  for (const [key, enabled] of Object.entries(override?.capabilities ?? {})) {
    const capability = key as AiModelCapability;
    if (enabled === true) {
      capabilities.add(capability);
    }
    if (enabled === false) {
      capabilities.delete(capability);
    }
  }
  return { ...model, capabilities: [...capabilities] };
}

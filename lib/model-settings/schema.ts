import { z } from 'zod';

export const modelSelectionSchema = z
  .object({
    provider: z.literal('ollama'),
    modelId: z.string().trim().min(1).max(200),
  })
  .strict();
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const modelProfiles = [
  'fast',
  'balanced',
  'reasoning',
  'visionLanguage',
  'embeddings',
] as const;
export type ModelProfile = (typeof modelProfiles)[number];
export const profileLabels: Record<ModelProfile, string> = {
  fast: 'Fast',
  balanced: 'Balanced / Medium',
  reasoning: 'Reasoning',
  visionLanguage: 'Vision language',
  embeddings: 'Embeddings',
};
export const modelFeatures = [
  'planner.dayPlan',
  'planner.conversation',
  'planner.planReview',
  'planner.taskReview',
  'nutrition.mealDraft',
  'nutrition.recipeAutofill',
  'aiDev.chat',
  'aiDev.embeddings',
] as const;
export type ModelFeature = (typeof modelFeatures)[number];
export const featureDefinitions = {
  'planner.conversation': {
    label: 'Planner · Conversation',
    profile: 'balanced',
    capability: 'chat',
  },
  'planner.planReview': { label: 'Planner · Plan review', profile: 'balanced', capability: 'chat' },
  'planner.taskReview': { label: 'Planner · Task review', profile: 'balanced', capability: 'chat' },
  'planner.dayPlan': { label: 'Planner · Day planning', profile: 'balanced', capability: 'chat' },
  'nutrition.recipeAutofill': {
    label: 'Nutrition · Recipe autofill',
    profile: 'balanced',
    capability: 'chat',
  },
  'nutrition.mealDraft': {
    label: 'Nutrition · Describe a meal',
    profile: 'balanced',
    capability: 'chat',
  },
  'aiDev.chat': { label: 'AI Dev · Chat', profile: 'balanced', capability: 'chat' },
  'aiDev.embeddings': {
    label: 'AI Dev · Embeddings',
    profile: 'embeddings',
    capability: 'embedding',
  },
} as const;
export const settingKeys = ['default', ...modelProfiles, ...modelFeatures] as const;
export type ModelSettingKey = (typeof settingKeys)[number];
export const modelChoiceSchema = z.union([
  modelSelectionSchema,
  z.object({ profile: z.enum(['default', ...modelProfiles]) }).strict(),
]);
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export type ModelSettings = Partial<Record<ModelSettingKey, ModelChoice>>;

export function compatibleProfiles(feature: ModelFeature) {
  return featureDefinitions[feature].capability === 'embedding'
    ? (['embeddings'] as const)
    : (['default', 'fast', 'balanced', 'reasoning', 'visionLanguage'] as const);
}

export const updateModelSettingSchema = z
  .object({
    key: z.enum(settingKeys),
    value: modelChoiceSchema.nullable(),
  })
  .strict()
  .superRefine(({ key, value }, ctx) => {
    if (!value || !('profile' in value)) {
      return;
    }
    if (
      !modelFeatures.includes(key as ModelFeature) ||
      !(compatibleProfiles(key as ModelFeature) as readonly string[]).includes(value.profile)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a compatible profile for this feature.',
        path: ['value'],
      });
    }
  });

export function resolveModelSetting(
  settings: ModelSettings,
  feature: ModelFeature,
  override?: ModelSelection | null
) {
  if (override) {
    return { selection: override, source: 'Chat override' };
  }
  const choice = settings[feature];
  if (choice && 'modelId' in choice) {
    return { selection: choice, source: `${featureDefinitions[feature].label} override` };
  }
  const profile =
    choice && 'profile' in choice ? choice.profile : featureDefinitions[feature].profile;
  return resolveProfileModel(settings, profile);
}

export function resolveProfileModel(settings: ModelSettings, profile: 'default' | ModelProfile) {
  const value = settings[profile];
  if (value && 'modelId' in value) {
    return {
      selection: value,
      source: profile === 'default' ? 'Default LLM' : `${profileLabels[profile]} default`,
    };
  }
  if (['fast', 'balanced', 'reasoning'].includes(profile)) {
    const fallback = settings.default;
    if (fallback && 'modelId' in fallback) {
      return { selection: fallback, source: 'Default LLM' };
    }
  }
  return { selection: null, source: 'Not configured' };
}

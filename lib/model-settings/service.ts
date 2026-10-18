import 'server-only';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { discoverModels, validateModelSelection } from '@/lib/ai';
import {
  modelFeatures,
  resolveModelSetting,
  settingKeys,
  updateModelSettingSchema,
  type ModelFeature,
  type ModelSelection,
  type ModelSettings,
} from './schema';

type SettingsDb = Pick<Prisma.TransactionClient, 'userAiModelSetting'>;

export async function readModelSettings(
  userId: string,
  db: SettingsDb = prisma
): Promise<ModelSettings> {
  const rows = await db.userAiModelSetting.findMany({
    where: { userId },
    select: { key: true, value: true },
  });
  const settings: ModelSettings = {};
  for (const row of rows) {
    const key = settingKeys.find((key) => key === row.key);
    if (key) {
      settings[key] = updateModelSettingSchema.parse({ key, value: row.value }).value ?? undefined;
    }
  }
  return settings;
}

export async function effectiveModel(
  userId: string,
  feature: ModelFeature,
  override?: ModelSelection | null,
  db: SettingsDb = prisma
) {
  return resolveModelSetting(
    override ? {} : await readModelSettings(userId, db),
    feature,
    override
  );
}

export async function requireModelSelection(
  userId: string,
  feature: ModelFeature,
  override?: ModelSelection | null,
  db: SettingsDb = prisma
) {
  const resolved = await effectiveModel(userId, feature, override, db);
  if (!resolved.selection) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose a model in Settings → AI & models, or select a model here.',
    });
  }
  return resolved.selection;
}

export const modelSettingsService = {
  async get(userId: string) {
    const settings = await readModelSettings(userId);
    return {
      settings,
      resolved: Object.fromEntries(
        modelFeatures.map((feature) => [feature, resolveModelSetting(settings, feature)])
      ) as Record<ModelFeature, ReturnType<typeof resolveModelSetting>>,
    };
  },
  models: () => discoverModels(),
  async update(userId: string, raw: unknown) {
    const { key, value } = updateModelSettingSchema.parse(raw);
    if (value && 'modelId' in value) {
      const capability = key === 'embeddings' || key === 'aiDev.embeddings' ? 'embedding' : 'chat';
      await validateModelSelection(
        value,
        key === 'visionLanguage' ? ['chat', 'vision'] : [capability]
      );
    }
    if (value) {
      await prisma.userAiModelSetting.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, value },
        update: { value },
      });
    } else {
      await prisma.userAiModelSetting.deleteMany({ where: { userId, key } });
    }
    return modelSettingsService.get(userId);
  },
};

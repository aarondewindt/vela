import 'server-only';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { HomeAssistantClient, HomeAssistantError } from './client';
import { decryptToken, encryptToken, homeAssistantUrl } from './security';

export const connectionSchema = z.object({
  baseUrl: z.string().max(500),
  token: z.string().trim().min(1).max(8192).optional(),
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
});
const publicSelect = {
  baseUrl: true,
  enabled: true,
  revision: true,
  status: true,
  lastSyncedAt: true,
} as const;
export async function ownerClient(userId: string) {
  const connection = await prisma.homeAssistantConnection.findUnique({ where: { userId } });
  if (!connection) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Configure your Home Assistant connection first.',
    });
  }
  return {
    connection,
    client: new HomeAssistantClient(
      connection.baseUrl,
      decryptToken(connection.encryptedToken, userId)
    ),
  };
}
export const homeAssistantService = {
  get(userId: string) {
    return prisma.homeAssistantConnection.findUnique({ where: { userId }, select: publicSelect });
  },
  async save(userId: string, input: z.infer<typeof connectionSchema>) {
    const parsed = connectionSchema.parse(input);
    const baseUrl = homeAssistantUrl(parsed.baseUrl);
    return prisma.$transaction(async (db) => {
      const existing = await db.homeAssistantConnection.findUnique({ where: { userId } });
      if ((existing?.revision ?? 0) !== parsed.revision) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Connection changed. Reload before saving.',
        });
      }
      if ((!existing || existing.baseUrl !== baseUrl) && !parsed.token) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Supply a token for this Home Assistant instance.',
        });
      }
      const data = {
        baseUrl,
        enabled: parsed.enabled,
        status: parsed.enabled ? 'Waiting for worker' : 'Disabled',
        ...(parsed.token ? { encryptedToken: encryptToken(parsed.token, userId) } : {}),
      };
      if (!existing) {
        try {
          await db.homeAssistantConnection.create({
            data: { ...data, userId, encryptedToken: data.encryptedToken! },
          });
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') {
            throw error;
          }
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Connection changed. Reload before saving.',
          });
        }
      } else {
        const updated = await db.homeAssistantConnection.updateMany({
          where: { userId, revision: parsed.revision },
          data: { ...data, revision: { increment: 1 } },
        });
        if (!updated.count) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Connection changed. Reload before saving.',
          });
        }
        if (existing.baseUrl !== baseUrl) {
          await db.healthEntityMapping.deleteMany({ where: { userId } });
          await db.homeAssistantConnection.update({
            where: { userId },
            data: { lastSyncedAt: null },
          });
        }
      }
      return db.homeAssistantConnection.findUniqueOrThrow({
        where: { userId },
        select: publicSelect,
      });
    });
  },
  async entities(userId: string) {
    try {
      const { client } = await ownerClient(userId);
      return (await client.states())
        .filter((x) => x.entity_id.startsWith('sensor.'))
        .map((x) => ({
          entityId: x.entity_id,
          name:
            typeof x.attributes.friendly_name === 'string'
              ? x.attributes.friendly_name
              : x.entity_id,
          unit:
            typeof x.attributes.unit_of_measurement === 'string'
              ? x.attributes.unit_of_measurement
              : null,
          state: x.state,
        }));
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message:
          error instanceof HomeAssistantError
            ? error.message
            : 'Could not read Home Assistant sensors. Check configuration and response format.',
      });
    }
  },
};

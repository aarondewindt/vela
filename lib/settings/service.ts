import { prisma } from '@/lib/prisma';

export const settingsService = {
  getPreferences(userId: string) {
    return prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
  },

  updateTimezone(userId: string, timezone: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { timezone },
      select: { timezone: true },
    });
  },
};

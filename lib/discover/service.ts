import 'server-only';
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import {
  itemInputSchema,
  listItemsSchema,
  statusSchema,
  type ItemInput,
  type ListItemsInput,
} from './schema';

const itemSelect = {
  id: true,
  title: true,
  contentType: true,
  status: true,
  description: true,
  url: true,
  imageUrl: true,
  tags: true,
  priority: true,
  notes: true,
  rating: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DiscoverItemSelect;
export type DiscoverItem = Prisma.DiscoverItemGetPayload<{ select: typeof itemSelect }>;

function urlKey(value: string | null) {
  if (!value) {
    return null;
  }
  const url = new URL(value);
  // Fragments identify a position inside the same resource. Keep the original URL on the item.
  url.hash = '';
  return createHash('sha256').update(url.href).digest('hex');
}
function writeError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This URL is already in your Discover collection.',
      });
    }
  }
  throw error;
}
async function requireChanged(userId: string, id: string): Promise<never> {
  const owned = await prisma.discoverItem.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Discover item not found.' });
  }
  throw new TRPCError({
    code: 'CONFLICT',
    message:
      'This item changed. Refresh the collection and reopen its details before trying again.',
  });
}

export const discoverService = {
  async list(userId: string, rawInput: ListItemsInput) {
    const input = listItemsSchema.parse(rawInput);
    const query = input.query;
    const contains = { contains: query, mode: 'insensitive' as const };
    const where: Prisma.DiscoverItemWhereInput = {
      userId,
      ...(input.contentType
        ? { contentType: { equals: input.contentType, mode: 'insensitive' } }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.tag ? { tags: { has: input.tag } } : {}),
      ...(query
        ? {
            OR: [
              { title: contains },
              { description: contains },
              { notes: contains },
              { url: contains },
              { tags: { has: query.toLowerCase() } },
            ],
          }
        : {}),
    };
    const sorts: Record<ListItemsInput['sort'], Prisma.DiscoverItemOrderByWithRelationInput> = {
      newest: { createdAt: 'desc' },
      oldest: { createdAt: 'asc' },
      title: { title: 'asc' },
      priority: { priority: { sort: 'desc', nulls: 'last' } },
      rating: { rating: { sort: 'desc', nulls: 'last' } },
      updated: { updatedAt: 'desc' },
    };
    const [items, total] = await prisma.$transaction(
      [
        prisma.discoverItem.findMany({
          where,
          select: itemSelect,
          orderBy: [sorts[input.sort], { id: 'asc' }],
          take: input.limit,
          skip: input.offset,
        }),
        prisma.discoverItem.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
    return { items, total };
  },
  async types(userId: string) {
    const rows = await prisma.discoverItem.findMany({
      where: { userId },
      select: { contentType: true },
      distinct: ['contentType'],
      orderBy: { contentType: 'asc' },
    });
    return rows.map((row) => row.contentType);
  },
  async get(userId: string, id: string) {
    const item = await prisma.discoverItem.findFirst({ where: { id, userId }, select: itemSelect });
    if (!item) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Discover item not found.' });
    }
    return item;
  },
  async create(userId: string, rawInput: ItemInput) {
    const input = itemInputSchema.parse(rawInput);
    try {
      return await prisma.discoverItem.create({
        data: { ...input, userId, urlKey: urlKey(input.url) },
        select: itemSelect,
      });
    } catch (error) {
      return writeError(error);
    }
  },
  async update(userId: string, id: string, version: number, rawInput: ItemInput) {
    const input = itemInputSchema.parse(rawInput);
    try {
      const rows = await prisma.discoverItem.updateManyAndReturn({
        where: { id, userId, version },
        data: { ...input, urlKey: urlKey(input.url), version: { increment: 1 } },
        select: itemSelect,
      });
      return rows[0] ?? (await requireChanged(userId, id));
    } catch (error) {
      return writeError(error);
    }
  },
  async setStatus(userId: string, id: string, version: number, rawStatus: DiscoverItem['status']) {
    const status = statusSchema.parse(rawStatus);
    const rows = await prisma.discoverItem.updateManyAndReturn({
      where: { id, userId, version },
      data: { status, version: { increment: 1 } },
      select: itemSelect,
    });
    return rows[0] ?? (await requireChanged(userId, id));
  },
  async remove(userId: string, id: string, version: number) {
    const deleted = await prisma.discoverItem.deleteMany({ where: { id, userId, version } });
    if (!deleted.count) {
      return requireChanged(userId, id);
    }
    return { deleted: true };
  },
};

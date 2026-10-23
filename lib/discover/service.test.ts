/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('./metadata-fetch', () => ({ fetchPageMetadata: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    discoverItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateManyAndReturn: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { discoverService } from './service';
import { itemInputSchema, listItemsSchema, statusLabels } from './schema';
import { itemFixture } from './test-fixtures';
import { fetchPageMetadata } from './metadata-fetch';

const id = itemFixture.id;
const input = itemInputSchema.parse({ title: 'Dune', contentType: 'Book' });
const db = prisma.discoverItem as unknown as Record<string, jest.Mock>;
beforeEach(() => {
  jest.resetAllMocks();
  db.findFirst.mockResolvedValue(itemFixture);
  db.findMany.mockResolvedValue([itemFixture]);
  db.count.mockResolvedValue(1);
  db.create.mockResolvedValue(itemFixture);
  db.updateManyAndReturn.mockResolvedValue([{ ...itemFixture, version: 2 }]);
  db.deleteMany.mockResolvedValue({ count: 1 });
  (prisma.$transaction as jest.Mock).mockImplementation((promises) => Promise.all(promises));
});
it('creates and edits all manual details, without allowing owner or internal fields from input', async () => {
  await discoverService.create('alice', {
    ...input,
    userId: 'bob',
    urlKey: 'forged',
    version: 100,
  } as never);
  expect(db.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: { ...input, userId: 'alice', urlKey: null } })
  );
  const edited = {
    ...input,
    description: 'A book',
    tags: ['space'],
    rating: 8,
    notes: 'Read next',
    priority: 3,
    url: 'https://example.com/book',
    imageUrl: 'https://example.com/cover.jpg',
  };
  await expect(discoverService.update('alice', id, 1, edited)).resolves.toMatchObject({
    version: 2,
  });
  expect(db.updateManyAndReturn).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id, userId: 'alice', version: 1 },
      data: {
        ...edited,
        urlKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        version: { increment: 1 },
      },
    })
  );
});
it('uses canonical host, default port and fragment normalization for duplicate keys while preserving the URL', async () => {
  const urls = ['https://EXAMPLE.com:443/book#first', 'https://example.com/book#second'];
  for (const url of urls) {
    await discoverService.create('alice', { ...input, url });
  }
  const first = db.create.mock.calls[0][0].data;
  const second = db.create.mock.calls[1][0].data;
  expect(first.url).toBe(urls[0]);
  expect(second.url).toBe(urls[1]);
  expect(first.urlKey).toBe(second.urlKey);
  for (const url of ['https://example.com/Book', 'https://example.com/book?edition=2']) {
    await discoverService.create('alice', { ...input, url });
    expect(db.create.mock.calls.at(-1)![0].data.urlKey).not.toBe(first.urlKey);
  }
});
it('reports database unique conflicts for creates and edits, including concurrent duplicate writes', async () => {
  const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '7.9.1',
  });
  db.create.mockRejectedValue(error);
  db.updateManyAndReturn.mockRejectedValue(error);
  await expect(discoverService.create('alice', input)).rejects.toMatchObject({
    code: 'CONFLICT',
    message: expect.stringContaining('already in your Discover'),
  });
  await expect(discoverService.update('alice', id, 1, input)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
});
it('allows independent title-only items and does not swallow unexpected persistence failures', async () => {
  await discoverService.create('alice', input);
  await discoverService.create('alice', input);
  expect(db.create.mock.calls.every(([args]) => args.data.urlKey === null)).toBe(true);
  const failure = new Error('Database unavailable');
  db.create.mockRejectedValue(failure);
  await expect(discoverService.create('alice', input)).rejects.toBe(failure);
});
it('gets and deletes items only through the authenticated owner scope', async () => {
  await discoverService.get('alice', id);
  expect(db.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id, userId: 'alice' } })
  );
  await expect(discoverService.remove('alice', id, 1)).resolves.toEqual({ deleted: true });
  expect(db.deleteMany).toHaveBeenCalledWith({ where: { id, userId: 'alice', version: 1 } });
});
it('returns NOT_FOUND for foreign or missing records on every read and write', async () => {
  db.findFirst.mockResolvedValue(null);
  db.updateManyAndReturn.mockResolvedValue([]);
  db.deleteMany.mockResolvedValue({ count: 0 });
  for (const call of [
    () => discoverService.get('bob', id),
    () => discoverService.update('bob', id, 1, input),
    () => discoverService.setStatus('bob', id, 1, 'COMPLETED'),
    () => discoverService.remove('bob', id, 1),
  ]) {
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }
  for (const [args] of [
    ...db.findFirst.mock.calls,
    ...db.updateManyAndReturn.mock.calls,
    ...db.deleteMany.mock.calls,
  ]) {
    expect(args.where.userId).toBe('bob');
  }
});
it('prevents stale edits, status changes and deletes from overwriting another tab', async () => {
  db.updateManyAndReturn.mockResolvedValue([]);
  db.deleteMany.mockResolvedValue({ count: 0 });
  for (const call of [
    () => discoverService.update('alice', id, 1, input),
    () => discoverService.setStatus('alice', id, 1, 'COMPLETED'),
    () => discoverService.remove('alice', id, 1),
  ]) {
    await expect(call()).rejects.toMatchObject({ code: 'CONFLICT' });
  }
});
it('supports every status transition independently from content type', async () => {
  for (const status of Object.keys(statusLabels) as (keyof typeof statusLabels)[]) {
    await discoverService.setStatus('alice', id, 1, status);
    expect(db.updateManyAndReturn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id, userId: 'alice', version: 1 },
        data: { status, version: { increment: 1 } },
      })
    );
  }
});
it('combines owner, search, type, status, exact tag and priority filters before pagination', async () => {
  const result = await discoverService.list(
    'alice',
    listItemsSchema.parse({
      query: 'SPACE',
      contentType: 'Book',
      status: 'IN_PROGRESS',
      tag: ' Sci-Fi ',
      priority: 3,
      limit: 12,
      offset: 24,
    })
  );
  expect(result).toEqual({ items: [itemFixture], total: 1 });
  const args = db.findMany.mock.calls[0][0];
  expect(args).toMatchObject({
    take: 12,
    skip: 24,
    where: {
      userId: 'alice',
      contentType: { equals: 'Book', mode: 'insensitive' },
      status: 'IN_PROGRESS',
      tags: { has: 'sci-fi' },
      priority: 3,
      OR: expect.arrayContaining([
        { title: { contains: 'SPACE', mode: 'insensitive' } },
        { description: { contains: 'SPACE', mode: 'insensitive' } },
        { notes: { contains: 'SPACE', mode: 'insensitive' } },
        { url: { contains: 'SPACE', mode: 'insensitive' } },
        { tags: { has: 'space' } },
      ]),
    },
  });
  expect(db.count).toHaveBeenCalledWith({ where: args.where });
  expect(args.select).not.toHaveProperty('userId');
  expect(args.select).not.toHaveProperty('urlKey');
});
it.each([
  ['newest', { createdAt: 'desc' }],
  ['oldest', { createdAt: 'asc' }],
  ['title', { title: 'asc' }],
  ['priority', { priority: { sort: 'desc', nulls: 'last' } }],
  ['rating', { rating: { sort: 'desc', nulls: 'last' } }],
  ['updated', { updatedAt: 'desc' }],
])('sorts %s with a stable tiebreaker and nulls last where relevant', async (sort, expected) => {
  await discoverService.list('alice', listItemsSchema.parse({ sort }));
  expect(db.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'alice' }, orderBy: [expected, { id: 'asc' }] })
  );
});
it('scopes custom type suggestions to the owner', async () => {
  db.findMany.mockResolvedValue([{ contentType: 'Museum' }]);
  await expect(discoverService.types('alice')).resolves.toEqual(['Museum']);
  expect(db.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'alice' }, distinct: ['contentType'] })
  );
});

const metadata = {
  provider: 'web',
  sourceUrl: 'https://example.com',
  resolvedUrl: 'https://example.com/',
  siteName: null,
  retrievedAt: '2026-10-22T12:00:00.000Z',
  title: 'Fetched',
  description: null,
  imageUrl: null,
};
it('retrieves only owned saved URLs and stores provenance without changing manual fields', async () => {
  db.findFirst.mockResolvedValue({ ...itemFixture, url: metadata.sourceUrl });
  (fetchPageMetadata as jest.Mock).mockResolvedValue(metadata);
  await discoverService.refreshMetadata('alice', id, 1);
  expect(db.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id, userId: 'alice' } })
  );
  expect(fetchPageMetadata).toHaveBeenCalledWith(metadata.sourceUrl);
  expect(db.updateManyAndReturn).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id, userId: 'alice', version: 1, url: metadata.sourceUrl },
      data: { sourceMetadata: metadata, version: { increment: 1 } },
    })
  );
});
it('does no network work for another owner, missing URL or stale version', async () => {
  db.findFirst.mockResolvedValueOnce(null);
  await expect(discoverService.refreshMetadata('bob', id, 1)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(discoverService.refreshMetadata('alice', id, 1)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  db.findFirst.mockResolvedValue({ ...itemFixture, version: 2, url: metadata.sourceUrl });
  await expect(discoverService.refreshMetadata('alice', id, 1)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(fetchPageMetadata).not.toHaveBeenCalled();
  expect(db.updateManyAndReturn).not.toHaveBeenCalled();
});
it('rejects concurrent edits/deletes after retrieval and preserves the previous snapshot on failure', async () => {
  db.findFirst.mockResolvedValue({ ...itemFixture, url: metadata.sourceUrl });
  (fetchPageMetadata as jest.Mock).mockResolvedValue(metadata);
  db.updateManyAndReturn.mockResolvedValue([]);
  await expect(discoverService.refreshMetadata('alice', id, 1)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  db.findFirst
    .mockResolvedValueOnce({ ...itemFixture, url: metadata.sourceUrl })
    .mockResolvedValueOnce(null);
  await expect(discoverService.refreshMetadata('alice', id, 1)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  db.updateManyAndReturn.mockClear();
  (fetchPageMetadata as jest.Mock).mockRejectedValue(new Error('unreachable'));
  db.findFirst.mockResolvedValue({ ...itemFixture, url: metadata.sourceUrl });
  await expect(discoverService.refreshMetadata('alice', id, 1)).rejects.toThrow('unreachable');
  expect(db.updateManyAndReturn).not.toHaveBeenCalled();
});
it('keeps provenance server owned and leaves URL duplicate handling unchanged when applying selected fields', async () => {
  await discoverService.update('alice', id, 1, {
    ...input,
    title: 'Fetched',
    sourceMetadata: metadata,
  } as never);
  expect(db.updateManyAndReturn.mock.calls[0][0].data).not.toHaveProperty('sourceMetadata');
});

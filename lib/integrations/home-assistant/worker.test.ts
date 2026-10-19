/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    homeAssistantConnection: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    $executeRaw: jest.fn(),
  },
}));
jest.mock('@/lib/health/import', () => ({ importHealthStates: jest.fn() }));
jest.mock('./security', () => ({ decryptToken: () => 'private' }));
jest.mock('./client', () => {
  class HomeAssistantError extends Error {}
  return { HomeAssistantError, HomeAssistantClient: jest.fn() };
});
import { prisma } from '@/lib/prisma';
import { HomeAssistantClient, HomeAssistantError } from './client';
import { importHealthStates } from '@/lib/health/import';
import { syncHomeAssistant } from './worker';
const states = jest.fn();
const history = jest.fn();
const listen = jest.fn();
const lastSyncedAt = new Date('2026-01-01T12:00:00Z');
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (prisma.homeAssistantConnection.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.homeAssistantConnection.findUniqueOrThrow as jest.Mock).mockResolvedValue({
    userId: 'alice',
    baseUrl: 'https://ha.example.com',
    encryptedToken: 'encrypted',
    enabled: true,
    revision: 4,
    lastSyncedAt,
    user: { timezone: 'UTC' },
    mappings: [{ metric: 'WEIGHT', entityId: 'sensor.weight' }],
  });
  (HomeAssistantClient as jest.Mock).mockImplementation(() => ({ states, history, listen }));
  states.mockResolvedValue([
    {
      entity_id: 'sensor.weight',
      state: '80',
      attributes: { unit_of_measurement: 'kg' },
      last_changed: '2026-01-01T12:00:00Z',
      last_updated: '2026-01-01T12:00:00Z',
    },
  ]);
  history.mockResolvedValue([]);
  listen.mockImplementation(
    (_ids, _receive, signal) =>
      new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
  );
});
afterEach(() => jest.useRealTimers());
it('does not open a connection when another worker holds the lease', async () => {
  (prisma.homeAssistantConnection.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  expect(await syncHomeAssistant('alice', new AbortController().signal)).toEqual({
    claimed: false,
    succeeded: true,
  });
  expect(HomeAssistantClient).not.toHaveBeenCalled();
});
it('keeps failed history recovery visible and preserves the durable recovery cursor', async () => {
  const stop = new AbortController();
  history.mockRejectedValue(new HomeAssistantError('History unavailable'));
  (prisma.homeAssistantConnection.updateMany as jest.Mock).mockImplementation(async ({ data }) => {
    if (data.status === 'Live sync active; history recovery unavailable') {
      stop.abort();
    }
    return { count: 1 };
  });
  const result = await syncHomeAssistant('alice', stop.signal);
  expect(result.succeeded).toBe(true);
  expect(importHealthStates).toHaveBeenCalled();
  expect(prisma.homeAssistantConnection.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        lastSyncedAt,
        status: 'Live sync active; history recovery unavailable',
      }),
    })
  );
  expect(prisma.$executeRaw).toHaveBeenCalled();
});
it('stops after losing the connection revision and fences late status writes', async () => {
  (prisma.homeAssistantConnection.updateMany as jest.Mock).mockImplementation(async ({ data }) => ({
    count: data.status ? 1 : 0,
  }));
  const operation = syncHomeAssistant('alice', new AbortController().signal);
  await jest.advanceTimersByTimeAsync(15000);
  expect((await operation).succeeded).toBe(false);
  expect(prisma.homeAssistantConnection.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ userId: 'alice', revision: 4, leaseId: expect.any(String) }),
    })
  );
});

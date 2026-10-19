/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
import { prisma } from '@/lib/prisma';
import { importHealthStates } from './import';
const db = {
  homeAssistantConnection: { updateMany: jest.fn() },
  healthMetric: { findUnique: jest.fn(), upsert: jest.fn() },
};
const context = {
  userId: 'alice',
  revision: 4,
  leaseId: 'lease',
  sourceNamespace: 'instance1',
  timezone: 'UTC',
  mappings: [{ metric: 'TOTAL_CALORIES' as const, entityId: 'sensor.burn' }],
};
const state = {
  entity_id: 'sensor.burn',
  state: '2500',
  attributes: { unit_of_measurement: 'kcal' },
  last_changed: '2026-01-10T23:30:00Z',
  last_updated: '2026-01-10T23:30:00Z',
};
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((operation) => operation(db));
  db.homeAssistantConnection.updateMany.mockResolvedValue({ count: 1 });
  db.healthMetric.findUnique.mockResolvedValue(null);
});
it('requires matching owner, connection revision and a live lease before writing', async () => {
  db.homeAssistantConnection.updateMany.mockResolvedValue({ count: 0 });
  await expect(importHealthStates(context, [state])).rejects.toThrow('lease');
  expect(db.homeAssistantConnection.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        userId: 'alice',
        revision: 4,
        leaseId: 'lease',
        enabled: true,
        leaseExpiresAt: expect.any(Object),
      }),
    })
  );
  expect(db.healthMetric.upsert).not.toHaveBeenCalled();
});
it('ignores unmapped and unavailable sensors; daily total updates use an instance-scoped key', async () => {
  await importHealthStates(context, [
    state,
    { ...state, entity_id: 'sensor.bob' },
    { ...state, state: 'unavailable' },
  ]);
  expect(db.healthMetric.upsert).toHaveBeenCalledTimes(1);
  expect(db.healthMetric.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId_sourceKey: {
          userId: 'alice',
          sourceKey: 'ha:instance1:sensor.burn:TOTAL_CALORIES:2026-01-10',
        },
      },
      create: expect.objectContaining({ userId: 'alice', value: '2500.000000' }),
    })
  );
});
it('does not let replayed history overwrite a newer daily total', async () => {
  db.healthMetric.findUnique.mockResolvedValue({ observedAt: new Date('2026-01-10T23:59:00Z') });
  await importHealthStates(context, [state]);
  expect(db.healthMetric.upsert).not.toHaveBeenCalled();
});

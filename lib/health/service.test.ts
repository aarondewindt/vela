/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    healthGoal: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    healthMetric: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    healthEntityMapping: { findMany: jest.fn() },
  },
}));
jest.mock('@/lib/nutrition/history', () => ({ nutritionHistory: { get: jest.fn() } }));
jest.mock('@/lib/integrations/home-assistant/service', () => ({ ownerClient: jest.fn() }));
jest.mock('@/lib/settings/service', () => ({ settingsService: { getPreferences: jest.fn() } }));
import { ownerClient } from '@/lib/integrations/home-assistant/service';
import { settingsService } from '@/lib/settings/service';
import { prisma } from '@/lib/prisma';
import { nutritionHistory } from '@/lib/nutrition/history';
import { healthService } from './service';
beforeEach(() => jest.clearAllMocks());
it('combines owner nutrition snapshots and burn totals without filling missing days', async () => {
  (nutritionHistory.get as jest.Mock).mockResolvedValue({
    startDate: '2026-01-01',
    days: [
      { date: '2026-01-01', nutrients: { calories: '2100' } },
      { date: '2026-01-02', nutrients: null },
    ],
  });
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([
    {
      id: 'burn',
      metric: 'TOTAL_CALORIES',
      date: new Date('2026-01-01'),
      observedAt: new Date('2026-01-01T23:00:00Z'),
      value: '2500',
      source: 'home_assistant',
      timestampBasis: 'sensor_state',
    },
  ]);
  (prisma.healthGoal.findUnique as jest.Mock).mockResolvedValue({
    calorieBalance: -300,
    version: 1,
  });
  const result = await healthService.history('alice', { endDate: '2026-01-07', days: 7 });
  expect(nutritionHistory.get).toHaveBeenCalledWith('alice', { endDate: '2026-01-07', days: 7 });
  expect((prisma.$queryRaw as jest.Mock).mock.calls[0][0].values).toContain('alice');
  expect(prisma.healthGoal.findUnique).toHaveBeenCalledWith({ where: { userId: 'alice' } });
  expect(result.days[0]).toMatchObject({
    intake: 2100,
    burned: 2500,
    balance: -400,
    differenceFromGoal: -100,
  });
  expect(result.days[1]).toMatchObject({ intake: null, burned: null, balance: null });
});
it('fences goal changes and does not overwrite another version', async () => {
  (prisma.healthGoal.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  await expect(
    healthService.saveGoal('alice', { version: 1, calorieBalance: 0 })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(prisma.healthGoal.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'alice', version: 1 } })
  );
  (prisma.healthGoal.create as jest.Mock).mockRejectedValue({ code: 'P2002' });
  await expect(
    healthService.saveGoal('alice', { version: 0, calorieBalance: -300 })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('restricts manual deletion and mapping reads to their owner', async () => {
  (prisma.healthMetric.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
  await expect(healthService.remove('alice', 'bobs-id')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(prisma.healthMetric.deleteMany).toHaveBeenCalledWith({
    where: { userId: 'alice', id: 'bobs-id', source: 'manual' },
  });
  await healthService.mappings('alice');
  expect(prisma.healthEntityMapping.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'alice', metric: { in: ['WEIGHT', 'BODY_FAT', 'LEAN_MASS'] } },
    })
  );
});
it('rejects reuse of a manual request ID for different data', async () => {
  (prisma.healthMetric.findUnique as jest.Mock).mockResolvedValue({
    metric: 'WEIGHT',
    date: new Date('2026-01-01'),
    value: '80',
  });
  const input = {
    requestId: '7b5d973b-a82f-441a-a086-fd69ca6e891e',
    metric: 'WEIGHT' as const,
    date: '2026-01-01',
    value: 80,
  };
  await expect(healthService.log('alice', input)).resolves.toEqual({ saved: true });
  await expect(healthService.log('alice', { ...input, value: 81 })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(prisma.healthMetric.upsert).not.toHaveBeenCalled();
});

it('diagnoses only the owner’s saved mappings and returns selected sensor fields', async () => {
  (settingsService.getPreferences as jest.Mock).mockResolvedValue({ timezone: 'Europe/Amsterdam' });
  (prisma.healthEntityMapping.findMany as jest.Mock).mockResolvedValue([
    { metric: 'WEIGHT', entityId: 'sensor.weight' },
    { metric: 'BODY_FAT', entityId: 'sensor.fat' },
    { metric: 'LEAN_MASS', entityId: 'sensor.missing' },
  ]);
  (ownerClient as jest.Mock).mockResolvedValue({
    client: {
      states: async () => [
        {
          entity_id: 'sensor.weight',
          state: '80000',
          attributes: { unit_of_measurement: 'g', private_attribute: 'not-returned' },
          last_changed: '2026-01-10T23:30:00Z',
          last_updated: '2026-01-10T23:45:00Z',
        },
        {
          entity_id: 'sensor.fat',
          state: '480',
          attributes: { unit_of_measurement: 'unsupported' },
          last_changed: '2026-01-10T23:30:00Z',
          last_updated: '2026-01-10T23:45:00Z',
        },
        { entity_id: 'sensor.unmapped', state: 'private-unmapped-reading' },
      ],
    },
  });
  const result = await healthService.diagnostics('alice');
  expect(ownerClient).toHaveBeenCalledWith('alice');
  expect(settingsService.getPreferences).toHaveBeenCalledWith('alice');
  expect(prisma.healthEntityMapping.findMany).toHaveBeenCalledWith({
    where: { userId: 'alice', metric: { in: ['WEIGHT', 'BODY_FAT', 'LEAN_MASS'] } },
    select: { metric: true, entityId: true },
  });
  expect(result.sensors).toHaveLength(3);
  expect(result.sensors[0]).toMatchObject({
    state: '80000',
    unit: 'g',
    issue: null,
    normalized: { value: '80.000000', date: '2026-01-11' },
  });
  expect(result.sensors[1].issue).toContain('Unsupported unit');
  expect(result.sensors[2]).toMatchObject({ state: null, normalized: null });
  expect(result.sensors[2].issue).toContain('Entity not found');
  expect(JSON.stringify(result)).not.toContain('not-returned');
  expect(JSON.stringify(result)).not.toContain('private-unmapped-reading');
});
it('sanitizes diagnostic failures instead of exposing credentials or remote bodies', async () => {
  (ownerClient as jest.Mock).mockRejectedValue(new Error('private token in upstream error'));
  await expect(healthService.diagnostics('alice')).rejects.toMatchObject({
    code: 'BAD_GATEWAY',
    message:
      'Could not inspect mapped sensors. Check the connection configuration and Home Assistant response format.',
  });
});

it('carries only body composition from before the window, retaining provenance and replacing it on measurement dates', async () => {
  (nutritionHistory.get as jest.Mock).mockResolvedValue({
    startDate: '2026-01-01',
    days: ['2026-01-01', '2026-01-02', '2026-01-03'].map((date) => ({ date, nutrients: null })),
  });
  const record = (id: string, metric: string, date: string, value: string) => ({
    id,
    metric,
    date: new Date(date),
    value,
    observedAt: new Date(`${date}T23:00:00Z`),
    source: 'home_assistant',
    timestampBasis: 'sensor_state',
  });
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([
    record('old', 'WEIGHT', '2025-12-01', '80'),
    record('fat', 'BODY_FAT', '2025-12-30', '20'),
    record('new', 'WEIGHT', '2026-01-02', '79'),
    record('sleep', 'SLEEP', '2026-01-01', '8'),
    record('burn', 'TOTAL_CALORIES', '2026-01-01', '2500'),
    record('future', 'LEAN_MASS', '2026-01-03', '60'),
  ]);
  const { days } = await healthService.history('alice', { endDate: '2026-01-03', days: 7 });
  expect(days[0].metrics.WEIGHT).toMatchObject({
    id: 'old',
    value: 80,
    measurementDate: '2025-12-01',
    carriedForward: true,
    observedAt: new Date('2025-12-01T23:00:00Z'),
    source: 'home_assistant',
    timestampBasis: 'sensor_state',
  });
  expect(days[1].metrics.WEIGHT).toMatchObject({ id: 'new', value: 79, carriedForward: false });
  expect(days[2].metrics.WEIGHT).toMatchObject({ id: 'new', value: 79, carriedForward: true });
  expect(days[1].metrics.BODY_FAT).toMatchObject({ id: 'fat', carriedForward: true });
  expect(days[0].metrics.LEAN_MASS).toBeNull();
  expect(days[1].metrics.SLEEP).toBeNull();
  expect(days[1].metrics.TOTAL_CALORIES).toBeNull();
  expect(days[1].balance).toBeNull();
});

it('evaluates signed balance ranges without treating missing data as zero', async () => {
  (nutritionHistory.get as jest.Mock).mockResolvedValue({
    startDate: '2026-01-01',
    days: [
      { date: '2026-01-01', nutrients: { calories: '2100' } },
      { date: '2026-01-02', nutrients: null },
    ],
  });
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([
    {
      id: 'burn',
      metric: 'TOTAL_CALORIES',
      date: new Date('2026-01-01'),
      observedAt: new Date('2026-01-01T23:00:00Z'),
      value: '2500',
      source: 'home_assistant',
      timestampBasis: 'sensor_state',
    },
  ]);
  (prisma.healthGoal.findUnique as jest.Mock).mockResolvedValue({
    calorieBalance: -400,
    version: 1,
    semantics: { kind: 'range', upperBound: '-200' },
  });
  const result = await healthService.history('alice', { endDate: '2026-01-07', days: 7 });
  expect(result.days[0].goalEvaluation).toMatchObject({ status: 'within', satisfied: true });
  expect(result.days[1].goalEvaluation).toMatchObject({ status: 'unknown', satisfied: null });
  (prisma.healthGoal.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  await healthService.saveGoal('alice', { version: 1, calorieBalance: -400 });
  expect(prisma.healthGoal.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ semantics: { kind: 'range', upperBound: '-200' } }),
    })
  );
});

it('loads only the owner goal for Settings and preserves saved goal semantics', async () => {
  (prisma.healthGoal.findUnique as jest.Mock).mockResolvedValue(null);
  await expect(healthService.getGoal('alice')).resolves.toEqual({
    version: 0,
    calorieBalance: null,
    semantics: { kind: 'target' },
    metricGoals: {},
  });
  expect(prisma.healthGoal.findUnique).toHaveBeenCalledWith({ where: { userId: 'alice' } });
  (prisma.healthGoal.findUnique as jest.Mock).mockResolvedValue({
    version: 4,
    calorieBalance: -400,
    semantics: { kind: 'range', upperBound: '-200' },
  });
  await expect(healthService.getGoal('alice')).resolves.toEqual({
    version: 4,
    calorieBalance: -400,
    semantics: { kind: 'range', upperBound: '-200' },
    metricGoals: {},
  });
});

it('saves owner metric goals with version fencing and preserves them for older callers', async () => {
  const metricGoals = {
    WEIGHT: { target: 80, semantics: { kind: 'target' as const } },
    SLEEP: { target: 8, semantics: { kind: 'minimum' as const } },
  };
  (prisma.healthGoal.findUnique as jest.Mock).mockResolvedValue({ metricGoals });
  (prisma.healthGoal.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  await healthService.saveGoal('alice', { version: 3, calorieBalance: null, metricGoals });
  expect(prisma.healthGoal.updateMany).toHaveBeenLastCalledWith({
    where: { userId: 'alice', version: 3 },
    data: expect.objectContaining({ metricGoals, version: { increment: 1 } }),
  });
  expect((await healthService.getGoal('alice')).metricGoals).toEqual(metricGoals);
  await healthService.saveGoal('alice', { version: 3, calorieBalance: -300 });
  expect((prisma.healthGoal.updateMany as jest.Mock).mock.calls.at(-1)[0].data).not.toHaveProperty(
    'metricGoals'
  );
  await healthService.saveGoal('alice', { version: 3, calorieBalance: -300, metricGoals: {} });
  expect((prisma.healthGoal.updateMany as jest.Mock).mock.calls.at(-1)[0].data.metricGoals).toEqual(
    {}
  );
});

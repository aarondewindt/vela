/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock('@/lib/nutrition/history', () => ({ readNutritionHistoryRecords: jest.fn() }));
jest.mock('@/lib/settings/service', () => ({ settingsService: { getPreferences: jest.fn() } }));
jest.mock('./persistence', () => ({ readHealthMetrics: jest.fn() }));
import { prisma } from '@/lib/prisma';
import { readNutritionHistoryRecords } from '@/lib/nutrition/history';
import { settingsService } from '@/lib/settings/service';
import { readHealthMetrics } from './persistence';
import { healthChartHistory } from './history';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-10-25T00:30:00Z'));
  (settingsService.getPreferences as jest.Mock).mockResolvedValue({ timezone: 'Europe/Amsterdam' });
  (readHealthMetrics as jest.Mock).mockResolvedValue([]);
  (readNutritionHistoryRecords as jest.Mock).mockResolvedValue([]);
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ date: null }]);
});
afterEach(() => jest.useRealTimers());

it('bounds an empty all-time range and clamps future end dates using owner timezone', async () => {
  const result = await healthChartHistory('alice', { endDate: '2026-12-31', range: 'all' });
  expect(result).toMatchObject({
    startDate: '2026-10-25',
    endDate: '2026-10-25',
    aggregation: 'daily',
  });
  expect(result.points).toHaveLength(1);
  expect(result.points[0]).toMatchObject({ total: null, balance: null, provisional: true });
  expect(readHealthMetrics).toHaveBeenCalledWith('alice', '2026-10-25', '2026-10-25');
  const query = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
  expect(query.values.filter((value: unknown) => value === 'alice')).toHaveLength(2);
});

it('uses the earliest health or diary date for all time, skips carried observations and bounds output', async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ date: new Date('2000-01-01') }]);
  (readHealthMetrics as jest.Mock).mockResolvedValue([
    { date: new Date('1999-12-31'), metric: 'WEIGHT', value: '80', source: 'manual' },
    { date: new Date('2000-01-01'), metric: 'TOTAL_CALORIES', value: '2400', source: 'manual' },
  ]);
  (readNutritionHistoryRecords as jest.Mock).mockResolvedValue([
    { logDate: new Date('2000-01-01'), _sum: { calories: '2000' } },
  ]);
  const result = await healthChartHistory('alice', { endDate: '2026-10-25', range: 'all' });
  expect(result.startDate).toBe('2000-01-01');
  expect(result.points.length).toBeLessThanOrEqual(181);
  expect(result.points[0]).toMatchObject({
    weight: null,
    total: 2400,
    balance: null,
    balanceDays: 1,
  });
  expect(readNutritionHistoryRecords).toHaveBeenCalledWith('alice', '2000-01-01', '2026-10-25');
});

it('uses fixed historical ranges without scanning for an all-time start', async () => {
  await healthChartHistory('alice', { endDate: '2026-10-25', range: '10d' });
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
  expect(readHealthMetrics).toHaveBeenCalledWith('alice', '2026-10-16', '2026-10-25');
});

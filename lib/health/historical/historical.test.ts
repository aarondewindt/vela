/** @jest-environment node */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '../../../generated/prisma/client';
import { csvRecords } from './csv';
import { localTimestamp, samsungRecord, withingsRecord, consolidateDay } from './model';
import { importArguments, runHistoricalImport } from './runner';
import { matchHistorical, persistHistorical } from './persistence';

const zone = 'Europe/Amsterdam';
const weight = () =>
  withingsRecord({ Date: '2022-01-25 22:11:08', 'Weight (kg)': '100.25' }, 'weight.csv', zone)!;
const samsung = (kind: string, row: Record<string, string>) =>
  samsungRecord(
    {
      datauuid: 'source-id',
      update_time: '2025-06-02 12:30:00.000',
      deviceuuid: 'watch',
      day_time: '2025-06-01 00:00:00.000',
      ...row,
    },
    `com.samsung.${kind}.20261025135468.csv`,
    zone
  );
const existing = (record = weight()) => ({
  ...record,
  id: 'existing',
  value: { toString: () => record.value } as never,
  observedAt: new Date(record.observedAt),
});

it('parses BOM, CRLF, quoted commas, escaped quotes and multiline records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vela-csv-test-'));
  try {
    const path = join(dir, 'test.csv');
    await writeFile(path, '\uFEFFa,b\r\n"hello, world","line1\nline2 ""quote"""\r\n');
    const rows = [];
    for await (const row of csvRecords(path)) {
      rows.push(row);
    }
    expect(rows).toEqual([
      ['a', 'b'],
      ['hello, world', 'line1\nline2 "quote"'],
    ]);
    await writeFile(path, 'a\n"unterminated');
    await expect(
      (async () => {
        for await (const _row of csvRecords(path)) {
          expect(_row).toBeDefined();
        }
      })()
    ).rejects.toThrow('Unterminated');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('requires strict CLI arguments', () => {
  expect(() => importArguments([])).toThrow('Required');
  expect(() => importArguments(['--file', 'x', '--user', 'a@b', '--unknown'])).toThrow();
  expect(
    importArguments(['--file', 'x', '--user', 'a@b', '--dry-run', '--overwrite'])
  ).toMatchObject({ dryRun: true, overwrite: true });
});

it('uses Withings local clocks, direct percentages and direct fat-free kg without deriving values', () => {
  expect(weight()).toMatchObject({
    value: '100.250000',
    observedAt: '2022-01-25T21:11:08.000Z',
    date: '2022-01-25',
    source: 'withings',
  });
  expect(
    withingsRecord(
      { type: 'FAT_FREE_MASS', value: '74', date: '2022-01-25 22:11:08' },
      'other.csv',
      zone
    )
  ).toMatchObject({ metric: 'LEAN_MASS', value: '74.000000' });
  expect(
    withingsRecord(
      { type: 'FAT_PERCENT', value: '28', date: '2022-01-25 22:11:08' },
      'other.csv',
      zone
    )
  ).toMatchObject({ metric: 'BODY_FAT', value: '28.000000' });
  expect(() =>
    withingsRecord({ Date: '2022-01-25 22:11:08', 'Weight (kg)': '' }, 'weight.csv', zone)
  ).toThrow();
  expect(() =>
    withingsRecord(
      { type: 'FAT_PERCENT', value: '101', date: '2022-01-25 22:11:08' },
      'other.csv',
      zone
    )
  ).toThrow();
  expect(() => localTimestamp('2026-10-25 02:30:00', zone)).toThrow('Ambiguous');
  expect(() => localTimestamp('2026-03-29 02:30:00', zone)).toThrow('nonexistent');
});

it('selects deduplicated all-source steps and retains source day without timezone shifting', () => {
  expect(samsung('shealth.step_daily_trend', { source_type: '0', count: '100' })).toBeNull();
  expect(samsung('shealth.step_daily_trend', { source_type: '108', count: '100' })).toBeNull();
  expect(samsung('shealth.step_daily_trend', { source_type: '-2', count: '100' })).toMatchObject({
    metric: 'STEPS',
    value: '100.000000',
    date: '2025-06-01',
  });
  expect(() => samsung('shealth.step_daily_trend', { source_type: '-2', count: '1.5' })).toThrow();
});

it('keeps active, resting, exercise calories and explicit BMR separate', () => {
  const active = samsung('shealth.calories_burned.details', {
    active_calorie: '500',
    rest_calorie: '1900',
    tef_calorie: '10',
    total_exercise_calories: '200',
  });
  expect(active).toMatchObject({
    metric: 'ACTIVE_CALORIES',
    value: '500.000000',
    metadata: { rest_calorie: 1900, tef_calorie: 10, total_exercise_calories: 200 },
  });
  expect(samsung('health.weight', {})).toBeNull();
  expect(
    samsung('health.weight', {
      basal_metabolic_rate: '1950',
      start_time: '2025-06-01 23:30:00.000',
      time_offset: 'UTC+0200',
    })
  ).toMatchObject({ metric: 'BMR', value: '1950.000000', date: '2025-06-02' });
  expect(() =>
    samsung('health.weight', {
      basal_metabolic_rate: '1',
      start_time: '2025-06-01 23:30:00.000',
      time_offset: 'UTC+0200',
    })
  ).toThrow();
});

it('groups overnight sleep by wake date, avoids combined parents and rejects overlapping sessions', () => {
  const sleep = samsung('shealth.sleep', {
    start_time: '2025-05-31 22:30:00.000',
    end_time: '2025-06-01 06:30:00.000',
    time_offset: 'UTC+0200',
    sleep_duration: '420',
  })!;
  expect(sleep).toMatchObject({ date: '2025-06-01', value: '7.000000' });
  expect(samsung('shealth.sleep_combined', {})).toBeNull();
  expect(consolidateDay([sleep, sleep])).toHaveLength(1);
  const nap = samsung('shealth.sleep', {
    datauuid: 'nap',
    start_time: '2025-06-01 12:30:00.000',
    end_time: '2025-06-01 13:30:00.000',
    time_offset: 'UTC+0200',
  })!;
  expect(consolidateDay([sleep, nap])[0]).toMatchObject({
    value: '8.000000',
    metadata: { sessionCount: 2, durationBasis: 'includes_session_elapsed' },
  });
  expect(() =>
    consolidateDay([
      sleep,
      { ...sleep, metadata: { ...sleep.metadata, periodStart: '2025-06-01T01:00:00.000Z' } },
    ])
  ).toThrow('Overlapping');
});

it('skips replays, overwrites only import-owned identities and protects live source data', () => {
  const record = weight();
  expect(matchHistorical(record, [existing()], false).action).toBe('skip');
  expect(matchHistorical(record, [existing()], true).action).toBe('skip');
  expect(matchHistorical({ ...record, value: '101.000000' }, [existing()], true).action).toBe(
    'overwrite'
  );
  const ha = {
    ...existing(),
    source: 'home_assistant',
    sourceKey: 'ha:namespace:entity:timestamp',
  };
  expect(matchHistorical(record, [ha], true).action).toBe('protected');
  expect(
    matchHistorical({ ...record, observedAt: '2022-01-25T21:12:08.000Z' }, [ha], false).action
  ).toBe('create');
  const steps = samsung('shealth.step_daily_trend', { source_type: '-2', count: '100' })!;
  expect(
    matchHistorical(
      steps,
      [{ ...existing(steps), sourceKey: 'device:credential:steps:date' }],
      true
    ).action
  ).toBe('protected');
});

it('uses read-only transactions in dry-run and never calls a mutation', async () => {
  const tx = {
    $executeRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
    healthMetric: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const db = { $transaction: jest.fn((fn) => fn(tx)) } as unknown as PrismaClient;
  expect(
    await persistHistorical(db, 'owner', [weight()], { dryRun: true, overwrite: true })
  ).toMatchObject({ importable: 1, overwritten: 0 });
  expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
  expect(tx.$queryRaw).not.toHaveBeenCalled();
  expect(tx.healthMetric.create).not.toHaveBeenCalled();
  expect(tx.healthMetric.update).not.toHaveBeenCalled();
});

it('executes the full file dry-run and rejects missing or ambiguous owners', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vela-import-test-'));
  const tx = {
    $executeRawUnsafe: jest.fn(),
    healthMetric: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
  };
  const findMany = jest.fn().mockResolvedValue([{ id: 'owner', timezone: zone }]);
  const db = {
    user: { findMany },
    $transaction: jest.fn((fn) => fn(tx)),
  } as unknown as PrismaClient;
  try {
    await writeFile(join(dir, 'weight.csv'), 'Date,Weight (kg)\n2022-01-25 22:11:08,100.25\n');
    const args = ['--file', dir, '--user', 'a@b', '--dry-run'];
    const summary = await runHistoricalImport('withings', args, db, () => {});
    expect(summary).toMatchObject({ candidates: 1, importable: 1, invalid: 0 });
    expect(tx.healthMetric.create).not.toHaveBeenCalled();
    findMany.mockResolvedValue([]);
    await expect(runHistoricalImport('withings', args, db)).rejects.toThrow('exactly one');
    findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(runHistoricalImport('withings', args, db)).rejects.toThrow('exactly one');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('batches writes and a second import skips every previously created sample', async () => {
  const stored: ReturnType<typeof existing>[] = [];
  const tx = {
    $queryRaw: jest.fn(),
    healthMetric: {
      findMany: jest.fn(async () => [...stored]),
      create: jest.fn(async ({ data }) => {
        stored.push({ ...data, id: String(stored.length), value: data.value });
      }),
      update: jest.fn(),
    },
  };
  const db = { $transaction: jest.fn((fn) => fn(tx)) } as unknown as PrismaClient;
  const records = Array.from({ length: 101 }, (_, i) => {
    const observedAt = new Date(new Date(weight().observedAt).getTime() + i * 1000).toISOString();
    return { ...weight(), observedAt, sourceKey: `historical:withings:WEIGHT:${observedAt}` };
  });
  expect(
    await persistHistorical(db, 'owner', records, { dryRun: false, overwrite: false })
  ).toMatchObject({ importable: 101 });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(
    await persistHistorical(db, 'owner', records, { dryRun: false, overwrite: false })
  ).toMatchObject({ importable: 0, skipped: 101 });
  expect(tx.healthMetric.create).toHaveBeenCalledTimes(101);
  expect(tx.healthMetric.update).not.toHaveBeenCalled();
});

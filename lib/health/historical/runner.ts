import 'server-only';
import { appendFile, mkdtemp, opendir, readFile, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import type { PrismaClient } from '../../../generated/prisma/client';
import { csvObject, csvRecords } from './csv';
import { consolidateDay, samsungRecord, withingsRecord, type HistoricalRecord } from './model';
import { persistHistorical } from './persistence';

type Provider = 'withings' | 'samsung';
export function importArguments(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: 'string' },
      user: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      overwrite: { type: 'boolean', default: false },
    },
  });
  if (!values.file?.trim() || !values.user?.trim() || !values.user.includes('@')) {
    throw new Error(
      'Required: --file <export-directory-or-file> --user <existing-email> [--dry-run] [--overwrite]'
    );
  }
  return {
    file: values.file,
    email: values.user.trim(),
    dryRun: values['dry-run'],
    overwrite: values.overwrite,
  };
}

async function* filesAt(path: string): AsyncGenerator<string> {
  if ((await stat(path)).isFile()) {
    yield path;
    return;
  }
  for await (const entry of await opendir(path)) {
    // Export JSON trees are inventoried separately; never follow symlinks.
    if (entry.isFile()) {
      yield join(path, entry.name);
    }
  }
}

export async function runHistoricalImport(
  provider: Provider,
  args: string[],
  db: PrismaClient,
  print: (value: string) => void = (value) => process.stdout.write(`${value}\n`)
) {
  const options = importArguments(args);
  const users = await db.user.findMany({
    where: { email: { equals: options.email, mode: 'insensitive' } },
    select: { id: true, timezone: true },
    take: 2,
  });
  if (users.length !== 1) {
    throw new Error('Email must identify exactly one existing Vela user.');
  }
  const user = users[0];
  let timezone = user.timezone;
  // Withings wall clocks use the export device timezone, not the host's timezone.
  if (provider === 'withings' && (await stat(options.file)).isDirectory()) {
    const devices = join(options.file, 'devices.csv');
    try {
      let header: string[] | undefined;
      const zones = new Set<string>();
      for await (const values of csvRecords(devices)) {
        if (!header) {
          header = values;
          continue;
        }
        const row = csvObject(header, values);
        if (row.timezone) {
          zones.add(row.timezone);
        }
      }
      if (zones.size > 1) {
        throw new Error('Multiple Withings device timezones; select and review a single file.');
      }
      timezone = [...zones][0] ?? timezone;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  print(
    JSON.stringify({
      provider,
      dryRun: options.dryRun,
      overwrite: options.overwrite,
      timezone,
      notes:
        provider === 'samsung'
          ? [
              'Only all-source (-2) step totals are imported; raw/device/pedometer duplicates are excluded.',
              'No explicit total-calorie field: TOTAL_CALORIES is withheld; active/rest/TEF composition needs verification.',
              'Rest calories are not BMR. Only explicit basal_metabolic_rate points are BMR.',
              'Combined sleep parents are excluded; child sessions are consolidated by wake date. Missing duration uses labelled elapsed interval.',
              'Daily source dates are retained; timezone is a user fallback where the export has no offset.',
            ]
          : [
              'Direct FAT_PERCENT and FAT_FREE_MASS only; no calculated lean mass.',
              'Offsetless times use the device timezone or user fallback; DST ambiguity is rejected.',
            ],
    })
  );
  const spool = await mkdtemp(join(tmpdir(), 'vela-health-import-'));
  const summary = {
    files: 0,
    parsed: 0,
    candidates: 0,
    consolidated: 0,
    unsupported: 0,
    invalid: 0,
    importable: 0,
    skipped: 0,
    overwritten: 0,
    protected: 0,
    possibleHaOverlap: 0,
    metrics: {} as Record<string, { candidates: number; firstDate: string; lastDate: string }>,
  };
  try {
    for await (const path of filesAt(options.file)) {
      const file = basename(path);
      summary.files++;
      if (!file.endsWith('.csv')) {
        print(JSON.stringify({ file, status: 'unsupported format' }));
        continue;
      }
      let header: string[] | undefined;
      let preamble = provider === 'samsung';
      const inventory = {
        file,
        parsed: 0,
        candidates: 0,
        unsupported: 0,
        invalid: 0,
        measurementTypes: [] as string[],
        firstDate: '',
        lastDate: '',
        sourceDateRanges: {} as Record<string, { first: string; last: string }>,
      };
      try {
        for await (const values of csvRecords(path)) {
          if (preamble) {
            preamble = false;
            continue;
          }
          if (!header) {
            header = values;
            if (new Set(header).size !== header.length) {
              throw new Error('Duplicate CSV headers.');
            }
            continue;
          }
          inventory.parsed++;
          summary.parsed++;
          try {
            const row = csvObject(header, values);
            // Inventory all temporal columns without printing personal values or comments.
            for (const [key, value] of Object.entries(row)) {
              if (
                !/(date|time|^from$|^to$|^start$)/i.test(key) ||
                !/^\d{4}-\d\d-\d\d/.test(value)
              ) {
                continue;
              }
              const day = value.slice(0, 10);
              const range = inventory.sourceDateRanges[key];
              inventory.sourceDateRanges[key] = {
                first: range && range.first < day ? range.first : day,
                last: range && range.last > day ? range.last : day,
              };
            }
            const record =
              provider === 'withings'
                ? withingsRecord(row, file, timezone)
                : samsungRecord(row, file, timezone);
            if (!record) {
              inventory.unsupported++;
              summary.unsupported++;
              continue;
            }
            inventory.candidates++;
            summary.candidates++;
            const metricInventory = summary.metrics[record.metric];
            summary.metrics[record.metric] = {
              candidates: (metricInventory?.candidates ?? 0) + 1,
              firstDate:
                metricInventory && metricInventory.firstDate < record.date
                  ? metricInventory.firstDate
                  : record.date,
              lastDate:
                metricInventory && metricInventory.lastDate > record.date
                  ? metricInventory.lastDate
                  : record.date,
            };
            if (!inventory.measurementTypes.includes(record.metric)) {
              inventory.measurementTypes.push(record.metric);
            }
            inventory.firstDate =
              !inventory.firstDate || record.date < inventory.firstDate
                ? record.date
                : inventory.firstDate;
            inventory.lastDate =
              record.date > inventory.lastDate ? record.date : inventory.lastDate;
            await appendFile(join(spool, `${record.date}.jsonl`), `${JSON.stringify(record)}\n`, {
              mode: 0o600,
            });
          } catch (error) {
            if (error && typeof error === 'object' && 'code' in error) {
              throw error;
            }
            inventory.invalid++;
            summary.invalid++;
            if (inventory.invalid <= 5) {
              print(JSON.stringify({ file, record: inventory.parsed, error: safeError(error) }));
            }
          }
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) {
          throw error;
        }
        inventory.invalid++;
        summary.invalid++;
        print(JSON.stringify({ file, error: safeError(error) }));
      }
      print(JSON.stringify(inventory));
    }
    if (!summary.candidates) {
      throw new Error('No supported measurements found; inspect export files and formats.');
    }
    for await (const entry of await opendir(spool)) {
      const path = join(spool, entry.name);
      if ((await stat(path)).size > 16 * 1024 * 1024) {
        throw new Error('One date exceeds the 16 MiB safety limit.');
      }
      const records = (await readFile(path, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as HistoricalRecord);
      if (records.length > 10000) {
        throw new Error('One date exceeds 10000 candidate measurements.');
      }
      let consolidated: HistoricalRecord[];
      try {
        consolidated = consolidateDay(records.filter((r) => r.metric !== 'SLEEP'));
      } catch (error) {
        summary.invalid += records.length;
        print(JSON.stringify({ date: entry.name.slice(0, 10), error: safeError(error) }));
        continue;
      }
      const sleep = records.filter((r) => r.metric === 'SLEEP');
      try {
        const sleepTotals = consolidateDay(sleep);
        consolidated.push(...sleepTotals);
        summary.consolidated += sleep.length - sleepTotals.length;
      } catch (error) {
        summary.invalid += sleep.length;
        print(
          JSON.stringify({
            date: entry.name.slice(0, 10),
            metric: 'SLEEP',
            error: safeError(error),
          })
        );
      }
      summary.consolidated +=
        records.length - sleep.length - consolidated.filter((r) => r.metric !== 'SLEEP').length;
      const result = await persistHistorical(db, user.id, consolidated, options);
      for (const key of [
        'importable',
        'skipped',
        'overwritten',
        'protected',
        'possibleHaOverlap',
      ] as const) {
        summary[key] += result[key];
      }
    }
    print(
      JSON.stringify({
        summary,
        dryRun: options.dryRun,
        writes: options.dryRun ? 0 : summary.importable + summary.overwritten,
      })
    );
    return summary;
  } finally {
    await rm(spool, { recursive: true, force: true });
  }
}

function safeError(error: unknown) {
  // Zod/driver errors may contain source values or connection details. Only expose our fixed parser messages.
  return error instanceof Error && error.constructor === Error
    ? error.message
    : 'Invalid export record or inaccessible file.';
}

import { dateInTimezone, diaryDateSchema } from '@/lib/nutrition/dates';
import { validMetricValue, type MetricKind } from '../schema';

export type HistoricalRecord = {
  metric: MetricKind;
  value: string;
  date: string;
  observedAt: string;
  source: string;
  sourceKey: string;
  timestampBasis: string;
  metadata: Record<string, string | number | boolean>;
};

export function numberValue(value: string) {
  if (!value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw new Error('Missing or invalid numeric measurement.');
  }
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new Error('Nonfinite measurement.');
  }
  return result;
}

export function utcTimestamp(value: string) {
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(value)) {
    throw new Error('Unsupported timestamp format.');
  }
  diaryDateSchema.parse(value.slice(0, 10));
  const iso = `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== iso.slice(0, 19)) {
    throw new Error('Invalid timestamp.');
  }
  return date;
}

/** Resolve an offsetless Withings wall clock; reject DST gaps and ambiguous repeated hours. */
export function localTimestamp(value: string, timezone: string) {
  const wall = utcTimestamp(value);
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const offsets = new Set<number>();
  for (const hours of [-24, 0, 24]) {
    const probe = new Date(wall.getTime() + hours * 3600000);
    offsets.add(utcTimestamp(format.format(probe)).getTime() - probe.getTime());
  }
  const matches = [...offsets]
    .map((offset) => new Date(wall.getTime() - offset))
    .filter((date) => format.format(date) === value.slice(0, 19));
  if (matches.length !== 1) {
    throw new Error('Ambiguous or nonexistent local timestamp (DST).');
  }
  return matches[0];
}

export function offsetDate(instant: Date, offset: string) {
  const match = /^UTC([+-])(\d\d)(\d\d)$/.exec(offset);
  if (
    !match ||
    Number(match[2]) > 14 ||
    Number(match[3]) > 59 ||
    (Number(match[2]) === 14 && Number(match[3]) !== 0)
  ) {
    throw new Error('Missing or invalid Samsung UTC offset.');
  }
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1);
  return new Date(instant.getTime() + minutes * 60000).toISOString().slice(0, 10);
}

export function validateRecord(record: HistoricalRecord) {
  diaryDateSchema.parse(record.date);
  if (!validMetricValue(record.metric, Number(record.value))) {
    throw new Error('Measurement outside Vela limits.');
  }
  const observedAt = new Date(record.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300000) {
    throw new Error('Invalid or future measurement timestamp.');
  }
  if (record.sourceKey.length > 500) {
    throw new Error('Measurement identity too long.');
  }
  return record;
}

export function withingsRecord(
  row: Record<string, string>,
  file: string,
  timezone: string
): HistoricalRecord | null {
  let metric: MetricKind;
  let raw: string;
  const originalTimestamp = row.Date ?? row.date;
  if (file === 'weight.csv') {
    metric = 'WEIGHT';
    raw = row['Weight (kg)'];
  } else if (file === 'other.csv' && ['FAT_PERCENT', 'FAT_FREE_MASS'].includes(row.type)) {
    metric = row.type === 'FAT_PERCENT' ? 'BODY_FAT' : 'LEAN_MASS';
    raw = row.value;
    if (row.unit && row.unit !== (metric === 'BODY_FAT' ? '%' : 'kg')) {
      throw new Error('Unsupported Withings unit.');
    }
  } else {
    return null;
  }
  const observedAt = localTimestamp(originalTimestamp, timezone).toISOString();
  return validateRecord({
    metric,
    value: numberValue(raw).toFixed(6),
    date: dateInTimezone(timezone, new Date(observedAt)),
    observedAt,
    source: 'withings',
    sourceKey: `historical:withings:${metric}:${observedAt}`,
    timestampBasis: 'export_local_measurement',
    metadata: {
      importer: 'withings-v1',
      file,
      originalTimestamp,
      timezone,
      timezoneBasis: 'export_device_or_user_fallback',
    },
  });
}

export function samsungRecord(
  row: Record<string, string>,
  file: string,
  timezone: string
): HistoricalRecord | null {
  const get = (key: string) =>
    row[key] ?? Object.entries(row).find(([name]) => name.endsWith(`.${key}`))?.[1] ?? '';
  let metric: MetricKind;
  let value: number;
  let date: string;
  let observed: Date;
  let timestampBasis = 'export_daily_update';
  const metadata: HistoricalRecord['metadata'] = { importer: 'samsung-v1', file, timezone };
  if (file.startsWith('com.samsung.shealth.step_daily_trend.')) {
    if (get('source_type') !== '-2') {
      return null;
    }
    metric = 'STEPS';
    value = numberValue(get('count'));
    date = get('day_time').slice(0, 10);
    observed = utcTimestamp(get('update_time'));
    metadata.measurementKind = 'export_steps_daily_all_sources';
  } else if (file.startsWith('com.samsung.shealth.calories_burned.details.')) {
    metric = 'ACTIVE_CALORIES';
    value = numberValue(get('active_calorie'));
    date = get('day_time').slice(0, 10);
    observed = utcTimestamp(get('update_time'));
    metadata.measurementKind = 'export_active_calories_semantics_unverified';
    // Retain components for review; rest expenditure is not BMR. No verified total field exists.
    for (const key of ['rest_calorie', 'tef_calorie', 'total_exercise_calories']) {
      if (get(key)) {
        metadata[key] = numberValue(get(key));
      }
    }
  } else if (file.startsWith('com.samsung.health.weight.')) {
    if (!get('basal_metabolic_rate')) {
      return null;
    }
    metric = 'BMR';
    value = numberValue(get('basal_metabolic_rate'));
    observed = utcTimestamp(get('start_time'));
    date = offsetDate(observed, get('time_offset'));
    timestampBasis = 'export_measurement';
    metadata.timeOffset = get('time_offset');
    metadata.originalTimestamp = get('start_time');
    metadata.measurementKind = 'export_bmr_point';
  } else if (file.startsWith('com.samsung.shealth.sleep.')) {
    metric = 'SLEEP';
    const start = utcTimestamp(get('start_time'));
    const end = utcTimestamp(get('end_time'));
    const elapsed = (end.getTime() - start.getTime()) / 3600000;
    if (elapsed <= 0 || elapsed > 24) {
      throw new Error('Invalid sleep interval.');
    }
    // Use the source duration where present, otherwise retain the explicitly labelled session interval.
    value = get('sleep_duration') ? numberValue(get('sleep_duration')) / 60 : elapsed;
    if (value > elapsed + 1 / 60) {
      throw new Error('Sleep duration exceeds session interval.');
    }
    date = offsetDate(end, get('time_offset'));
    observed = end;
    timestampBasis = 'export_sleep_session';
    Object.assign(metadata, {
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      timeOffset: get('time_offset'),
      originalTimestamp: get('start_time'),
      durationBasis: get('sleep_duration') ? 'export_minutes' : 'session_elapsed',
      measurementKind: 'export_sleep_wake_date_total',
      combinedId: get('combined_id'),
    });
  } else {
    return null;
  }
  const upstreamId = get('datauuid');
  if (!upstreamId) {
    throw new Error('Missing Samsung record identity.');
  }
  Object.assign(metadata, {
    upstreamId,
    sourceModifiedAt: utcTimestamp(get('update_time')).toISOString(),
    deviceId: get('deviceuuid'),
  });
  if (get('day_time')) {
    utcTimestamp(get('day_time'));
    metadata.originalDayTime = get('day_time');
    metadata.dateBasis = 'source_calendar_day';
    metadata.timezoneBasis = 'user_fallback_no_export_offset';
  }
  return validateRecord({
    metric,
    value: value.toFixed(6),
    date,
    observedAt: observed.toISOString(),
    source: 'samsung_health',
    sourceKey: `historical:samsung:${metric}:${metric === 'BMR' ? upstreamId : date}`,
    timestampBasis,
    metadata,
  });
}

/** One daily aggregate. Sleep children are used instead of combined parent rows. Never add overlaps. */
export function consolidateDay(records: HistoricalRecord[]) {
  const output: HistoricalRecord[] = [];
  for (const record of records.filter((r) => r.metric !== 'SLEEP')) {
    const existing = output.findIndex((r) => r.sourceKey === record.sourceKey);
    if (existing < 0) {
      output.push(record);
    } else if (
      String(record.metadata.sourceModifiedAt ?? record.observedAt) >
      String(output[existing].metadata.sourceModifiedAt ?? output[existing].observedAt)
    ) {
      output[existing] = record;
    } else if (
      String(record.metadata.sourceModifiedAt ?? record.observedAt) ===
        String(output[existing].metadata.sourceModifiedAt ?? output[existing].observedAt) &&
      record.value !== output[existing].value
    ) {
      throw new Error('Conflicting records share the same identity and timestamp.');
    }
  }
  const sleep = records
    .filter((r) => r.metric === 'SLEEP')
    .sort(
      (a, b) =>
        String(a.metadata.periodStart).localeCompare(String(b.metadata.periodStart)) ||
        String(b.metadata.sourceModifiedAt).localeCompare(String(a.metadata.sourceModifiedAt))
    );
  const sessions: HistoricalRecord[] = [];
  for (const record of sleep) {
    const last = sessions.at(-1);
    if (
      last &&
      record.metadata.periodStart === last.metadata.periodStart &&
      record.metadata.periodEnd === last.metadata.periodEnd
    ) {
      continue;
    }
    if (last && String(record.metadata.periodStart) < String(last.metadata.periodEnd)) {
      throw new Error('Overlapping sleep sessions need review; entire date skipped.');
    }
    sessions.push(record);
  }
  if (sessions.length) {
    const last = sessions.at(-1)!;
    output.push(
      validateRecord({
        ...last,
        value: sessions.reduce((sum, r) => sum + Number(r.value), 0).toFixed(6),
        metadata: {
          ...last.metadata,
          periodStart: sessions[0].metadata.periodStart,
          sessionCount: sessions.length,
          sessionRecords: JSON.stringify(sessions),
          durationBasis: sessions.some((r) => r.metadata.durationBasis === 'session_elapsed')
            ? 'includes_session_elapsed'
            : 'export_minutes',
        },
      })
    );
  }
  return output;
}

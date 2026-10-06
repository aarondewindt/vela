import type { PropertyDef, ViewConfig, ViewFilter, ViewSort } from './types';

export type ViewGroup<Row> = {
  key: string | null;
  label: string;
  color?: string | null;
  rows: Row[];
};

const isEmptyValue = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);

function toIsoDate(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Supports ISO dates plus relative tokens: "@today", "@today+7", "@today-1".
export function resolveDateValue(value: string, today: string): string {
  const match = /^@today(?:([+-])(\d+))?$/.exec(value);
  if (!match) {
    return value;
  }
  return match[1] ? addDays(today, (match[1] === '-' ? -1 : 1) * Number(match[2])) : today;
}

function matchesFilter<Row>(
  row: Row,
  filter: ViewFilter,
  def: PropertyDef<Row>,
  today: string
): boolean {
  const raw = def.get(row);
  const empty = isEmptyValue(raw);

  if (filter.operator === 'isEmpty') {
    return empty;
  }
  if (filter.operator === 'isNotEmpty') {
    return !empty;
  }
  // Incomplete filters (no value yet) shouldn't hide everything.
  if (filter.value === '') {
    return true;
  }

  switch (def.type) {
    case 'text': {
      const text = String(raw ?? '').toLowerCase();
      const needle = filter.value.toLowerCase();
      if (filter.operator === 'contains') {
        return text.includes(needle);
      }
      if (filter.operator === 'notContains') {
        return !text.includes(needle);
      }
      return filter.operator === 'is' ? text === needle : text !== needle;
    }
    case 'number': {
      if (empty) {
        return filter.operator === 'neq';
      }
      const value = Number(raw);
      const target = Number(filter.value);
      switch (filter.operator) {
        case 'eq':
          return value === target;
        case 'neq':
          return value !== target;
        case 'gt':
          return value > target;
        case 'gte':
          return value >= target;
        case 'lt':
          return value < target;
        case 'lte':
          return value <= target;
        default:
          return true;
      }
    }
    case 'select': {
      const equal = raw === filter.value;
      return filter.operator === 'isNot' ? !equal : equal;
    }
    case 'multiSelect': {
      const has = Array.isArray(raw) && raw.includes(filter.value);
      return filter.operator === 'notContains' ? !has : has;
    }
    case 'date': {
      const value = toIsoDate(raw);
      const target = resolveDateValue(filter.value, today);
      if (!value) {
        return false;
      }
      switch (filter.operator) {
        case 'is':
          return value === target;
        case 'before':
          return value < target;
        case 'after':
          return value > target;
        case 'onOrBefore':
          return value <= target;
        case 'onOrAfter':
          return value >= target;
        default:
          return true;
      }
    }
  }
}

export function applyFilters<Row>(
  rows: Row[],
  filters: ViewFilter[],
  defs: PropertyDef<Row>[],
  today: string
) {
  const active = filters.flatMap((filter) => {
    const def = defs.find((d) => d.key === filter.property);
    return def ? [{ filter, def }] : [];
  });
  if (!active.length) {
    return rows;
  }
  return rows.filter((row) => active.every(({ filter, def }) => matchesFilter(row, filter, def, today)));
}

export function applySearch<Row>(rows: Row[], query: string, fields: (row: Row) => string[]) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return rows;
  }
  return rows.filter((row) => fields(row).some((field) => field.toLowerCase().includes(needle)));
}

function comparable(def: PropertyDef<any>, row: any): string | number | null {
  const raw = def.get(row);
  if (isEmptyValue(raw)) {
    return null;
  }
  switch (def.type) {
    case 'number':
      return Number(raw);
    case 'date':
      return toIsoDate(raw);
    case 'select': {
      const index = def.options?.findIndex((option) => option.value === raw) ?? -1;
      return index >= 0 ? index : String(raw);
    }
    case 'multiSelect':
      return (raw as string[]).join(',').toLowerCase();
    default:
      return String(raw).toLowerCase();
  }
}

export function applySorts<Row>(rows: Row[], sorts: ViewSort[], defs: PropertyDef<Row>[]) {
  const active = sorts.flatMap((sort) => {
    const def = defs.find((d) => d.key === sort.property);
    return def ? [{ sort, def }] : [];
  });
  if (!active.length) {
    return rows;
  }
  return [...rows].sort((a, b) => {
    for (const { sort, def } of active) {
      const left = comparable(def, a);
      const right = comparable(def, b);
      if (left === right) {
        continue;
      }
      // Empty values always sort last, regardless of direction.
      if (left === null) {
        return 1;
      }
      if (right === null) {
        return -1;
      }
      const result = left < right ? -1 : 1;
      return sort.direction === 'asc' ? result : -result;
    }
    return 0;
  });
}

// Groups follow option order; empty groups are kept so they can still receive new items.
export function groupRows<Row>(
  rows: Row[],
  def: PropertyDef<Row>,
  emptyLabel: string
): ViewGroup<Row>[] {
  const buckets = new Map<string | null, Row[]>();
  for (const row of rows) {
    const raw = def.get(row);
    const keys = Array.isArray(raw)
      ? raw.length
        ? (raw as string[])
        : [null]
      : [isEmptyValue(raw) ? null : toIsoDateOrString(raw)];
    for (const key of keys) {
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
  }

  const groups: ViewGroup<Row>[] = (def.options ?? []).map((option) => ({
    key: option.value,
    label: option.label,
    color: option.color,
    rows: buckets.get(option.value) ?? [],
  }));
  const known = new Set(groups.map((group) => group.key));

  for (const [key, bucket] of buckets) {
    if (key !== null && !known.has(key)) {
      groups.push({ key, label: key, rows: bucket });
    }
  }
  groups.push({ key: null, label: emptyLabel, rows: buckets.get(null) ?? [] });
  return groups;
}

function toIsoDateOrString(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

export function runView<Row>(
  rows: Row[],
  config: ViewConfig,
  defs: PropertyDef<Row>[],
  options: { search: string; searchFields: (row: Row) => string[]; today: string }
) {
  const filtered = applyFilters(rows, config.filters, defs, options.today);
  const searched = applySearch(filtered, options.search, options.searchFields);
  return applySorts(searched, config.sorts, defs);
}

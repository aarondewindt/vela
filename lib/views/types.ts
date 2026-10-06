import { z } from 'zod';

export const propertyTypes = ['text', 'number', 'select', 'multiSelect', 'date'] as const;
export type PropertyType = (typeof propertyTypes)[number];

export const filterOperators = [
  'is',
  'isNot',
  'contains',
  'notContains',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'onOrBefore',
  'onOrAfter',
  'isEmpty',
  'isNotEmpty',
] as const;
export type FilterOperator = (typeof filterOperators)[number];

export const viewLayouts = ['table', 'kanban'] as const;
export type ViewLayout = (typeof viewLayouts)[number];

export const viewFilterSchema = z.object({
  id: z.string(),
  property: z.string(),
  operator: z.enum(filterOperators),
  value: z.string().default(''),
});
export type ViewFilter = z.infer<typeof viewFilterSchema>;

export const viewSortSchema = z.object({
  property: z.string(),
  direction: z.enum(['asc', 'desc']),
});
export type ViewSort = z.infer<typeof viewSortSchema>;

export const viewConfigSchema = z.object({
  layout: z.enum(viewLayouts),
  groupBy: z.string().nullable(),
  filters: z.array(viewFilterSchema),
  sorts: z.array(viewSortSchema),
  visibleProperties: z.array(z.string()),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export type SelectOption = { value: string; label: string; color?: string | null };

export type PropertyDef<Row> = {
  key: string;
  label: string;
  type: PropertyType;
  // Raw value used for filtering, sorting and grouping.
  get: (row: Row) => unknown;
  // Ordered options; also defines sort rank and group order for select properties.
  options?: SelectOption[];
};

export type SavedViewRecord = {
  id: string;
  scope: string;
  name: string;
  config: ViewConfig;
  builtIn?: boolean;
};

export const operatorLabels: Record<FilterOperator, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  before: 'before',
  after: 'after',
  onOrBefore: 'on or before',
  onOrAfter: 'on or after',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
};

export const operatorsByType: Record<PropertyType, FilterOperator[]> = {
  text: ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  multiSelect: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  date: ['is', 'before', 'after', 'onOrBefore', 'onOrAfter', 'isEmpty', 'isNotEmpty'],
};

export const valuelessOperators: FilterOperator[] = ['isEmpty', 'isNotEmpty'];

'use client';

import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Popover,
  Select,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconArrowsSort,
  IconColumns3,
  IconFilter,
  IconPlus,
  IconSearch,
  IconStack2,
  IconX,
} from '@tabler/icons-react';
import {
  operatorLabels,
  operatorsByType,
  valuelessOperators,
  type PropertyDef,
  type ViewConfig,
  type ViewFilter,
} from '@/lib/views/types';

const relativeDates = [
  { value: 'exact', label: 'Exact date' },
  { value: '@today', label: 'Today' },
  { value: '@today+1', label: 'Tomorrow' },
  { value: '@today-1', label: 'Yesterday' },
  { value: '@today+7', label: 'In 7 days' },
  { value: '@today+14', label: 'In 14 days' },
];

function FilterValueInput<Row>({
  def,
  filter,
  onChange,
}: {
  def: PropertyDef<Row>;
  filter: ViewFilter;
  onChange: (value: string) => void;
}) {
  if (valuelessOperators.includes(filter.operator)) {
    return null;
  }

  if (def.type === 'select' || def.type === 'multiSelect') {
    return (
      <Select
        aria-label="Filter value"
        size="xs"
        w={140}
        searchable
        data={(def.options ?? []).map(({ value, label }) => ({ value, label }))}
        value={filter.value || null}
        onChange={(value) => onChange(value ?? '')}
      />
    );
  }

  if (def.type === 'date') {
    const isRelative = filter.value.startsWith('@');
    return (
      <Group gap={4} wrap="nowrap">
        <Select
          aria-label="Date mode"
          size="xs"
          w={110}
          allowDeselect={false}
          data={relativeDates}
          value={isRelative ? filter.value : 'exact'}
          onChange={(value) => onChange(value === 'exact' || !value ? '' : value)}
        />
        {!isRelative && (
          <TextInput
            aria-label="Date"
            size="xs"
            type="date"
            value={filter.value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        )}
      </Group>
    );
  }

  return (
    <TextInput
      aria-label="Filter value"
      size="xs"
      w={140}
      type={def.type === 'number' ? 'number' : 'text'}
      value={filter.value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

type ViewToolbarProps<Row> = {
  defs: PropertyDef<Row>[];
  config: ViewConfig;
  onChange: (config: ViewConfig) => void;
  search: string;
  onSearchChange: (search: string) => void;
};

export function ViewToolbar<Row>({
  defs,
  config,
  onChange,
  search,
  onSearchChange,
}: ViewToolbarProps<Row>) {
  const propertyData = defs.map(({ key, label }) => ({ value: key, label }));
  const groupable = defs.filter((d) => d.type === 'select' || d.type === 'multiSelect');
  const defOf = (key: string) => defs.find((d) => d.key === key);

  const updateFilter = (id: string, patch: Partial<ViewFilter>) =>
    onChange({
      ...config,
      filters: config.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });

  const addFilter = () => {
    const def = defs[0];
    onChange({
      ...config,
      filters: [
        ...config.filters,
        {
          id: crypto.randomUUID(),
          property: def.key,
          operator: operatorsByType[def.type][0],
          value: '',
        },
      ],
    });
  };

  const addSort = () => {
    const used = new Set(config.sorts.map((s) => s.property));
    const def = defs.find((d) => !used.has(d.key));
    if (def) {
      onChange({ ...config, sorts: [...config.sorts, { property: def.key, direction: 'asc' }] });
    }
  };

  const toggleProperty = (key: string, visible: boolean) =>
    onChange({
      ...config,
      visibleProperties: visible
        ? [...config.visibleProperties, key]
        : config.visibleProperties.filter((k) => k !== key),
    });

  return (
    <Group gap="xs" wrap="wrap">
      <TextInput
        aria-label="Search"
        placeholder="Search"
        size="xs"
        leftSection={<IconSearch size={14} />}
        value={search}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
      />

      <Popover position="bottom-start" width={560} shadow="md" trapFocus>
        <Popover.Target>
          <Button
            size="xs"
            variant={config.filters.length ? 'light' : 'default'}
            leftSection={<IconFilter size={14} />}
            rightSection={config.filters.length ? <Badge size="xs">{config.filters.length}</Badge> : null}
          >
            Filter
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="xs">
            {config.filters.length === 0 && (
              <Text size="sm" c="dimmed">
                No filters
              </Text>
            )}
            {config.filters.map((filter) => {
              const def = defOf(filter.property);
              if (!def) {
                return null;
              }
              return (
                <Group key={filter.id} gap={4} wrap="nowrap" align="flex-start">
                  <Select
                    aria-label="Property"
                    size="xs"
                    w={120}
                    allowDeselect={false}
                    data={propertyData}
                    value={filter.property}
                    onChange={(key) => {
                      const next = key ? defOf(key) : undefined;
                      if (next) {
                        updateFilter(filter.id, {
                          property: next.key,
                          operator: operatorsByType[next.type][0],
                          value: '',
                        });
                      }
                    }}
                  />
                  <Select
                    aria-label="Operator"
                    size="xs"
                    w={130}
                    allowDeselect={false}
                    data={operatorsByType[def.type].map((op) => ({
                      value: op,
                      label: operatorLabels[op],
                    }))}
                    value={filter.operator}
                    onChange={(op) => op && updateFilter(filter.id, { operator: op as ViewFilter['operator'] })}
                  />
                  <FilterValueInput
                    def={def}
                    filter={filter}
                    onChange={(value) => updateFilter(filter.id, { value })}
                  />
                  <ActionIcon
                    aria-label="Remove filter"
                    variant="subtle"
                    color="gray"
                    onClick={() =>
                      onChange({ ...config, filters: config.filters.filter((f) => f.id !== filter.id) })
                    }
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              );
            })}
            <Group>
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={addFilter}>
                Add filter
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>

      <Popover position="bottom-start" width={380} shadow="md" trapFocus>
        <Popover.Target>
          <Button
            size="xs"
            variant={config.sorts.length ? 'light' : 'default'}
            leftSection={<IconArrowsSort size={14} />}
            rightSection={config.sorts.length ? <Badge size="xs">{config.sorts.length}</Badge> : null}
          >
            Sort
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="xs">
            {config.sorts.map((sort, index) => (
              <Group key={sort.property} gap={4} wrap="nowrap">
                <Select
                  aria-label="Sort property"
                  size="xs"
                  w={140}
                  allowDeselect={false}
                  data={propertyData.filter(
                    (p) =>
                      p.value === sort.property || !config.sorts.some((s) => s.property === p.value)
                  )}
                  value={sort.property}
                  onChange={(key) =>
                    key &&
                    onChange({
                      ...config,
                      sorts: config.sorts.map((s, i) => (i === index ? { ...s, property: key } : s)),
                    })
                  }
                />
                <SegmentedControl
                  size="xs"
                  data={[
                    { value: 'asc', label: 'Asc' },
                    { value: 'desc', label: 'Desc' },
                  ]}
                  value={sort.direction}
                  onChange={(direction) =>
                    onChange({
                      ...config,
                      sorts: config.sorts.map((s, i) =>
                        i === index ? { ...s, direction: direction as 'asc' | 'desc' } : s
                      ),
                    })
                  }
                />
                <ActionIcon
                  aria-label="Remove sort"
                  variant="subtle"
                  color="gray"
                  onClick={() => onChange({ ...config, sorts: config.sorts.filter((_, i) => i !== index) })}
                >
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            ))}
            {config.sorts.length === 0 && (
              <Text size="sm" c="dimmed">
                No sorts
              </Text>
            )}
            <Group>
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconPlus size={14} />}
                disabled={config.sorts.length >= defs.length}
                onClick={addSort}
              >
                Add sort
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>

      <Popover position="bottom-start" width={200} shadow="md">
        <Popover.Target>
          <Button size="xs" variant="default" leftSection={<IconColumns3 size={14} />}>
            Properties
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="xs">
            {defs
              .filter((d) => d.key !== 'title')
              .map((def) => (
                <Checkbox
                  key={def.key}
                  size="xs"
                  label={def.label}
                  checked={config.visibleProperties.includes(def.key)}
                  onChange={(event) => toggleProperty(def.key, event.currentTarget.checked)}
                />
              ))}
          </Stack>
        </Popover.Dropdown>
      </Popover>

      <Select
        aria-label="Group by"
        size="xs"
        w={150}
        leftSection={<IconStack2 size={14} />}
        placeholder="No grouping"
        clearable
        data={groupable.map(({ key, label }) => ({ value: key, label: `Group: ${label}` }))}
        value={config.groupBy}
        onChange={(groupBy) => onChange({ ...config, groupBy })}
      />
    </Group>
  );
}

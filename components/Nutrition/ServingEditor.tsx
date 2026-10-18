'use client';

import {
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { unitLabels, type ServingDefinition } from '@/lib/nutrition/types';

export function ServingEditor({
  value,
  index,
  servingBased,
  disabled,
  onChange,
  onRemove,
}: {
  value: ServingDefinition;
  index: number;
  servingBased: boolean;
  disabled: boolean;
  onChange: (value: ServingDefinition) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<ServingDefinition>) => onChange({ ...value, ...patch });
  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            Serving {index + 1}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            disabled={disabled}
            onClick={onRemove}
          >
            Remove serving
          </Button>
        </Group>
        <Group grow align="flex-start">
          <TextInput
            label="Serving name"
            placeholder="tablespoon"
            value={value.name}
            disabled={disabled}
            onChange={(event) => update({ name: event.currentTarget.value })}
          />
          <TextInput
            label="One equals"
            placeholder="15"
            inputMode="decimal"
            value={value.quantity}
            disabled={disabled}
            onChange={(event) => update({ quantity: event.currentTarget.value })}
          />
          <Select
            label="Canonical unit"
            allowDeselect={false}
            data={(servingBased ? (['G', 'ML', 'SERVING'] as const) : (['G', 'ML'] as const)).map(
              (unit) => ({ value: unit, label: unitLabels[unit] })
            )}
            value={value.canonicalUnit}
            disabled={disabled}
            onChange={(unit) => {
              if (unit) {
                update({ canonicalUnit: unit as ServingDefinition['canonicalUnit'] });
              }
            }}
          />
        </Group>
        <TagsInput
          label="Serving aliases"
          placeholder="Add an alias and press Enter"
          value={value.aliases}
          disabled={disabled}
          onChange={(aliases) => update({ aliases })}
        />
        <Group>
          <Checkbox
            label="Default serving"
            checked={value.isDefault}
            disabled={disabled}
            onChange={(event) => update({ isDefault: event.currentTarget.checked })}
          />
          <Checkbox
            label="Estimated conversion"
            checked={value.isEstimated}
            disabled={disabled}
            onChange={(event) => update({ isEstimated: event.currentTarget.checked })}
          />
        </Group>
      </Stack>
    </Paper>
  );
}

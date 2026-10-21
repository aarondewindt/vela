'use client';
import { Select, TextInput } from '@mantine/core';
import { defaultGoalOptions, type GoalOptions } from '@/lib/goals/semantics';

export function GoalOptionsFields({
  label,
  value = defaultGoalOptions,
  onChange,
  disabled,
}: {
  label: string;
  value?: GoalOptions;
  onChange: (value: GoalOptions) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Select
        label={`${label} goal type`}
        value={value.kind}
        allowDeselect={false}
        disabled={disabled}
        data={[
          { value: 'minimum', label: 'Minimum' },
          { value: 'maximum', label: 'Maximum' },
          { value: 'target', label: 'Exact target' },
          { value: 'range', label: 'Range' },
        ]}
        onChange={(kind) => {
          if (kind === 'range') {
            onChange({ kind, upperBound: '' });
          } else if (kind === 'minimum' || kind === 'maximum' || kind === 'target') {
            onChange({ kind });
          }
        }}
      />
      {value.kind === 'range' && (
        <TextInput
          label={`${label} upper bound`}
          inputMode="decimal"
          value={value.upperBound}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, upperBound: event.currentTarget.value })}
        />
      )}
      {value.kind === 'target' && (
        <TextInput
          label={`${label} tolerance`}
          description="Optional ± tolerance; leave empty for an exact target."
          inputMode="decimal"
          value={value.tolerance ?? ''}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.currentTarget.value === ''
                ? { kind: 'target' }
                : { ...value, tolerance: event.currentTarget.value }
            )
          }
        />
      )}
    </>
  );
}

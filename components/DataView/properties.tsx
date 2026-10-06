'use client';

import { Box, NumberInput, Select, Switch, TagsInput, TextInput, Textarea } from '@mantine/core';
import { field, inputStyle, Property, ROW_HEIGHT } from './PropertyPanel';

type Option = { value: string; label: string };

export function TextProperty({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (value: string | null) => void;
}) {
  return (
    <Property label={label}>
      <Textarea
        size="sm"
        aria-label={label}
        placeholder="Empty"
        autosize
        minRows={1}
        styles={{ input: { ...inputStyle, minHeight: ROW_HEIGHT } }}
        defaultValue={value ?? ''}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim() || null;
          if (next !== value) {
            onSave(next);
          }
        }}
      />
    </Property>
  );
}

export function SelectProperty({
  label,
  value,
  data,
  onSave,
}: {
  label: string;
  value: string;
  data: Option[];
  onSave: (value: string) => void;
}) {
  return (
    <Property label={label}>
      <Select
        {...field}
        aria-label={label}
        allowDeselect={false}
        value={value}
        data={data}
        onChange={(next) => next !== null && onSave(next)}
      />
    </Property>
  );
}

export function DateProperty({
  label,
  value,
  onSave,
}: {
  label: string;
  value: Date | string | null;
  // ISO date (YYYY-MM-DD) or null when cleared.
  onSave: (value: string | null) => void;
}) {
  return (
    <Property label={label}>
      <TextInput
        {...field}
        aria-label={label}
        type="date"
        defaultValue={value ? new Date(value).toISOString().slice(0, 10) : ''}
        onChange={(event) => onSave(event.currentTarget.value || null)}
      />
    </Property>
  );
}

export function NumberProperty({
  label,
  value,
  suffix,
  onSave,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  onSave: (value: number | null) => void;
}) {
  return (
    <Property label={label}>
      <NumberInput
        {...field}
        aria-label={label}
        placeholder="Empty"
        suffix={suffix}
        min={0}
        allowDecimal={false}
        hideControls
        defaultValue={value ?? ''}
        onBlur={(event) => {
          const raw = event.currentTarget.value.replace(/\D/g, '');
          const next = raw === '' ? null : Number(raw);
          if (next !== value) {
            onSave(next);
          }
        }}
      />
    </Property>
  );
}

export function TagsProperty({
  label,
  value,
  suggestions,
  onSave,
}: {
  label: string;
  value: string[];
  suggestions: string[];
  onSave: (value: string[]) => void;
}) {
  return (
    <Property label={label}>
      <TagsInput
        size="sm"
        aria-label={label}
        placeholder="Empty"
        styles={{ input: { ...inputStyle, minHeight: ROW_HEIGHT } }}
        data={suggestions}
        value={value}
        onChange={onSave}
      />
    </Property>
  );
}

export function SwitchProperty({
  label,
  checked,
  onSave,
}: {
  label: string;
  checked: boolean;
  onSave: (checked: boolean) => void;
}) {
  return (
    <Property label={label}>
      <Box h={ROW_HEIGHT} style={{ display: 'flex', alignItems: 'center' }}>
        <Switch
          aria-label={label}
          checked={checked}
          onChange={(event) => onSave(event.currentTarget.checked)}
        />
      </Box>
    </Property>
  );
}

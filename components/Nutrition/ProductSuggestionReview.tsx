'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import type { ProductInput } from '@/lib/nutrition/schema';
import type { ProductSuggestion } from '@/lib/nutrition/product-extraction/schema';
import { ProductPipelineEvidence } from './ProductPipelineEvidence';
import {
  formatReviewValue,
  rowConflicts,
  suggestionRows,
} from '@/lib/nutrition/product-extraction/review';

export function ProductSuggestionReview({
  suggestion,
  value,
  touched,
  onApply,
  disabled,
}: {
  suggestion: ProductSuggestion;
  value: ProductInput;
  touched: ReadonlySet<keyof ProductInput>;
  onApply: (patch: Partial<ProductInput>) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rows = suggestionRows(suggestion, value);
  const picked = rows.filter((row) => selected.includes(row.id));
  const conflict = picked.some((row) => rowConflicts(row, touched));
  const apply = () => {
    onApply(Object.assign({}, ...picked.map((row) => row.patch)));
    setDone(true);
  };
  return (
    <Stack gap="xs">
      <Text fw={600}>Review AI suggestions</Text>
      <Text size="sm">
        Compare with the photographs. Applying changes does not save the product.
      </Text>
      {suggestion.pipeline && <ProductPipelineEvidence pipeline={suggestion.pipeline} />}
      {suggestion.warnings.length > 0 && (
        <Alert color="yellow" title="Extraction warnings">
          {suggestion.warnings.map((warning, index) => (
            <Text size="sm" key={index}>
              {warning}
            </Text>
          ))}
        </Alert>
      )}
      {Object.entries(suggestion.nutrition).map(([key, field]) => (
        <Text size="xs" key={key}>
          {key}: {field.value ?? 'Missing'} · {field.status} · {field.note}
        </Text>
      ))}
      <details>
        <summary>Label evidence and ambiguities</summary>
        <Stack gap="xs">
          {(['name', 'brand', 'variant', 'description', 'ingredients'] as const).map((key) => {
            const field = suggestion.evidence[key];
            return (
              <Text size="sm" key={key}>
                {key}: {field.value ?? 'Missing'} · {field.status}
                {field.note && ` · ${field.note}`}
              </Text>
            );
          })}
          <Text size="sm">
            Package: {suggestion.evidence.package.quantity.value ?? 'Missing'}{' '}
            {suggestion.evidence.package.unit} · {suggestion.evidence.package.quantity.status} ·{' '}
            {suggestion.evidence.package.quantity.note}
          </Text>
          {suggestion.evidence.tables.map((table, index) => (
            <Paper withBorder p="xs" key={index}>
              <Text size="sm" fw={600}>
                {table.basis === 'per100'
                  ? 'Per 100'
                  : table.basis === 'serving'
                    ? `Per serving (${table.servingQuantity.value ?? 'unknown size'})`
                    : table.basis === 'referenceIntake'
                      ? 'Reference intake (%)'
                      : 'Unknown reference'}{' '}
                {table.unit?.toLowerCase()}
              </Text>
              <Text size="xs">{table.note}</Text>
              {table.values.map((field, fieldIndex) => (
                <Text size="xs" key={fieldIndex}>
                  {field.nutrient}: {field.value ?? 'Missing'} {field.unit} · {field.status} ·{' '}
                  {field.note}
                </Text>
              ))}
            </Paper>
          ))}
        </Stack>
      </details>
      {done ? (
        <Text role="status">Review finished. Continue editing, then Save product when ready.</Text>
      ) : (
        <>
          {rows.map((row) => (
            <Paper withBorder p="sm" key={row.id} style={{ overflowWrap: 'anywhere' }}>
              <Checkbox
                label={`${row.label}${rowConflicts(row, touched) ? ' · Manually edited / previously applied' : ''}`}
                checked={selected.includes(row.id)}
                disabled={disabled}
                onChange={(event) => {
                  setConfirm(false);
                  setSelected(
                    event.currentTarget.checked
                      ? [...selected, row.id]
                      : selected.filter((id) => id !== row.id)
                  );
                }}
              />
              {Object.entries(row.patch).map(([key, proposed]) => (
                <Stack gap={0} key={key} mt={4}>
                  <Text size="xs" fw={600}>
                    {key} ·{' '}
                    {value[key as keyof ProductInput] == null ||
                    value[key as keyof ProductInput] === ''
                      ? 'New'
                      : 'Changed'}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Current: {formatReviewValue(value[key as keyof ProductInput])}
                  </Text>
                  <Text size="xs">Proposed: {formatReviewValue(proposed)}</Text>
                </Stack>
              ))}
            </Paper>
          ))}
          <Group>
            <Button
              type="button"
              variant="light"
              disabled={disabled}
              onClick={() => {
                setConfirm(false);
                setSelected(rows.filter((row) => !rowConflicts(row, touched)).map((row) => row.id));
              }}
            >
              Select non-conflicting
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={disabled}
              onClick={() => setDone(true)}
            >
              Reject suggestions
            </Button>
            <Button
              type="button"
              disabled={disabled || !picked.length}
              onClick={() => (conflict ? setConfirm(true) : apply())}
            >
              Apply selected suggestions
            </Button>
          </Group>
          {confirm && (
            <Alert color="yellow" title="Replace edited values?">
              <Text size="sm">
                The selected changes replace manually edited or previously accepted fields. Review
                the current values above.
              </Text>
              <Button type="button" disabled={disabled} onClick={apply}>
                Confirm replacement
              </Button>
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}

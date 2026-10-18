'use client';

import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core';
import type { DiaryEntry } from '@/lib/nutrition/diary';
import type { NutritionProduct } from '@/lib/nutrition/products';
import { ProductEditor } from './ProductEditor';

export function RecipeFromMealDialog({
  entries,
  onClose,
  onSaved,
}: {
  entries: DiaryEntry[];
  onClose: () => void;
  onSaved: (product: NutritionProduct) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  if (reviewing) {
    return (
      <ProductEditor
        product={null}
        initialCalculationMode="CALCULATED"
        initialComponents={entries
          .filter((entry) => selected.includes(entry.id) && entry.productId)
          .map((entry) => ({
            childProductId: entry.productId!,
            quantity: entry.quantity,
            unit: entry.unit,
            ...(entry.servingId ? { servingId: entry.servingId } : {}),
          }))}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }
  return (
    <Modal opened onClose={onClose} title="Create recipe from meal">
      <Stack>
        <Text size="sm">
          Choose the foods to include, then review quantities and enter the prepared recipe yield.
          Recipes use current catalog definitions; check any changed servings.
        </Text>
        {entries.map((entry) => (
          <Checkbox
            key={entry.id}
            label={`${entry.productName} · ${entry.quantity} ${entry.unitLabel}${entry.productId ? '' : ' (product no longer available)'}`}
            disabled={!entry.productId}
            checked={selected.includes(entry.id)}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setSelected((current) =>
                checked ? [...current, entry.id] : current.filter((id) => id !== entry.id)
              );
            }}
          />
        ))}
        {selected.length > 40 && (
          <Text c="red" size="sm">
            Select at most 40 ingredients.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected.length || selected.length > 40}
            onClick={() => setReviewing(true)}
          >
            Review recipe
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

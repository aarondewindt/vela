'use client';

import { useState } from 'react';
import { Alert, Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import type { ProductInput } from '@/lib/nutrition/schema';
import type { ProductComponentInput } from '@/lib/nutrition/types';
import type { NutritionProduct } from '@/lib/nutrition/products';
import {
  defaultQuantity,
  quantityOptions,
  quantitySelection,
  selectedQuantity,
} from '@/lib/nutrition/quantity-options';
import { ProductPicker } from './ProductPicker';

function Ingredient({
  value,
  disabled,
  onChange,
  onRemove,
}: {
  value: ProductComponentInput;
  disabled: boolean;
  onChange: (value: ProductComponentInput) => void;
  onRemove: () => void;
}) {
  const [chosen, setChosen] = useState<NutritionProduct | null>(null);
  const source = trpc.nutrition.getProduct.useQuery(
    { id: value.childProductId },
    {
      enabled: Boolean(value.childProductId) && !chosen,
      retry: false,
    }
  );
  const product = chosen ?? source.data ?? null;
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <ProductPicker
          value={product}
          disabled={disabled}
          allowCreate={false}
          showSuggestions={false}
          onChange={(next) => {
            setChosen(next);
            const initial = defaultQuantity(next);
            onChange({
              childProductId: next.id,
              ...selectedQuantity(initial.quantity, initial.selection),
            });
          }}
        />
        {source.error && <Alert color="red">{source.error.message}</Alert>}
        <Group grow align="flex-end">
          <TextInput
            label="Ingredient quantity"
            inputMode="decimal"
            value={value.quantity}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, quantity: event.currentTarget.value })}
          />
          <Select
            label="Ingredient unit"
            allowDeselect={false}
            disabled={disabled || !product}
            data={product ? quantityOptions(product) : []}
            value={quantitySelection(value)}
            onChange={(selection) => {
              if (selection) {
                onChange({
                  childProductId: value.childProductId,
                  ...selectedQuantity(value.quantity, selection),
                });
              }
            }}
          />
        </Group>
        <Button variant="subtle" color="red" size="xs" disabled={disabled} onClick={onRemove}>
          Remove ingredient
        </Button>
      </Stack>
    </Paper>
  );
}

export function RecipeComponentsEditor({
  value,
  disabled,
  onChange,
}: {
  value: ProductInput;
  disabled: boolean;
  onChange: (patch: Partial<ProductInput>) => void;
}) {
  const components = value.components ?? [];
  return (
    <Stack gap="sm">
      <Text fw={600}>Recipe ingredients</Text>
      <Text size="sm" c="dimmed">
        Quantities describe the complete recipe. Ingredients may themselves be recipes.
      </Text>
      {components.map((component, index) => (
        <Ingredient
          key={`${index}:${component.childProductId}`}
          value={component}
          disabled={disabled}
          onChange={(next) =>
            onChange({
              components: components.map((entry, position) => (position === index ? next : entry)),
            })
          }
          onRemove={() =>
            onChange({ components: components.filter((_, position) => position !== index) })
          }
        />
      ))}
      <Button
        variant="light"
        disabled={disabled || components.length >= 40}
        onClick={() =>
          onChange({
            components: [...components, { childProductId: '', quantity: '1', unit: 'G' }],
          })
        }
      >
        Add ingredient
      </Button>
      <TextInput
        label="Prepared recipe yield"
        description="Total finished output, for example 4 portions or 800 g. Enter cooked weight explicitly."
        inputMode="decimal"
        required={value.calculationMode === 'CALCULATED'}
        value={value.yieldQuantity ?? ''}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            yieldQuantity: event.currentTarget.value || null,
            yieldUnit: event.currentTarget.value ? (value.yieldUnit ?? value.referenceUnit) : null,
          })
        }
      />
      <Select
        label="Prepared yield unit"
        value={value.yieldUnit ?? null}
        disabled={disabled}
        allowDeselect={false}
        data={[
          { value: 'G', label: 'Grams (g)' },
          { value: 'ML', label: 'Millilitres (ml)' },
          ...(value.referenceUnit === 'SERVING'
            ? [{ value: 'SERVING', label: value.referenceLabel || 'Named servings' }]
            : []),
        ]}
        onChange={(unit) => onChange({ yieldUnit: unit as ProductInput['yieldUnit'] })}
      />
    </Stack>
  );
}

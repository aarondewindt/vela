'use client';

import { useState } from 'react';
import {
  Alert,
  Badge,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { trpc } from '@/lib/trpc/client';
import { positiveDecimalSchema } from '@/lib/nutrition/schema';
import { unitLabels, type QuantityUnit } from '@/lib/nutrition/types';
import type { NutritionProduct } from '@/lib/nutrition/products';
import { NevoAttribution } from './NevoAttribution';
import { productSources } from '@/lib/nutrition/attribution';

export function ProductCalculator({
  product,
  onClose,
}: {
  product: NutritionProduct;
  onClose: () => void;
}) {
  const defaultServing = product.servings.find((serving) => serving.isDefault);
  const [quantity, setQuantity] = useState(defaultServing ? '1' : product.referenceQuantity);
  const [unit, setUnit] = useState(
    defaultServing ? `serving:${defaultServing.id}` : product.referenceUnit
  );
  const [debounced] = useDebouncedValue(quantity, 200);
  const servingId = unit.startsWith('serving:') ? unit.slice(8) : undefined;
  const valid = positiveDecimalSchema.safeParse(debounced).success;
  const preview = trpc.nutrition.calculateProduct.useQuery(
    {
      id: product.id,
      input: {
        quantity: debounced,
        unit: servingId ? 'SERVING' : (unit as QuantityUnit),
        ...(servingId ? { servingId } : {}),
      },
    },
    { enabled: valid, retry: false, gcTime: 0 }
  );
  const data = valid && quantity === debounced && !preview.error ? preview.data : undefined;
  const units = [
    'G',
    'KG',
    'ML',
    'L',
    ...(product.referenceUnit === 'SERVING' ? ['SERVING'] : []),
  ].map((value) => ({
    value,
    label:
      value === 'SERVING' ? product.referenceLabel || 'serving' : unitLabels[value as QuantityUnit],
  }));
  return (
    <Modal
      opened
      onClose={onClose}
      title={`Calculate · ${product.name}`}
      closeButtonProps={{ 'aria-label': 'Close nutrition calculator' }}
    >
      <Stack>
        <NevoAttribution sources={productSources(product)} />
        <Text size="sm" c="dimmed">
          Preview nutrition for this product using its saved values.
        </Text>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput
            label="Quantity"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.currentTarget.value)}
            error={
              !positiveDecimalSchema.safeParse(quantity).success
                ? 'Enter a positive decimal quantity.'
                : undefined
            }
          />
          <Select
            label="Unit"
            allowDeselect={false}
            value={unit}
            onChange={(value) => {
              if (value) {
                setUnit(value);
              }
            }}
            data={[
              ...units,
              ...product.servings.map((serving) => ({
                value: `serving:${serving.id}`,
                label: `${serving.name}${serving.isEstimated ? ' (estimated)' : ''}`,
              })),
            ]}
          />
        </SimpleGrid>
        {valid && (preview.isFetching || quantity !== debounced) && (
          <Group role="status">
            <Loader size="xs" />
            <Text size="sm">Calculating…</Text>
          </Group>
        )}
        {valid && preview.error && <Alert color="yellow">{preview.error.message}</Alert>}
        {data && (
          <>
            <Text size="xl" fw={700}>
              {data.nutrients.calories} kcal
            </Text>
            <SimpleGrid cols={2}>
              <Text>Protein: {data.nutrients.protein} g</Text>
              <Text>Carbs: {data.nutrients.carbohydrates} g</Text>
              <Text>Fat: {data.nutrients.fat} g</Text>
              <Text>
                Fiber: {data.nutrients.fiber === null ? 'unknown' : `${data.nutrients.fiber} g`}
              </Text>
            </SimpleGrid>
            {data.estimated && (
              <Badge color="yellow" variant="light">
                Uses an estimated conversion
              </Badge>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}

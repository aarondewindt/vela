'use client';

import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { trpc } from '@/lib/trpc/client';
import type { MealDraft } from '@/lib/nutrition/drafts';
import type { NutritionProduct } from '@/lib/nutrition/products';
import { positiveDecimalSchema, quantityInputSchema } from '@/lib/nutrition/schema';
import {
  quantityOptions,
  quantitySelection,
  selectedQuantity,
} from '@/lib/nutrition/quantity-options';
import { formatNutritionAmount } from '@/lib/nutrition/format';
import { ProductPicker } from './ProductPicker';
import { NevoAttribution } from './NevoAttribution';

export function DraftItemEditor({
  draft,
  item,
  onClose,
  onSaved,
}: {
  draft: MealDraft;
  item: MealDraft['items'][number];
  onClose: () => void;
  onSaved: (draft: MealDraft) => Promise<void>;
}) {
  const source = trpc.nutrition.getProduct.useQuery(
    { id: item.snapshot?.productId ?? '' },
    {
      enabled: Boolean(item.snapshot),
      retry: false,
      refetchOnMount: 'always',
    }
  );
  const [selected, setSelected] = useState<NutritionProduct | null>(null);
  const product =
    selected ?? (source.isFetchedAfterMount && !source.error ? (source.data ?? null) : null);
  const [quantity, setQuantity] = useState(item.quantity ?? '');
  const [unit, setUnit] = useState<string | null>(
    item.input ? quantitySelection(item.input) : null
  );
  const [debounced] = useDebouncedValue(quantity, 200);
  const input = selectedQuantity(debounced, unit ?? '');
  const valid = quantityInputSchema.safeParse(input).success;
  const preview = trpc.nutrition.calculateProduct.useQuery(
    { id: product?.id ?? '', input },
    {
      enabled: Boolean(product) && valid,
      retry: false,
      gcTime: 0,
    }
  );
  const save = trpc.nutrition.editDraft.useMutation({ retry: false });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal opened onClose={onClose} title={`Edit ${item.query}`} size="lg">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (save.isPending) {
            return;
          }
          if (quantity && !positiveDecimalSchema.safeParse(quantity).success) {
            setError('Enter a positive decimal quantity.');
            return;
          }
          try {
            const saved = await save.mutateAsync({
              id: draft.id,
              revision: draft.revision,
              change: {
                type: 'item',
                itemId: item.id,
                productId: product?.id ?? null,
                quantity: quantity || null,
                unit,
              },
            });
            await onSaved(saved);
            onClose();
          } catch {
            /* Mutation error stays visible; preserve unsaved input. */
          }
        }}
      >
        <Stack>
          <ProductPicker
            value={product}
            disabled={save.isPending}
            onChange={(next) => {
              setSelected(next);
              if (!unit || unit.startsWith('serving:')) {
                setUnit(next.referenceUnit);
              }
            }}
          />
          {source.error && !selected && (
            <Alert color="yellow">
              The selected food is unavailable. Choose an active product.
            </Alert>
          )}
          <Group grow align="flex-start">
            <TextInput
              label="Quantity"
              inputMode="decimal"
              value={quantity}
              maxLength={21}
              placeholder="Enter the amount you ate"
              onChange={(event) => setQuantity(event.currentTarget.value)}
            />
            <Select
              label="Unit"
              placeholder="Choose a unit"
              value={unit}
              onChange={setUnit}
              data={product ? quantityOptions(product) : []}
              disabled={!product}
            />
          </Group>
          {preview.error && valid && <Alert color="yellow">{preview.error.message}</Alert>}
          {product && (
            <NevoAttribution
              sources={[{ name: product.sourceName, version: product.sourceVersion }]}
            />
          )}
          {valid && quantity === debounced && preview.data && !preview.error && (
            <Text>
              {formatNutritionAmount(preview.data.nutrients.calories)} kcal
              {preview.data.estimated ? ' · Estimated conversion' : ''}
            </Text>
          )}
          {error && <Alert color="red">{error}</Alert>}
          {save.error && <Alert color="red">{save.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={save.isPending}
              disabled={Boolean(item.snapshot) && !selected && source.isFetching}
            >
              Save draft food
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

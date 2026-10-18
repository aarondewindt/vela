'use client';

import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
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
import type { DiaryEntry } from '@/lib/nutrition/diary';
import type { NutritionProduct } from '@/lib/nutrition/products';
import { diaryDateSchema } from '@/lib/nutrition/dates';
import { quantityInputSchema } from '@/lib/nutrition/schema';
import { mealCategories, mealLabels, type MealCategory } from '@/lib/nutrition/types';
import {
  defaultQuantity,
  quantityOptions,
  quantitySelection,
  selectedQuantity,
} from '@/lib/nutrition/quantity-options';
import { ProductPicker } from './ProductPicker';
import { NevoAttribution } from './NevoAttribution';

export function LogEntryEditor({
  entry,
  date,
  mealCategory,
  onClose,
  onSaved,
}: {
  entry: DiaryEntry | null;
  date: string;
  mealCategory: MealCategory;
  onClose: () => void;
  onSaved: (entry: DiaryEntry) => Promise<void>;
}) {
  const utils = trpc.useUtils();
  const [product, setProduct] = useState<NutritionProduct | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [logDate, setLogDate] = useState(entry?.logDate ?? date);
  const [meal, setMeal] = useState(entry?.mealCategory ?? mealCategory);
  const [quantity, setQuantity] = useState(entry?.quantity ?? '1');
  const [selection, setSelection] = useState(
    entry
      ? quantitySelection({
          quantity: entry.quantity,
          unit: entry.unit,
          ...(entry.servingId ? { servingId: entry.servingId } : {}),
        })
      : 'G'
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(quantity, 200);
  const input = selectedQuantity(debounced, selection);
  const valid = quantityInputSchema.safeParse(input).success;
  const savedPreview = trpc.nutrition.previewLogEntry.useQuery(
    { id: entry?.id ?? '', input },
    { enabled: Boolean(entry) && valid, retry: false, gcTime: 0 }
  );
  const productPreview = trpc.nutrition.calculateProduct.useQuery(
    { id: product?.id ?? '', input },
    { enabled: Boolean(product) && !entry && valid, retry: false, gcTime: 0 }
  );
  const preview = entry ? savedPreview : productPreview;
  const definition = entry?.snapshot.definition ?? product;
  const data = valid && quantity === debounced && !preview.error ? preview.data : undefined;
  const sourceChanged =
    !entry &&
    product &&
    productPreview.data &&
    productPreview.data.productVersion !== product.version;
  const create = trpc.nutrition.createLogEntry.useMutation({ retry: false });
  const update = trpc.nutrition.updateLogEntry.useMutation({ retry: false });
  const busy = create.isPending || update.isPending;
  const failure = create.error ?? update.error;
  const choose = (next: NutritionProduct) => {
    const initial = defaultQuantity(next);
    setProduct(next);
    setQuantity(initial.quantity);
    setSelection(initial.selection);
    setFormError(null);
    create.reset();
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const parsed = quantityInputSchema.safeParse(selectedQuantity(quantity, selection));
    if (!parsed.success || !diaryDateSchema.safeParse(logDate).success || (!entry && !product)) {
      setFormError('Choose a food, valid calendar date and positive quantity.');
      return;
    }
    setFormError(null);
    let saved: DiaryEntry;
    try {
      if (entry) {
        saved = await update.mutateAsync({
          id: entry.id,
          version: entry.version,
          logDate,
          mealCategory: meal,
          input: parsed.data,
        });
      } else if (product) {
        saved = await create.mutateAsync({
          requestId,
          productId: product.id,
          productVersion: product.version,
          logDate,
          mealCategory: meal,
          input: parsed.data,
        });
      } else {
        return;
      }
    } catch {
      return;
    } // Keep inputs; the mutation error is displayed below.
    await onSaved(saved);
    onClose();
  };
  const refreshProduct = async () => {
    try {
      if (product) {
        const refreshed = await utils.nutrition.getProduct.fetch({ id: product.id });
        if (refreshed.archivedAt) {
          setProduct(null);
          setFormError('This product is archived. Choose an active product.');
          return;
        }
        setProduct(refreshed);
        setFormError(null);
        create.reset();
        await productPreview.refetch();
      }
    } catch {
      setFormError('Could not refresh this product. Check your connection and try again.');
    }
  };

  return (
    <Modal
      opened
      size="md"
      title={entry ? 'Edit food entry' : `Add food · ${mealLabels[meal]}`}
      closeButtonProps={{ 'aria-label': 'Close food entry editor' }}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <form onSubmit={(event) => void save(event)}>
        <Stack>
          {entry ? (
            <>
              <Text fw={600}>{entry.productName}</Text>
              <Text size="sm" c="dimmed">
                Quantity and unit changes use the nutrition and conversions saved with this entry.
              </Text>
            </>
          ) : (
            <ProductPicker value={product} disabled={busy} onChange={choose} />
          )}
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput
              type="date"
              label="Date eaten"
              required
              min="0001-01-01"
              max="9999-12-31"
              value={logDate}
              disabled={busy}
              onChange={(event) => setLogDate(event.currentTarget.value)}
            />
            <Select
              label="Meal"
              allowDeselect={false}
              data={mealCategories.map((value) => ({ value, label: mealLabels[value] }))}
              value={meal}
              disabled={busy}
              onChange={(value) => {
                if (value) {
                  setMeal(value as MealCategory);
                }
              }}
            />
          </SimpleGrid>
          {definition && (
            <>
              <NevoAttribution
                sources={
                  entry
                    ? [entry.snapshot.source]
                    : product
                      ? [{ name: product.sourceName, version: product.sourceVersion }]
                      : []
                }
              />
              <SimpleGrid cols={{ base: 1, xs: 2 }}>
                <TextInput
                  label="Quantity eaten"
                  required
                  inputMode="decimal"
                  value={quantity}
                  disabled={busy}
                  onChange={(event) => setQuantity(event.currentTarget.value)}
                />
                <Select
                  label="Quantity unit"
                  allowDeselect={false}
                  data={quantityOptions(definition)}
                  value={selection}
                  disabled={busy}
                  onChange={(value) => {
                    if (value) {
                      setSelection(value);
                    }
                  }}
                />
              </SimpleGrid>
              {(!valid || !diaryDateSchema.safeParse(logDate).success) && (
                <Text size="sm" c="red">
                  Enter a positive decimal quantity and a valid date.
                </Text>
              )}
              {(preview.isFetching || quantity !== debounced) && (
                <Group role="status">
                  <Loader size="xs" />
                  <Text size="sm">Calculating nutrition…</Text>
                </Group>
              )}
              {preview.error && <Alert color="yellow">{preview.error.message}</Alert>}
              {sourceChanged && (
                <Alert color="yellow">
                  The selected product changed. Refresh it and review the updated nutrition.
                  <Button variant="subtle" onClick={() => void refreshProduct()}>
                    Refresh selected product
                  </Button>
                </Alert>
              )}
              {data && (
                <>
                  <Text size="xl" fw={700}>
                    {data.nutrients.calories} kcal
                  </Text>
                  <Text size="sm">
                    Protein {data.nutrients.protein} g · Carbs {data.nutrients.carbohydrates} g ·
                    Fat {data.nutrients.fat} g
                  </Text>
                  {data.estimated && (
                    <Badge variant="light" color="yellow">
                      Estimated conversion
                    </Badge>
                  )}
                </>
              )}
            </>
          )}
          {formError && <Alert color="red">{formError}</Alert>}
          {failure && (
            <Alert color="red" title="Could not save food entry">
              {failure.message}
              {!entry && product && (
                <Button variant="subtle" onClick={() => void refreshProduct()}>
                  Refresh selected product
                </Button>
              )}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={!data || Boolean(sourceChanged) || Boolean(preview.error)}
            >
              Save food entry
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

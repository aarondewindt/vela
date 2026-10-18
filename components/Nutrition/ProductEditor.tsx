'use client';

import { useState } from 'react';
import {
  Accordion,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { productInputSchema, type ProductInput } from '@/lib/nutrition/schema';
import { unitLabels, verificationStatuses } from '@/lib/nutrition/types';
import type { NutritionProduct } from '@/lib/nutrition/products';
import { ServingEditor } from './ServingEditor';

const emptyProduct: ProductInput = {
  name: '',
  brand: null,
  description: null,
  aliases: [],
  calculationMode: 'DIRECT',
  referenceQuantity: '100',
  referenceUnit: 'G',
  referenceLabel: null,
  calories: '',
  protein: '',
  carbohydrates: '',
  fat: '',
  fiber: null,
  servingSizeQuantity: null,
  servingSizeUnit: null,
  servingSizeIsEstimated: false,
  densityGramsPerMl: null,
  densityIsEstimated: false,
  verificationStatus: 'UNVERIFIED',
  servings: [],
};
const nutrientLabels = {
  calories: 'Calories (kcal)',
  protein: 'Protein (g)',
  carbohydrates: 'Carbohydrates (g)',
  fat: 'Fat (g)',
  fiber: 'Fiber (g, optional)',
};

export function ProductEditor({
  product,
  onClose,
  onSaved,
}: {
  product: NutritionProduct | null;
  onClose: () => void;
  onSaved: (product: NutritionProduct) => Promise<void>;
}) {
  const [value, setValue] = useState<ProductInput>(() =>
    product ? productInputSchema.parse(product) : emptyProduct
  );
  const [errors, setErrors] = useState<string[]>([]);
  const create = trpc.nutrition.createProduct.useMutation();
  const update = trpc.nutrition.updateProduct.useMutation();
  const busy = create.isPending || update.isPending;
  const failure = create.error ?? update.error;
  const change = (patch: Partial<ProductInput>) =>
    setValue((current) => ({ ...current, ...patch }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) {
      return;
    }
    const parsed = productInputSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
      return;
    }
    setErrors([]);
    let saved: NutritionProduct;
    try {
      if (product) {
        saved = await update.mutateAsync({
          id: product.id,
          version: product.version,
          product: parsed.data,
        });
      } else {
        saved = await create.mutateAsync(parsed.data);
      }
    } catch {
      // The mutation error is rendered below; keep the entered form intact.
      return;
    }
    await onSaved(saved);
    onClose();
  };

  return (
    <Modal
      opened
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      title={product ? 'Edit food product' : 'Create food product'}
      closeButtonProps={{ 'aria-label': 'Close product editor' }}
      size="lg"
    >
      <form onSubmit={(event) => void save(event)}>
        <Stack gap="lg">
          <TextInput
            label="Product name"
            placeholder="Peanut butter"
            required
            maxLength={240}
            value={value.name}
            disabled={busy}
            onChange={(event) => change({ name: event.currentTarget.value })}
          />
          <TextInput
            label="Brand (optional)"
            value={value.brand ?? ''}
            disabled={busy}
            onChange={(event) => change({ brand: event.currentTarget.value || null })}
          />
          <TagsInput
            label="Aliases"
            description="Other names you use when searching, such as PB or pindakaas."
            value={value.aliases}
            disabled={busy}
            onChange={(aliases) => change({ aliases })}
          />
          <Stack gap="sm">
            <Title order={4}>Nutrition reference</Title>
            <SimpleGrid cols={{ base: 1, xs: 2 }}>
              <TextInput
                label="Reference quantity"
                required
                inputMode="decimal"
                value={value.referenceQuantity}
                disabled={busy}
                onChange={(event) => change({ referenceQuantity: event.currentTarget.value })}
              />
              <Select
                label="Reference unit"
                allowDeselect={false}
                value={value.referenceUnit}
                disabled={busy}
                data={[
                  { value: 'G', label: 'Grams (g)' },
                  { value: 'ML', label: 'Millilitres (ml)' },
                  { value: 'SERVING', label: 'Named serving' },
                ]}
                onChange={(unit) => {
                  if (!unit) {
                    return;
                  }
                  change({
                    referenceUnit: unit as ProductInput['referenceUnit'],
                    referenceQuantity: unit === 'SERVING' ? '1' : '100',
                    referenceLabel: null,
                    servingSizeQuantity: null,
                    servingSizeUnit: null,
                    servingSizeIsEstimated: false,
                  });
                }}
              />
            </SimpleGrid>
            {value.referenceUnit === 'SERVING' && (
              <TextInput
                label="Nutrition serving name"
                placeholder="bar, bowl, portion…"
                required
                value={value.referenceLabel ?? ''}
                disabled={busy}
                onChange={(event) => change({ referenceLabel: event.currentTarget.value || null })}
              />
            )}
            <Text size="sm" c="dimmed">
              Enter the package or recipe values for {value.referenceQuantity || '…'}{' '}
              {value.referenceUnit === 'SERVING'
                ? value.referenceLabel || 'named serving'
                : unitLabels[value.referenceUnit]}
              .
            </Text>
            <SimpleGrid cols={{ base: 1, xs: 2 }}>
              {(Object.keys(nutrientLabels) as (keyof typeof nutrientLabels)[]).map((key) => (
                <TextInput
                  key={key}
                  label={nutrientLabels[key]}
                  required={key !== 'fiber'}
                  inputMode="decimal"
                  value={value[key] ?? ''}
                  disabled={busy}
                  onChange={(event) =>
                    change({
                      [key]:
                        key === 'fiber'
                          ? event.currentTarget.value || null
                          : event.currentTarget.value,
                    })
                  }
                />
              ))}
            </SimpleGrid>
          </Stack>
          <Stack gap="sm">
            <Group justify="space-between">
              <Title order={4}>Servings</Title>
              <Button
                variant="light"
                size="xs"
                disabled={busy || value.servings.length >= 40}
                onClick={() =>
                  change({
                    servings: [
                      ...value.servings,
                      {
                        name: '',
                        aliases: [],
                        quantity: '',
                        canonicalUnit: value.referenceUnit,
                        isDefault: value.servings.length === 0,
                        isEstimated: false,
                      },
                    ],
                  })
                }
              >
                Add serving
              </Button>
            </Group>
            <Text size="sm" c="dimmed">
              Define your own pieces, slices, spoons or portions. For example, one tablespoon = 15
              g. Conversions apply only to this product.
            </Text>
            {value.servings.map((serving, index) => (
              <ServingEditor
                key={serving.id ?? index}
                value={serving}
                index={index}
                servingBased={value.referenceUnit === 'SERVING'}
                disabled={busy}
                onChange={(next) =>
                  change({
                    servings: value.servings.map((entry, position) =>
                      position === index
                        ? next
                        : next.isDefault
                          ? { ...entry, isDefault: false }
                          : entry
                    ),
                  })
                }
                onRemove={() =>
                  change({ servings: value.servings.filter((_, position) => position !== index) })
                }
              />
            ))}
          </Stack>
          <Accordion variant="separated" multiple>
            <Accordion.Item value="conversions">
              <Accordion.Control>Physical conversions (optional)</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Text size="sm" c="dimmed">
                    Weight and volume need a known density to convert. Leave unknown values empty.
                  </Text>
                  <TextInput
                    label="Density (g per ml)"
                    inputMode="decimal"
                    value={value.densityGramsPerMl ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      change({
                        densityGramsPerMl: event.currentTarget.value || null,
                        densityIsEstimated: event.currentTarget.value
                          ? value.densityIsEstimated
                          : false,
                      })
                    }
                  />
                  <Checkbox
                    label="Density is estimated"
                    checked={value.densityIsEstimated}
                    disabled={busy || !value.densityGramsPerMl}
                    onChange={(event) =>
                      change({ densityIsEstimated: event.currentTarget.checked })
                    }
                  />
                  {value.referenceUnit === 'SERVING' && (
                    <>
                      <Text size="sm">
                        Physical size of one {value.referenceLabel || 'nutrition serving'}
                      </Text>
                      <SimpleGrid cols={{ base: 1, xs: 2 }}>
                        <TextInput
                          label="Serving size"
                          inputMode="decimal"
                          value={value.servingSizeQuantity ?? ''}
                          disabled={busy}
                          onChange={(event) =>
                            change({
                              servingSizeQuantity: event.currentTarget.value || null,
                              servingSizeUnit: event.currentTarget.value
                                ? (value.servingSizeUnit ?? 'G')
                                : null,
                              servingSizeIsEstimated: event.currentTarget.value
                                ? value.servingSizeIsEstimated
                                : false,
                            })
                          }
                        />
                        <Select
                          label="Serving size unit"
                          data={[
                            { value: 'G', label: 'g' },
                            { value: 'ML', label: 'ml' },
                          ]}
                          value={value.servingSizeUnit}
                          disabled={busy}
                          onChange={(unit) =>
                            change({ servingSizeUnit: unit as 'G' | 'ML' | null })
                          }
                        />
                      </SimpleGrid>
                      <Checkbox
                        label="Physical serving size is estimated"
                        checked={value.servingSizeIsEstimated}
                        disabled={busy || !value.servingSizeQuantity}
                        onChange={(event) =>
                          change({ servingSizeIsEstimated: event.currentTarget.checked })
                        }
                      />
                    </>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="details">
              <Accordion.Control>Description, source and verification</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Textarea
                    label="Description"
                    value={value.description ?? ''}
                    disabled={busy}
                    onChange={(event) => change({ description: event.currentTarget.value || null })}
                  />
                  <Text size="sm">
                    Source: {product?.sourceType ?? 'MANUAL'}
                    {product?.sourceName ? ` · ${product.sourceName}` : ''}
                  </Text>
                  {product?.sourceRecordId && (
                    <Text size="sm">
                      Source record: {product.sourceRecordId}
                      {product.sourceVersion ? ` · version ${product.sourceVersion}` : ''}
                    </Text>
                  )}
                  {product?.importedAt && (
                    <Text size="sm">Imported: {product.importedAt.toLocaleDateString()}</Text>
                  )}
                  {product?.userModifiedAt && product.sourceType !== 'MANUAL' && (
                    <Text size="sm">Contains manual edits to source data.</Text>
                  )}
                  <Select
                    label="Verification"
                    allowDeselect={false}
                    value={value.verificationStatus}
                    data={verificationStatuses.map((status) => ({
                      value: status,
                      label: status[0] + status.slice(1).toLowerCase(),
                    }))}
                    disabled={busy}
                    onChange={(status) => {
                      if (status) {
                        change({
                          verificationStatus: status as ProductInput['verificationStatus'],
                        });
                      }
                    }}
                  />
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
          {errors.length > 0 && (
            <Alert color="red" title="Check product details">
              <Stack gap={4}>
                {errors.map((error) => (
                  <Text key={error} size="sm">
                    {error}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}
          {failure && (
            <Alert color="red" title="Could not save product">
              {failure.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save product
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

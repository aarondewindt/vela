'use client';

import { useState } from 'react';
import { Alert, Button, Loader, Select, Stack, Switch, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { trpc } from '@/lib/trpc/client';
import type { NutritionProduct } from '@/lib/nutrition/products';
import { ProductEditor } from './ProductEditor';
import { ProductSuggestions } from './ProductSuggestions';

export function ProductPicker({
  value,
  disabled,
  onChange,
  allowCreate = true,
  showSuggestions = true,
  relatedByDefault = false,
}: {
  value: NutritionProduct | null;
  disabled: boolean;
  onChange: (product: NutritionProduct) => void;
  allowCreate?: boolean;
  showSuggestions?: boolean;
  relatedByDefault?: boolean;
}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [query] = useDebouncedValue(search, 200);
  const [create, setCreate] = useState(false);
  const [related, setRelated] = useState(relatedByDefault);
  const products = trpc.nutrition.searchProducts.useQuery(
    {
      query,
      semantic: related,
      ranking: relatedByDefault ? 'related-first' : 'text-first',
      limit: 30,
    },
    { retry: false, refetchOnMount: 'always' }
  );
  const current =
    products.isFetchedAfterMount && !products.error
      ? (products.data?.matches.map((match) => match.product) ?? [])
      : [];
  const options =
    value && !current.some((entry) => entry.id === value.id) ? [value, ...current] : current;
  return (
    <Stack gap="xs">
      {showSuggestions && <ProductSuggestions disabled={disabled} onChange={onChange} />}
      <Select
        label="Food product"
        placeholder="Search by name, alias or brand"
        searchable
        clearable={false}
        allowDeselect={false}
        disabled={disabled}
        value={value?.id ?? null}
        searchValue={search}
        onSearchChange={setSearch}
        filter={({ options: entries }) => entries}
        nothingFoundMessage="No matching products"
        rightSection={products.isFetching ? <Loader size="xs" /> : undefined}
        data={options.map((product) => ({
          value: product.id,
          label: `${product.name}${product.brand ? ` · ${product.brand}` : ''}${products.data?.matches.find((match) => match.id === product.id)?.kind === 'semantic' ? ' · Related food' : ''}`,
        }))}
        onChange={(id) => {
          const product = options.find((entry) => entry.id === id);
          if (product) {
            onChange(product);
          }
        }}
      />
      <Switch
        label="Include related foods"
        checked={related}
        disabled={disabled}
        onChange={(event) => setRelated(event.currentTarget.checked)}
      />
      {related && query.trim() && (
        <Text size="xs" c="dimmed">
          Related foods are suggestions. Choose the product you mean.
        </Text>
      )}
      {products.data?.notice && <Alert color="yellow">{products.data.notice}</Alert>}
      {products.error && (
        <Alert color="red">
          <Text size="sm">{products.error.message}</Text>
          <Button variant="subtle" size="xs" onClick={() => void products.refetch()}>
            Retry search
          </Button>
        </Alert>
      )}
      {allowCreate && (
        <Button variant="subtle" size="xs" disabled={disabled} onClick={() => setCreate(true)}>
          Create a new food product
        </Button>
      )}
      {create && (
        <ProductEditor
          product={null}
          onClose={() => setCreate(false)}
          onSaved={async (product) => {
            await utils.nutrition.invalidate();
            onChange(product);
          }}
        />
      )}
    </Stack>
  );
}

'use client';

import { useState } from 'react';
import { Alert, Button, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import type { NutritionProduct } from '@/lib/nutrition/products';

export function ProductSuggestions({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange: (product: NutritionProduct) => void;
}) {
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<'recent' | 'frequent'>('recent');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suggestions = trpc.nutrition.productSuggestions.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  return (
    <Stack gap="xs">
      <SegmentedControl
        size="xs"
        value={mode}
        data={[
          { value: 'recent', label: 'Recent foods' },
          { value: 'frequent', label: 'Frequent foods' },
        ]}
        onChange={(value) => setMode(value as typeof mode)}
      />
      {suggestions.isPending && (
        <Text size="xs" role="status">
          Loading foods…
        </Text>
      )}
      {suggestions.error && (
        <Button size="xs" variant="subtle" onClick={() => void suggestions.refetch()}>
          Retry recent foods
        </Button>
      )}
      {suggestions.data?.[mode].length === 0 && (
        <Text size="xs" c="dimmed">
          Foods you log will appear here.
        </Text>
      )}
      <Group gap="xs">
        {suggestions.data?.[mode].map((product) => (
          <Button
            key={product.id}
            size="compact-sm"
            variant="default"
            disabled={disabled || Boolean(loading)}
            loading={loading === product.id}
            onClick={async () => {
              setLoading(product.id);
              setError(null);
              try {
                const current = await utils.nutrition.getProduct.fetch({ id: product.id });
                if (current.archivedAt) {
                  setError('This food is archived. Choose another product.');
                } else {
                  onChange(current);
                }
              } catch {
                setError('Could not load this food. Please retry.');
              } finally {
                setLoading(null);
              }
            }}
          >
            {product.name}
            {product.brand ? ` · ${product.brand}` : ''}
          </Button>
        ))}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
  );
}

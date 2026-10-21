'use client';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Loader,
  Pagination,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { formatNutritionAmount as amount } from '@/lib/nutrition/format';
import { trpc } from '@/lib/trpc/client';
import { useNutritionProductsStore } from '@/store/nutrition_products_store';
import { unitLabels } from '@/lib/nutrition/types';
import type { NutritionProduct } from '@/lib/nutrition/products';
import { ProductEditor } from './ProductEditor';
import { ProductCalculator } from './ProductCalculator';
import { NevoImporter } from './NevoImporter';
import { NevoAttribution } from './NevoAttribution';
import { productSources } from '@/lib/nutrition/attribution';
import classes from './ProductsView.module.css';

const pageSize = 20;

export function ProductsView() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [query] = useDebouncedValue(search, 200);
  const [archived, setArchived] = useState(false);
  const fuzzySearch = useNutritionProductsStore((state) => state.fuzzySearch);
  const setFuzzySearch = useNutritionProductsStore((state) => state.setFuzzySearch);
  useEffect(() => {
    void useNutritionProductsStore.persist.rehydrate();
  }, []);
  const hybrid = fuzzySearch && Boolean(query.trim()) && !archived;
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{
    product: NutritionProduct | null;
    initialCalculationMode?: 'DIRECT' | 'CALCULATED';
  } | null>(null);
  const [calculator, setCalculator] = useState<NutritionProduct | null>(null);
  const [importing, setImporting] = useState(false);
  const products = trpc.nutrition.listProducts.useQuery(
    { query, archived, limit: pageSize, offset: (page - 1) * pageSize },
    { retry: false, refetchOnMount: 'always', enabled: !hybrid }
  );
  const relatedProducts = trpc.nutrition.searchProducts.useQuery(
    { query, limit: 50, semantic: true },
    { retry: false, refetchOnMount: 'always', enabled: hybrid }
  );
  const activeQuery = hybrid ? relatedProducts : products;
  const current = hybrid
    ? relatedProducts.isFetchedAfterMount && !relatedProducts.error && relatedProducts.data
      ? {
          products: relatedProducts.data.matches.map((match) => match.product),
          total: relatedProducts.data.matches.length,
        }
      : undefined
    : products.isFetchedAfterMount && !products.error
      ? products.data
      : undefined;
  const matchKind = new Map(relatedProducts.data?.matches.map((match) => [match.id, match.kind]));
  const refresh = () => utils.nutrition.invalidate();
  const archive = trpc.nutrition.setProductArchived.useMutation({
    onSuccess: async () => {
      setPage(1);
      await refresh();
    },
  });

  const changeArchive = (product: NutritionProduct) => {
    if (product.archivedAt) {
      archive.mutate({ id: product.id, version: product.version, archived: false });
      return;
    }
    modals.openConfirmModal({
      title: `Archive ${product.name}?`,
      children: (
        <Text>
          Archived products are hidden from your active catalog. You can restore them from Archived
          products.
        </Text>
      ),
      labels: { confirm: 'Archive product', cancel: 'Cancel' },
      onConfirm: () => archive.mutate({ id: product.id, version: product.version, archived: true }),
    });
  };

  const actions = (product: NutritionProduct) => (
    <Group gap="xs" wrap="nowrap">
      {!archived && (
        <Button size="xs" variant="light" onClick={() => setEditor({ product })}>
          Edit
        </Button>
      )}
      <Button size="xs" variant="default" onClick={() => setCalculator(product)}>
        Calculate
      </Button>
      <Button
        size="xs"
        variant="subtle"
        disabled={archive.isPending}
        onClick={() => changeArchive(product)}
      >
        {archived ? 'Restore' : 'Archive'}
      </Button>
    </Group>
  );

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={2}>Food products</Title>
            <Text c="dimmed" mt={4}>
              Your reusable foods and recipes. Recipes can contain foods and other recipes.
            </Text>
          </div>
          <Group gap="sm">
            <Button variant="default" onClick={() => setImporting(true)}>
              Upload NEVO dataset
            </Button>
            <Button onClick={() => setEditor({ product: null })}>Create product</Button>
            <Button
              variant="light"
              onClick={() => setEditor({ product: null, initialCalculationMode: 'CALCULATED' })}
            >
              Create recipe
            </Button>
          </Group>
        </Group>
        <Button component={Link} href="/settings/nutrition#related-food-search" variant="subtle">
          Related-food search settings
        </Button>
        <Group align="flex-end">
          <TextInput
            className={classes.search}
            label="Search products"
            placeholder={
              fuzzySearch && !archived
                ? 'Describe a food or search by name'
                : 'Name, alias, brand or description'
            }
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            maxLength={240}
          />
          <Switch
            label="Fuzzy search"
            description="Include related foods using embeddings"
            checked={fuzzySearch}
            disabled={archived}
            onChange={(event) => {
              setFuzzySearch(event.currentTarget.checked);
              setPage(1);
            }}
          />
          <Switch
            label="Archived products"
            checked={archived}
            onChange={(event) => {
              setArchived(event.currentTarget.checked);
              setPage(1);
            }}
          />
        </Group>
        {hybrid && relatedProducts.data?.notice && (
          <Alert color="yellow">{relatedProducts.data.notice}</Alert>
        )}
        {hybrid && (
          <Text size="sm" c="dimmed">
            Up to 50 matches. Exact names and aliases appear first; related foods are suggestions to
            review.
          </Text>
        )}
        {activeQuery.error && (
          <Alert color="red" title="Could not load products">
            <Stack gap="xs">
              <Text>{activeQuery.error.message}</Text>
              <Button variant="light" onClick={() => void activeQuery.refetch()}>
                Retry loading products
              </Button>
            </Stack>
          </Alert>
        )}
        {!current && !activeQuery.error && (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading products…</Text>
          </Group>
        )}
        {archive.error && (
          <Alert color="red" title="Could not update product">
            {archive.error.message}
          </Alert>
        )}
        {current && (
          <>
            <Text size="sm" c="dimmed">
              {current.total} {archived ? 'archived ' : ''}product{current.total === 1 ? '' : 's'}
              {hybrid ? ' shown' : ''}
              {activeQuery.isFetching ? ' · Updating…' : ''}
            </Text>
            <NevoAttribution sources={current.products.flatMap(productSources)} />
            {current.products.length === 0 && (
              <Paper withBorder p="xl" radius="md">
                <Stack align="center">
                  <Title order={3}>
                    {query
                      ? 'No matching products'
                      : archived
                        ? 'No archived products'
                        : 'Start your food collection'}
                  </Title>
                  <Text c="dimmed" ta="center">
                    {query
                      ? 'Try another name, alias or brand.'
                      : archived
                        ? 'Products you archive will appear here.'
                        : 'Create a product from a nutrition label, then add the serving sizes you use.'}
                  </Text>
                  {!archived && !query && (
                    <Button variant="light" onClick={() => setEditor({ product: null })}>
                      Create your first product
                    </Button>
                  )}
                </Stack>
              </Paper>
            )}
            {current.products.length > 0 && (
              <Table.ScrollContainer minWidth={900} visibleFrom="md">
                <Table highlightOnHover verticalSpacing="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Product</Table.Th>
                      <Table.Th>Reference</Table.Th>
                      <Table.Th>Calories</Table.Th>
                      <Table.Th>Macros (g)</Table.Th>
                      <Table.Th>Servings</Table.Th>
                      <Table.Th>Verification</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {current.products.map((product) => (
                      <Table.Tr key={product.id}>
                        <Table.Td>
                          <Text className={classes.productName} fw={600}>
                            {product.name}
                          </Text>
                          {product.calculationMode === 'CALCULATED' && (
                            <Badge size="xs" variant="light" color="teal">
                              Recipe · {product.components.length} ingredients
                            </Badge>
                          )}
                          {hybrid && matchKind.get(product.id) === 'semantic' && (
                            <Badge size="xs" variant="light">
                              Related food
                            </Badge>
                          )}
                          <Text size="xs" c="dimmed">
                            {[product.brand, ...product.aliases].filter(Boolean).join(' · ')}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {product.referenceQuantity}{' '}
                          {product.referenceUnit === 'SERVING'
                            ? product.referenceLabel
                            : unitLabels[product.referenceUnit]}
                        </Table.Td>
                        <Table.Td>{amount(product.calories)} kcal</Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            P {amount(product.protein)} · C {amount(product.carbohydrates)} · F{' '}
                            {amount(product.fat)}
                          </Text>
                        </Table.Td>
                        <Table.Td>{product.servings.length}</Table.Td>
                        <Table.Td>
                          <Text size="sm">{product.verificationStatus.toLowerCase()}</Text>
                          <Text size="xs" c="dimmed">
                            {product.sourceName ||
                              (product.sourceType === 'MANUAL'
                                ? 'Manual'
                                : product.sourceType.toLowerCase())}
                          </Text>
                        </Table.Td>
                        <Table.Td>{actions(product)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            <Box hiddenFrom="md" className={classes.productGrid}>
              {current.products.map((product) => (
                <Paper key={product.id} withBorder p="md" radius="md">
                  <Stack gap="sm">
                    <div>
                      <Text className={classes.productName} fw={600} size="lg">
                        {product.name}
                      </Text>
                      {product.calculationMode === 'CALCULATED' && (
                        <Badge size="xs" variant="light" color="teal">
                          Recipe · {product.components.length} ingredients
                        </Badge>
                      )}
                      {hybrid && matchKind.get(product.id) === 'semantic' && (
                        <Badge size="xs" variant="light">
                          Related food
                        </Badge>
                      )}
                      {product.brand && (
                        <Text size="sm" c="dimmed">
                          {product.brand}
                        </Text>
                      )}
                    </div>
                    <Group gap="xs">
                      <Badge
                        variant="light"
                        color={
                          product.verificationStatus === 'VERIFIED'
                            ? 'teal'
                            : product.verificationStatus === 'ESTIMATED'
                              ? 'yellow'
                              : 'gray'
                        }
                      >
                        {product.verificationStatus.toLowerCase()}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {product.sourceName ||
                          (product.sourceType === 'MANUAL'
                            ? 'Manual'
                            : product.sourceType.toLowerCase())}
                      </Text>
                    </Group>
                    <Text size="sm" c="dimmed">
                      Per {product.referenceQuantity}{' '}
                      {product.referenceUnit === 'SERVING'
                        ? product.referenceLabel
                        : unitLabels[product.referenceUnit]}
                    </Text>
                    <Text size="xl" fw={700}>
                      {amount(product.calories)} kcal
                    </Text>
                    <SimpleGrid cols={3} spacing="xs">
                      <Text size="sm">
                        Protein
                        <br />
                        <b>{amount(product.protein)} g</b>
                      </Text>
                      <Text size="sm">
                        Carbs
                        <br />
                        <b>{amount(product.carbohydrates)} g</b>
                      </Text>
                      <Text size="sm">
                        Fat
                        <br />
                        <b>{amount(product.fat)} g</b>
                      </Text>
                    </SimpleGrid>
                    {product.fiber !== null && (
                      <Text size="sm">Fiber: {amount(product.fiber)} g</Text>
                    )}
                    <Text size="xs" c="dimmed">
                      {product.servings.length} serving{product.servings.length === 1 ? '' : 's'}
                      {product.aliases.length ? ` · ${product.aliases.join(', ')}` : ''}
                    </Text>
                    {actions(product)}
                  </Stack>
                </Paper>
              ))}
            </Box>
            {!hybrid && current.total > pageSize && (
              <Pagination
                value={page}
                onChange={setPage}
                total={Math.ceil(current.total / pageSize)}
              />
            )}
          </>
        )}
      </Stack>
      {editor && (
        <ProductEditor
          product={editor.product}
          initialCalculationMode={editor.initialCalculationMode}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
      {calculator && <ProductCalculator product={calculator} onClose={() => setCalculator(null)} />}
      {importing && (
        <NevoImporter
          onClose={() => setImporting(false)}
          onImported={async () => {
            setPage(1);
            await refresh();
          }}
        />
      )}
    </Container>
  );
}

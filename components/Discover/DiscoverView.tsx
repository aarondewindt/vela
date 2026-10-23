'use client';

import { useState } from 'react';
import {
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Image,
  Loader,
  Pagination,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { trpc } from '@/lib/trpc/client';
import {
  contentTypes,
  priorityOptions,
  quickAddSchema,
  sortOptions,
  statusOptions,
  type ListItemsInput,
} from '@/lib/discover/schema';
import type { DiscoverItem } from '@/lib/discover/service';
import { ItemEditor } from './ItemEditor';
import classes from './DiscoverView.module.css';

const pageSize = 24;

export function DiscoverView() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [query] = useDebouncedValue(search, 200);
  const [contentType, setContentType] = useState<string | null>(null);
  const [status, setStatus] = useState<ListItemsInput['status']>();
  const [tag, setTag] = useState('');
  const [priority, setPriority] = useState<string | null>(null);
  const [sort, setSort] = useState<ListItemsInput['sort']>('newest');
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [quickType, setQuickType] = useState('Other');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ item: DiscoverItem | null } | null>(null);
  const typesQuery = trpc.discover.types.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
  });
  const types = [
    ...new Set([
      ...contentTypes,
      ...(typesQuery.isFetchedAfterMount && !typesQuery.error ? (typesQuery.data ?? []) : []),
    ]),
  ];
  const collection = trpc.discover.list.useQuery(
    {
      query,
      contentType: contentType ?? undefined,
      status,
      tag: tag.trim() || undefined,
      priority: priority ? Number(priority) : undefined,
      sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    },
    { retry: false, refetchOnMount: 'always' }
  );
  const refresh = () => utils.discover.invalidate();
  const quickAdd = trpc.discover.quickAdd.useMutation({
    onSuccess: async (saved) => {
      if (saved?.url) {
        setEditor({ item: saved });
      }
      setText('');
      setPage(1);
      await refresh();
    },
  });
  const changeStatus = trpc.discover.setStatus.useMutation({
    onSuccess: refresh,
    onError: () => void refresh(),
  });
  const remove = trpc.discover.remove.useMutation({
    onError: () => void refresh(),
    onSuccess: async () => {
      setPage(1);
      await refresh();
    },
  });
  const failure = changeStatus.error ?? remove.error;
  const addQuick = (event: React.FormEvent) => {
    event.preventDefault();
    if (quickAdd.isPending) {
      return;
    }
    const parsed = quickAddSchema.safeParse({ text, contentType: quickType });
    if (!parsed.success) {
      setQuickError(parsed.error.issues[0].message);
      return;
    }
    setQuickError(null);
    quickAdd.mutate({ text, contentType: quickType });
  };
  const deleteItem = (item: DiscoverItem) =>
    modals.openConfirmModal({
      title: `Delete ${item.title}?`,
      children: <Text>This permanently deletes this item, including your notes and rating.</Text>,
      labels: { confirm: 'Delete item', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate({ id: item.id, version: item.version }),
    });
  const filtered = Boolean(search || contentType || status || tag || priority);
  const clearFilters = () => {
    setSearch('');
    setContentType(null);
    setStatus(undefined);
    setTag('');
    setPriority(null);
    setPage(1);
  };
  const data = collection.isFetchedAfterMount && !collection.error ? collection.data : undefined;

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={2}>Discover</Title>
            <Text c="dimmed" mt={4}>
              Things to watch, read, play, try, and explore.
            </Text>
          </div>
          <Button variant="light" onClick={() => setEditor({ item: null })}>
            Add with details
          </Button>
        </Group>
        <Paper withBorder p="md" radius="md">
          <form onSubmit={addQuick}>
            <Stack gap="sm">
              <Group align="flex-end">
                <TextInput
                  className={classes.quickInput}
                  label="Title or URL"
                  placeholder="Save something for later…"
                  required
                  maxLength={2048}
                  value={text}
                  disabled={quickAdd.isPending}
                  onChange={(event) => setText(event.currentTarget.value)}
                />
                <Autocomplete
                  label="Quick add type"
                  data={types}
                  maxLength={80}
                  value={quickType}
                  className={classes.quickType}
                  disabled={quickAdd.isPending}
                  onChange={setQuickType}
                />
                <Button type="submit" loading={quickAdd.isPending}>
                  Add item
                </Button>
              </Group>
              {(quickError || quickAdd.error) && (
                <Alert color="red" title="Could not add item">
                  {quickError ?? quickAdd.error?.message}
                </Alert>
              )}
            </Stack>
          </form>
        </Paper>
        <Stack gap="sm">
          <TextInput
            label="Search collection"
            placeholder="Title, description, notes, URL, or exact tag"
            value={search}
            maxLength={240}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
          />
          <SimpleGrid cols={{ base: 1, xs: 2, md: 5 }}>
            <Select
              label="Content type"
              placeholder="All types"
              searchable
              clearable
              data={types}
              value={contentType}
              onChange={(next) => {
                setContentType(next);
                setPage(1);
              }}
            />
            <Select
              label="Status"
              placeholder="All statuses"
              clearable
              data={statusOptions}
              value={status ?? null}
              onChange={(next) => {
                setStatus((next ?? undefined) as ListItemsInput['status']);
                setPage(1);
              }}
            />
            <TextInput
              label="Tag"
              placeholder="Exact tag"
              maxLength={60}
              value={tag}
              onChange={(event) => {
                setTag(event.currentTarget.value);
                setPage(1);
              }}
            />
            <Select
              label="Priority"
              placeholder="All priorities"
              clearable
              data={priorityOptions}
              value={priority}
              onChange={(next) => {
                setPriority(next);
                setPage(1);
              }}
            />
            <Select
              label="Sort by"
              allowDeselect={false}
              data={sortOptions}
              value={sort}
              onChange={(next) => {
                if (next) {
                  setSort(next as ListItemsInput['sort']);
                  setPage(1);
                }
              }}
            />
          </SimpleGrid>
          {filtered && (
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={clearFilters}
              style={{ alignSelf: 'flex-start' }}
            >
              Clear filters
            </Button>
          )}
        </Stack>
        {failure && (
          <Alert color="red" title="Could not change item">
            {failure.message}
          </Alert>
        )}
        {typesQuery.error && (
          <Alert color="red" title="Could not load custom types">
            {typesQuery.error.message}
          </Alert>
        )}
        {collection.error && (
          <Alert color="red" title="Could not load collection">
            {collection.error.message}
            <Button variant="subtle" onClick={() => void collection.refetch()}>
              Retry
            </Button>
          </Alert>
        )}
        {collection.isLoading && (
          <Group justify="center">
            <Loader aria-label="Loading collection" />
          </Group>
        )}
        {data && (
          <>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {data.total} {data.total === 1 ? 'item' : 'items'}
              </Text>
              {collection.isFetching && <Loader size="xs" aria-label="Refreshing collection" />}
            </Group>
            {data.total === 0 ? (
              <Paper withBorder p="xl" ta="center">
                <Text fw={600}>
                  {filtered ? 'No items match your filters.' : 'Your next discovery starts here.'}
                </Text>
                <Text c="dimmed" size="sm" mt="xs">
                  {filtered
                    ? 'Try another search or clear your filters.'
                    : 'Add a title or paste a URL above to start your collection.'}
                </Text>
              </Paper>
            ) : (
              <div className={classes.grid}>
                {data.items.map((item) => (
                  <Card key={item.id} withBorder radius="md" p="md" className={classes.card}>
                    <Stack gap="sm" className={classes.cardContent}>
                      <Group align="flex-start" wrap="nowrap">
                        {item.imageUrl && (
                          <Image
                            src={item.imageUrl}
                            alt=""
                            w={64}
                            h={90}
                            fit="cover"
                            radius="sm"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        )}
                        <Stack gap={6} className={classes.itemHeading}>
                          <Badge variant="light" color="gray" className={classes.typeBadge}>
                            {item.contentType}
                          </Badge>
                          <Text
                            component="button"
                            className={classes.title}
                            onClick={() => setEditor({ item })}
                          >
                            {item.title}
                          </Text>
                          {item.url && (
                            <Anchor
                              size="xs"
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              referrerPolicy="no-referrer"
                            >
                              Open link ↗
                            </Anchor>
                          )}
                        </Stack>
                      </Group>
                      {item.description && (
                        <Text size="sm" c="dimmed" lineClamp={3} className={classes.breakText}>
                          {item.description}
                        </Text>
                      )}
                      <Group gap={6}>
                        {item.priority !== null && (
                          <Badge variant="outline">
                            {
                              priorityOptions.find(
                                (option) => Number(option.value) === item.priority
                              )?.label
                            }{' '}
                            priority
                          </Badge>
                        )}
                        {item.rating !== null && <Badge variant="light">{item.rating}/10</Badge>}
                        {item.notes && (
                          <Text size="xs" c="dimmed">
                            Has notes
                          </Text>
                        )}
                      </Group>
                      {item.tags.length > 0 && (
                        <Group gap={6}>
                          {item.tags.map((entry) => (
                            <Badge key={entry} variant="light" color="gray" className={classes.tag}>
                              {entry}
                            </Badge>
                          ))}
                        </Group>
                      )}
                      <Text size="xs" c="dimmed">
                        Added {item.createdAt.toLocaleDateString()}
                      </Text>
                      <div className={classes.actions}>
                        <Select
                          aria-label={`Status for ${item.title}`}
                          data={statusOptions}
                          value={item.status}
                          allowDeselect={false}
                          disabled={changeStatus.isPending || remove.isPending}
                          onChange={(next) => {
                            if (next && next !== item.status) {
                              changeStatus.mutate({
                                id: item.id,
                                version: item.version,
                                status: next as DiscoverItem['status'],
                              });
                            }
                          }}
                        />
                        <Group justify="space-between" mt="sm">
                          <Button size="xs" variant="light" onClick={() => setEditor({ item })}>
                            Details & edit
                          </Button>
                          <Button
                            size="xs"
                            color="red"
                            variant="subtle"
                            disabled={remove.isPending}
                            onClick={() => deleteItem(item)}
                            aria-label={`Delete ${item.title}`}
                          >
                            Delete
                          </Button>
                        </Group>
                      </div>
                    </Stack>
                  </Card>
                ))}
              </div>
            )}
            {data.total > pageSize && (
              <Pagination
                total={Math.ceil(data.total / pageSize)}
                value={page}
                onChange={setPage}
              />
            )}
            {data.total > 0 && data.items.length === 0 && (
              <Button variant="light" onClick={() => setPage(1)}>
                Back to first page
              </Button>
            )}
          </>
        )}
      </Stack>
      {editor && (
        <ItemEditor
          item={editor.item}
          types={types}
          onClose={() => setEditor(null)}
          onRefresh={refresh}
        />
      )}
    </Container>
  );
}

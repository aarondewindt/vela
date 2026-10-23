'use client';

import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import {
  contentTypes,
  itemInputSchema,
  priorityOptions,
  pageMetadataSchema,
  statusOptions,
  type ItemInput,
} from '@/lib/discover/schema';
import type { DiscoverItem } from '@/lib/discover/service';

export function ItemEditor({
  item,
  types,
  onClose,
  onRefresh,
}: {
  item: DiscoverItem | null;
  types: string[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [value, setValue] = useState<ItemInput>(() =>
    item
      ? itemInputSchema.parse(item)
      : { ...itemInputSchema.parse({ title: 'New item' }), title: '' }
  );
  const [version, setVersion] = useState(item?.version ?? 1);
  const [metadata, setMetadata] = useState(() => {
    const parsed = pageMetadataSchema.safeParse(item?.sourceMetadata);
    return parsed.success ? parsed.data : null;
  });
  const [selected, setSelected] = useState<string[]>([]);
  const retrieve = trpc.discover.refreshMetadata.useMutation({
    onSuccess: async (updated) => {
      setVersion(updated.version);
      const parsed = pageMetadataSchema.safeParse(updated.sourceMetadata);
      setMetadata(parsed.success ? parsed.data : null);
      setSelected([]);
      await onRefresh();
    },
  });
  const [errors, setErrors] = useState<string[]>([]);
  const create = trpc.discover.create.useMutation();
  const update = trpc.discover.update.useMutation({ onError: () => void onRefresh() });
  const busy = create.isPending || update.isPending || retrieve.isPending;
  const failure = create.error ?? update.error;
  const change = (patch: Partial<ItemInput>) => setValue((current) => ({ ...current, ...patch }));
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const parsed = itemInputSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
      return;
    }
    setErrors([]);
    const options = {
      onSuccess: async () => {
        await onRefresh();
        onClose();
      },
    };
    if (item) {
      update.mutate({ id: item.id, version, item: parsed.data }, options);
    } else {
      create.mutate(parsed.data, options);
    }
  };
  const close = () => {
    if (!busy) {
      onClose();
    }
  };

  return (
    <Modal
      opened
      onClose={close}
      title={item ? 'Discover item' : 'Add Discover item'}
      size="lg"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      closeButtonProps={{ 'aria-label': 'Close item editor' }}
    >
      <form onSubmit={save}>
        <Stack gap="md">
          <TextInput
            label="Title"
            required
            maxLength={240}
            value={value.title}
            disabled={busy}
            onChange={(event) => change({ title: event.currentTarget.value })}
          />
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <Autocomplete
              label="Content type"
              description="Choose a type or enter your own."
              required
              data={[...new Set([...contentTypes, ...types])]}
              value={value.contentType}
              maxLength={80}
              disabled={busy}
              onChange={(contentType) => change({ contentType })}
            />
            <Select
              label="Status"
              data={statusOptions}
              value={value.status}
              allowDeselect={false}
              disabled={busy}
              onChange={(status) => {
                if (status) {
                  change({ status: status as ItemInput['status'] });
                }
              }}
            />
          </SimpleGrid>
          <TextInput
            label="URL"
            placeholder="https://…"
            value={value.url ?? ''}
            maxLength={2048}
            disabled={busy}
            onChange={(event) => change({ url: event.currentTarget.value || null })}
          />
          {item?.url && (
            <Stack gap="xs">
              <Button
                variant="light"
                loading={retrieve.isPending}
                disabled={create.isPending || update.isPending || value.url !== item.url}
                onClick={() => retrieve.mutate({ id: item.id, version })}
              >
                {retrieve.error ? 'Retry metadata retrieval' : 'Retrieve / refresh metadata'}
              </Button>
              {value.url !== item.url && (
                <Text size="sm">Save the changed URL before retrieving metadata.</Text>
              )}
              {retrieve.error && (
                <Alert color="red" title="Metadata unavailable">
                  {retrieve.error.message}
                </Alert>
              )}
            </Stack>
          )}
          {!item && value.url && (
            <Text size="sm">Save this item, then open its details to retrieve page metadata.</Text>
          )}
          {metadata && metadata.sourceUrl === value.url && (
            <Stack gap="xs">
              <Text fw={600}>Metadata preview</Text>
              <Text size="xs" c="dimmed">
                Web · {metadata.siteName || new URL(metadata.resolvedUrl).hostname} · Retrieved{' '}
                {new Date(metadata.retrievedAt).toLocaleString()}
              </Text>
              <Text size="xs" style={{ overflowWrap: 'anywhere' }}>
                Source: {metadata.resolvedUrl}
              </Text>
              <Text size="sm">
                Choose fields to replace in this form, then save. Your other edits are preserved.
              </Text>
              {(['title', 'description', 'imageUrl'] as const).map(
                (field) =>
                  metadata[field] && (
                    <Checkbox
                      key={field}
                      label={`${field === 'imageUrl' ? 'Cover URL' : field === 'title' ? 'Title' : 'Description'}: ${metadata[field]}`}
                      checked={selected.includes(field)}
                      disabled={busy}
                      onChange={(event) =>
                        setSelected(
                          event.currentTarget.checked
                            ? [...selected, field]
                            : selected.filter((key) => key !== field)
                        )
                      }
                    />
                  )
              )}
              {(!metadata.title || !metadata.description || !metadata.imageUrl) && (
                <Text size="sm">
                  {metadata.title || metadata.description || metadata.imageUrl
                    ? 'Partial metadata: some fields are unavailable.'
                    : 'No usable metadata found. This page may require JavaScript; you can retry or enter details manually.'}
                </Text>
              )}
              <Button
                variant="default"
                disabled={busy || !selected.length}
                onClick={() => {
                  const patch: Partial<ItemInput> = {};
                  for (const field of ['title', 'description', 'imageUrl'] as const) {
                    if (selected.includes(field) && metadata[field]) {
                      patch[field] = metadata[field];
                    }
                  }
                  change(patch);
                  setSelected([]);
                }}
              >
                Use selected fields
              </Button>
            </Stack>
          )}
          <Textarea
            label="Description"
            autosize
            minRows={2}
            maxRows={6}
            maxLength={10000}
            value={value.description ?? ''}
            disabled={busy}
            onChange={(event) => change({ description: event.currentTarget.value || null })}
          />
          <TagsInput
            label="Tags"
            description="Press Enter or comma to add a tag."
            maxTags={30}
            value={value.tags}
            disabled={busy}
            onChange={(tags) => change({ tags })}
          />
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <Select
              label="Priority"
              placeholder="No priority"
              clearable
              data={priorityOptions}
              value={value.priority === null ? null : String(value.priority)}
              disabled={busy}
              onChange={(priority) => change({ priority: priority ? Number(priority) : null })}
            />
            <NumberInput
              label="Personal rating (0–10)"
              placeholder="Unrated"
              min={0}
              max={10}
              allowDecimal={false}
              value={value.rating ?? ''}
              disabled={busy}
              onChange={(rating) => change({ rating: typeof rating === 'number' ? rating : null })}
            />
          </SimpleGrid>
          <Textarea
            label="Personal notes"
            autosize
            minRows={4}
            maxRows={12}
            maxLength={20000}
            value={value.notes ?? ''}
            disabled={busy}
            onChange={(event) => change({ notes: event.currentTarget.value || null })}
          />
          <TextInput
            label="Image or cover URL"
            placeholder="https://…"
            maxLength={2048}
            value={value.imageUrl ?? ''}
            disabled={busy}
            onChange={(event) => change({ imageUrl: event.currentTarget.value || null })}
          />
          {item && (
            <Text size="xs" c="dimmed">
              Added {item.createdAt.toLocaleString()} · Updated {item.updatedAt.toLocaleString()}
            </Text>
          )}
          {errors.length > 0 && (
            <Alert color="red" title="Check item details">
              {errors.map((error) => (
                <Text size="sm" key={error}>
                  {error}
                </Text>
              ))}
            </Alert>
          )}
          {failure && (
            <Alert color="red" title="Could not save item">
              {failure.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save item
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

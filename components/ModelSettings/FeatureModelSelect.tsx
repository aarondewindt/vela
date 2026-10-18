'use client';

import Link from 'next/link';
import { Alert, Anchor, Select, Stack, Text } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import type { ModelFeature, ModelSelection } from '@/lib/model-settings/schema';
import type { AiModel } from '@/lib/ai';

export function useFeatureModel(
  feature: ModelFeature,
  override: ModelSelection | null,
  enabled = true
) {
  const settings = trpc.settings.getAiModels.useQuery(undefined, {
    enabled: enabled && !override,
    retry: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const inherited =
    settings.isFetchedAfterMount && !settings.error ? settings.data?.resolved[feature] : undefined;
  return {
    selection: override ?? inherited?.selection ?? null,
    source: override ? 'Chat override' : (inherited?.source ?? 'Use settings'),
    error: override ? null : settings.error,
    loading: !override && settings.isFetching && !inherited,
  };
}

export function FeatureModelSelect({
  override,
  onChange,
  models,
  resolution,
  disabled,
  label = 'Chat model',
}: {
  override: ModelSelection | null;
  onChange: (selection: ModelSelection | null) => void;
  models: AiModel[];
  resolution: ReturnType<typeof useFeatureModel>;
  disabled?: boolean;
  label?: string;
}) {
  const options = models.map((model) => ({ value: model.id, label: model.id }));
  if (override && !options.some((option) => option.value === override.modelId)) {
    options.push({ value: override.modelId, label: `${override.modelId} (unavailable)` });
  }
  return (
    <Stack gap="xs">
      <Select
        label={label}
        searchable
        allowDeselect={false}
        disabled={disabled}
        value={override?.modelId ?? '__settings__'}
        data={[{ value: '__settings__', label: 'Use settings' }, ...options]}
        onChange={(value) => {
          if (value) {
            onChange(value === '__settings__' ? null : { provider: 'ollama', modelId: value });
          }
        }}
        description={
          resolution.loading
            ? 'Loading model settings…'
            : resolution.selection
              ? `Using ${resolution.selection.modelId} · ${resolution.source}`
              : 'Choose a default in Settings, or select a model here.'
        }
      />
      {resolution.error && <Alert color="red">{resolution.error.message}</Alert>}
      <Text size="xs">
        <Anchor component={Link} href="/settings#ai-models">
          AI &amp; model settings
        </Anchor>
      </Text>
    </Stack>
  );
}

'use client';

import { useState } from 'react';
import { Alert, Button, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import {
  compatibleProfiles,
  featureDefinitions,
  modelFeatures,
  modelProfiles,
  profileLabels,
  resolveProfileModel,
  type ModelChoice,
  type ModelSettingKey,
} from '@/lib/model-settings/schema';

function encode(value?: ModelChoice) {
  return !value
    ? '__inherit__'
    : 'profile' in value
      ? `profile:${value.profile}`
      : `model:${value.modelId}`;
}

export function AiModelSettings() {
  const utils = trpc.useUtils();
  const query = trpc.settings.getAiModels.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
  });
  const models = trpc.settings.listAiModels.useQuery(undefined, { retry: false });
  const [savingKey, setSavingKey] = useState<ModelSettingKey | null>(null);
  const update = trpc.settings.updateAiModel.useMutation({
    onSuccess: async (data) => {
      utils.settings.getAiModels.setData(undefined, data);
      await Promise.all([
        utils.settings.getAiModels.invalidate(),
        utils.aiDev.getConversation.invalidate(),
        utils.nutrition.getDraft.invalidate(),
      ]);
    },
    onSettled: () => setSavingKey(null),
  });
  const current = query.isFetchedAfterMount && !query.error ? query.data : undefined;
  const picker = (key: ModelSettingKey, label: string, feature = false) => {
    const value = current?.settings[key];
    const capability = key === 'embeddings' || key === 'aiDev.embeddings' ? 'embedding' : 'chat';
    const data = [
      {
        value: '__inherit__',
        label: feature
          ? `Inherit (${profileLabels[featureDefinitions[key as (typeof modelFeatures)[number]].profile]})`
          : ['fast', 'balanced', 'reasoning'].includes(key)
            ? 'Use default LLM'
            : 'Not configured',
      },
      ...(feature
        ? compatibleProfiles(key as (typeof modelFeatures)[number]).map((profile) => ({
            value: `profile:${profile}`,
            label:
              profile === 'default' ? 'Use default LLM' : `Use ${profileLabels[profile]} default`,
          }))
        : []),
      ...(models.data ?? [])
        .filter(
          (model) =>
            model.capabilities.includes(capability) &&
            (key !== 'visionLanguage' || model.capabilities.includes('vision'))
        )
        .map((model) => ({ value: `model:${model.id}`, label: model.id })),
    ];
    const encoded = encode(value);
    if (!data.some((option) => option.value === encoded)) {
      data.push({
        value: encoded,
        label: value && 'modelId' in value ? `${value.modelId} (unavailable)` : encoded,
      });
    }
    const resolved = feature
      ? current?.resolved[key as (typeof modelFeatures)[number]]
      : current
        ? resolveProfileModel(current.settings, key as 'default' | (typeof modelProfiles)[number])
        : undefined;
    return (
      <Select
        key={key}
        label={label}
        searchable
        allowDeselect={false}
        value={encoded}
        data={data}
        disabled={!current || models.isPending || Boolean(models.error) || update.isPending}
        description={
          savingKey === key
            ? 'Saving…'
            : resolved
              ? resolved.selection
                ? `Using ${resolved.selection.modelId} · ${resolved.source}`
                : 'No model configured'
              : undefined
        }
        onChange={(next) => {
          if (!next) {
            return;
          }
          setSavingKey(key);
          const value =
            next === '__inherit__'
              ? null
              : next.startsWith('profile:')
                ? { profile: next.slice(8) as 'default' | (typeof modelProfiles)[number] }
                : { provider: 'ollama' as const, modelId: next.slice(6) };
          update.mutate({ key, value });
        }}
      />
    );
  };
  return (
    <Stack gap="lg" id="ai-models" style={{ scrollMarginTop: '5rem' }}>
      <div>
        <Title order={3}>AI &amp; models</Title>
        <Text c="dimmed" size="sm">
          Your defaults apply across Vela and your devices. Chats can override them individually.
        </Text>
      </div>
      {query.error && (
        <Alert color="red">
          {query.error.message}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Retry loading settings
          </Button>
        </Alert>
      )}
      {models.error && <Alert color="red">{models.error.message}</Alert>}
      {update.error && <Alert color="red">{update.error.message}</Alert>}
      <Group>
        <Button variant="default" loading={models.isFetching} onClick={() => void models.refetch()}>
          Refresh installed models
        </Button>
      </Group>
      <Paper withBorder p="md">
        <Stack>
          <Title order={4}>Defaults</Title>
          {picker('default', 'Default LLM')}
          {modelProfiles.map((profile) => picker(profile, profileLabels[profile]))}
          <Text size="xs" c="dimmed">
            Profiles choose models. Thinking mode follows each feature’s policy; meal interpretation
            keeps thinking disabled. Vision language is ready for future image features.
          </Text>
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Stack>
          <Title order={4}>Features</Title>
          {modelFeatures.map((feature) => picker(feature, featureDefinitions[feature].label, true))}
        </Stack>
      </Paper>
    </Stack>
  );
}

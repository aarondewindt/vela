'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Anchor,
  Badge,
  Button,
  Combobox,
  Group,
  ScrollArea,
  Text,
  useCombobox,
} from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import type { AiModel } from '@/lib/ai';
import type { ModelSelection } from '@/lib/model-settings/schema';
import type { useFeatureModel } from '@/components/ModelSettings/FeatureModelSelect';
import classes from './AiPromptComposer.module.css';

export type ModelPickerProps = {
  models: AiModel[];
  override: ModelSelection | null;
  resolution: ReturnType<typeof useFeatureModel>;
  onChange: (selection: ModelSelection | null) => void;
  disabled?: boolean;
};

const modelKey = (model: ModelSelection) => JSON.stringify([model.provider, model.modelId]);

export function ModelPicker({
  models,
  override,
  resolution,
  onChange,
  disabled,
}: ModelPickerProps) {
  const [search, setSearch] = useState('');
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch('');
    },
    onDropdownOpen: () => combobox.focusSearchInput(),
  });
  const chatModels = models.filter((model) => model.capabilities.includes('chat'));
  const selectedAvailable =
    !override ||
    chatModels.some(
      (model) => model.provider === override.provider && model.id === override.modelId
    );
  const filtered = chatModels.filter((model) =>
    `${model.provider} ${model.id}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const providers = [...new Set(filtered.map((model) => model.provider))];
  const defaultKey = resolution.defaultSelection ? modelKey(resolution.defaultSelection) : null;

  return (
    <Combobox
      store={combobox}
      width={320}
      position="bottom-start"
      onOptionSubmit={(value) => {
        if (value === '__default__') {
          onChange(null);
        } else {
          const model = chatModels.find(
            (item) => modelKey({ provider: item.provider, modelId: item.id }) === value
          );
          if (model) {
            onChange({ provider: model.provider, modelId: model.id });
          }
        }
        combobox.closeDropdown();
        combobox.focusTarget();
      }}
    >
      <Combobox.Target targetType="button">
        <Button
          type="button"
          variant="subtle"
          size="compact-sm"
          className={classes.modelTrigger}
          aria-label="Chat model"
          disabled={disabled}
          rightSection={<Combobox.Chevron />}
          onClick={() => combobox.toggleDropdown()}
          c="gray.6"
          title={override ? `${override.provider} · ${override.modelId}` : resolution.defaultSource}
        >
          <span className={classes.modelLabel}>
            {resolution.selection?.modelId ??
              (resolution.loading ? 'Loading model…' : 'Choose model')}
            {!override && resolution.selection && ' · Default'}
            {!selectedAvailable && ' · Unavailable'}
          </span>
        </Button>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Search
          aria-label="Search models"
          placeholder="Search models…"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            combobox.resetSelectedOption();
          }}
        />
        <Combobox.Options>
          <ScrollArea.Autosize mah={280} type="auto">
            <Combobox.Option value="__default__" active={!override} aria-selected={!override}>
              <Group gap="xs" wrap="nowrap">
                {!override && <IconCheck size={14} aria-label="Selected" />}
                <div>
                  <Text size="sm">Use default</Text>
                  <Text size="xs" c="dimmed">
                    {resolution.defaultLoading
                      ? 'Loading default…'
                      : resolution.defaultError
                        ? 'Could not load default'
                        : resolution.defaultSelection
                          ? `${resolution.defaultSelection.modelId} · ${resolution.defaultSource}`
                          : 'No default configured'}
                  </Text>
                </div>
              </Group>
            </Combobox.Option>
            {providers.map((provider) => (
              <Combobox.Group key={provider} label={provider === 'ollama' ? 'Ollama' : provider}>
                {filtered
                  .filter((model) => model.provider === provider)
                  .map((model) => {
                    const key = modelKey({ provider: model.provider, modelId: model.id });
                    const selected = override ? modelKey(override) === key : false;
                    return (
                      <Combobox.Option
                        key={key}
                        value={key}
                        active={selected}
                        aria-selected={selected}
                      >
                        <Group gap="xs" wrap="nowrap">
                          {selected && <IconCheck size={14} aria-label="Selected" />}
                          <Text size="sm" className={classes.optionLabel}>
                            {model.id}
                          </Text>
                          {key === defaultKey && (
                            <Badge size="xs" variant="light">
                              Default
                            </Badge>
                          )}
                        </Group>
                      </Combobox.Option>
                    );
                  })}
              </Combobox.Group>
            ))}
            {filtered.length === 0 && <Combobox.Empty>No matching chat models</Combobox.Empty>}
            {!selectedAvailable && override && (
              <Combobox.Option value="__unavailable__" disabled aria-disabled="true">
                {override.modelId} · Unavailable
              </Combobox.Option>
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>
        <Combobox.Footer>
          <Anchor component={Link} href="/settings/ai-models" size="xs">
            AI &amp; model settings
          </Anchor>
        </Combobox.Footer>
      </Combobox.Dropdown>
    </Combobox>
  );
}

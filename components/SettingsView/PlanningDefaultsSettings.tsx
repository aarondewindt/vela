'use client';
import { useState } from 'react';
import { Alert, Button, Group, NumberInput, Stack, Text, Title } from '@mantine/core';
import { useGeneratorSettingsQuery, useSaveGeneratorSettingsMutation } from '@/lib/planner/query';
import type { GeneratorOptions } from '@/lib/planner/scheduling';
function PlanningDefaultsForm({ initial }: { initial: GeneratorOptions }) {
  const [generatorDraft, setGeneratorDraft] = useState(initial);
  const saveGeneratorSettings = useSaveGeneratorSettingsMutation();
  const generatorDraftError =
    generatorDraft.workSessionMinutes < 15 ||
    generatorDraft.workSessionMinutes > 240 ||
    generatorDraft.workSessionMinutes % 15 !== 0 ||
    generatorDraft.shortBreakMinutes < 5 ||
    generatorDraft.shortBreakMinutes > 60 ||
    generatorDraft.shortBreakMinutes % 5 !== 0 ||
    generatorDraft.leisureMinutes < 0 ||
    generatorDraft.leisureMinutes > 240 ||
    generatorDraft.leisureMinutes % 15 !== 0 ||
    generatorDraft.shortLeisureBlockMinutes < 15 ||
    generatorDraft.shortLeisureBlockMinutes > 120 ||
    generatorDraft.shortLeisureBlockMinutes % 15 !== 0 ||
    generatorDraft.maxLeisureBlockMinutes < generatorDraft.shortLeisureBlockMinutes ||
    generatorDraft.maxLeisureBlockMinutes > 240 ||
    generatorDraft.maxLeisureBlockMinutes % 15 !== 0;
  const updateGeneratorDraft = (field: keyof GeneratorOptions, value: number | string) => {
    const parsed = Number(value);
    setGeneratorDraft((current) => ({
      ...current,
      [field]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };

  return (
    <Stack>
      <Title order={4}>Planning defaults</Title>
      {saveGeneratorSettings.error && (
        <Alert color="red">{saveGeneratorSettings.error.message}</Alert>
      )}
      {saveGeneratorSettings.isSuccess && <Text role="status">Planning defaults saved.</Text>}
      <Stack>
        <NumberInput
          label="Work session target"
          suffix=" min"
          min={15}
          max={240}
          step={15}
          allowDecimal={false}
          value={generatorDraft.workSessionMinutes}
          onChange={(value) => updateGeneratorDraft('workSessionMinutes', value)}
        />
        <NumberInput
          label="Short break"
          suffix=" min"
          min={5}
          max={60}
          step={5}
          allowDecimal={false}
          value={generatorDraft.shortBreakMinutes}
          onChange={(value) => updateGeneratorDraft('shortBreakMinutes', value)}
        />
        <NumberInput
          label="Leisure time"
          suffix=" min"
          min={0}
          max={240}
          step={15}
          allowDecimal={false}
          value={generatorDraft.leisureMinutes}
          onChange={(value) => updateGeneratorDraft('leisureMinutes', value)}
        />
        <NumberInput
          label="Short leisure block"
          suffix=" min"
          min={15}
          max={120}
          step={15}
          allowDecimal={false}
          value={generatorDraft.shortLeisureBlockMinutes}
          onChange={(value) => updateGeneratorDraft('shortLeisureBlockMinutes', value)}
        />
        <NumberInput
          label="Maximum leisure block"
          suffix=" min"
          min={15}
          max={240}
          step={15}
          allowDecimal={false}
          value={generatorDraft.maxLeisureBlockMinutes}
          onChange={(value) => updateGeneratorDraft('maxLeisureBlockMinutes', value)}
        />
        <Group justify="space-between">
          <Button
            variant="default"
            loading={saveGeneratorSettings.isPending}
            disabled={generatorDraftError}
            onClick={() => saveGeneratorSettings.mutate(generatorDraft)}
          >
            Save as default
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
export function PlanningDefaultsSettings() {
  const query = useGeneratorSettingsQuery();
  return (
    <Stack>
      {query.isPending && <Text role="status">Loading planning defaults…</Text>}
      {query.error && (
        <Alert color="red">
          {query.error.message}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Retry loading planning defaults
          </Button>
        </Alert>
      )}
      {query.data && !query.error && <PlanningDefaultsForm initial={query.data} />}
    </Stack>
  );
}

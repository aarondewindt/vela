'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Group,
  Loader,
  PasswordInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { SensorDiagnostics } from './SensorDiagnostics';
import { trpc } from '@/lib/trpc/client';
import { haMetricKinds, metricLabels, metricUnits, type MetricKind } from '@/lib/health/schema';

function ConnectionForm({
  initial,
}: {
  initial: { baseUrl: string; enabled: boolean; revision: number } | null;
}) {
  const utils = trpc.useUtils();
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const save = trpc.homeAssistant.save.useMutation({
    onSuccess: async () => {
      setToken('');
      await utils.homeAssistant.invalidate();
      await utils.health.diagnostics.invalidate();
    },
  });
  return (
    <Paper withBorder p="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            baseUrl,
            token: token || undefined,
            enabled,
            revision: initial?.revision ?? 0,
          });
        }}
      >
        <Stack>
          <Title order={3}>Your connection</Title>
          <TextInput
            label="Home Assistant URL"
            placeholder="http://homeassistant.local:8123"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.currentTarget.value)}
          />
          <PasswordInput
            label="Long-lived access token"
            description={
              initial
                ? 'Leave empty to keep your saved token. Enter a new token when changing the URL.'
                : 'Create a token in your Home Assistant profile. It is saved encrypted.'
            }
            autoComplete="new-password"
            required={!initial}
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
          />
          <Switch
            label="Enable synchronization"
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
          />
          {save.error && <Alert color="red">{save.error.message}</Alert>}
          <Button type="submit" loading={save.isPending}>
            Save connection
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
function MappingsForm({ initial }: { initial: { metric: MetricKind; entityId: string }[] }) {
  const utils = trpc.useUtils();
  const [mapping, setMapping] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((x) => [x.metric, x.entityId]))
  );
  const entities = trpc.homeAssistant.entities.useQuery(undefined, {
    enabled: false,
    retry: false,
    gcTime: 0,
  });
  const save = trpc.health.saveMappings.useMutation({
    onSuccess: async () => {
      await utils.health.mappings.invalidate();
      await utils.homeAssistant.get.invalidate();
      await utils.health.diagnostics.invalidate();
    },
  });
  const options =
    entities.data?.map((x) => ({
      value: x.entityId,
      label: `${x.name} (${x.entityId}) · ${x.state} ${x.unit ?? ''}`,
    })) ?? [];
  for (const id of Object.values(mapping)) {
    if (id && !options.some((x) => x.value === id)) {
      options.push({ value: id, label: id });
    }
  }
  return (
    <Paper withBorder p="md">
      <Stack>
        <Group justify="space-between">
          <Title order={3}>Health sensors</Title>
          <Button
            variant="default"
            loading={entities.isFetching}
            onClick={() => void entities.refetch()}
          >
            Test connection / load sensors
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Choose your Withings weight, body fat and lean mass sensors. Calories, steps, sleep and
          BMR come from the Samsung Health Android companion.
        </Text>
        {entities.error && <Alert color="red">{entities.error.message}</Alert>}
        {entities.isSuccess && (
          <Alert color="teal">Connection successful. {entities.data.length} sensors found.</Alert>
        )}
        {haMetricKinds.map((metric) => (
          <Select
            key={metric}
            label={`${metricLabels[metric]} (${metricUnits[metric]})`}
            searchable
            clearable
            data={options}
            value={mapping[metric] || null}
            onChange={(value) => setMapping((current) => ({ ...current, [metric]: value ?? '' }))}
          />
        ))}
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        {save.isSuccess && <Text>Sensor mappings saved.</Text>}
        <Button
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              haMetricKinds.flatMap((metric) =>
                mapping[metric] ? [{ metric, entityId: mapping[metric] }] : []
              )
            )
          }
        >
          Save sensor mappings
        </Button>
      </Stack>
    </Paper>
  );
}
export function HomeAssistantSettings() {
  const connection = trpc.homeAssistant.get.useQuery(undefined, { refetchInterval: 15000 });
  const mappings = trpc.health.mappings.useQuery();
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Home Assistant</Title>
        <Button component={Link} href="/health" variant="default">
          Health
        </Button>
      </Group>
      <Text>
        Your connection and imported data are private to your Vela account. This connection can also
        serve other Vela apps.
      </Text>
      {connection.isPending && <Loader />}
      {connection.error && <Alert color="red">{connection.error.message}</Alert>}
      {connection.isSuccess && (
        <>
          <ConnectionForm key={connection.data?.revision ?? 0} initial={connection.data} />
          {connection.data && (
            <>
              <Paper withBorder p="md">
                <Stack gap="xs">
                  <Text fw={600}>{connection.data.status}</Text>
                  <Text size="sm">
                    Last reconciliation:{' '}
                    {connection.data.lastSyncedAt?.toLocaleString() ?? 'Not yet synced'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    Live synchronization requires the Home Assistant worker. An old reconciliation
                    time means the connection may be stale.
                  </Text>
                </Stack>
              </Paper>
              <SensorDiagnostics />
              {mappings.error && <Alert color="red">{mappings.error.message}</Alert>}
              {mappings.data && (
                <MappingsForm key={JSON.stringify(mappings.data)} initial={mappings.data} />
              )}
            </>
          )}
        </>
      )}
    </Stack>
  );
}

'use client';
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { metricLabels, metricUnits } from '@/lib/health/schema';

export function SensorDiagnostics() {
  const diagnostics = trpc.health.diagnostics.useQuery(undefined, {
    retry: false,
    staleTime: 15000,
  });
  return (
    <Paper withBorder p="md" id="sensor-diagnostics">
      <Stack>
        <Group justify="space-between">
          <Title order={3}>Sensor diagnostics</Title>
          <Button
            variant="default"
            loading={diagnostics.isFetching}
            onClick={() => void diagnostics.refetch()}
          >
            Refresh diagnostics
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Live check of your saved sensor mappings using the same validation as the importer. Save
          mapping changes before refreshing. This check does not import data or change worker
          status.
        </Text>
        {diagnostics.isPending && <Loader size="sm" />}
        {diagnostics.error && <Alert color="red">{diagnostics.error.message}</Alert>}
        {diagnostics.data && !diagnostics.error && (
          <>
            <Text size="sm">
              Checked {diagnostics.data.checkedAt.toLocaleString()} · Import timezone:{' '}
              {diagnostics.data.timezone}
            </Text>
            {!diagnostics.data.sensors.length && (
              <Text>No saved sensor mappings. Select and save your health sensors below.</Text>
            )}
            {diagnostics.data.sensors.map((sensor) => (
              <Paper withBorder p="sm" key={sensor.metric}>
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text fw={600}>{metricLabels[sensor.metric]}</Text>
                    <Badge color={sensor.issue ? 'red' : 'teal'}>
                      {sensor.issue ? 'Cannot import' : 'Ready to import'}
                    </Badge>
                  </Group>
                  <Text size="sm">Entity: {sensor.entityId}</Text>
                  <Text size="sm">
                    Reported state:{' '}
                    {sensor.state === null ? 'Entity not found' : JSON.stringify(sensor.state)} ·
                    Unit: {sensor.unit === null ? 'Not provided' : JSON.stringify(sensor.unit)}
                  </Text>
                  {sensor.issue && <Alert color="red">{sensor.issue}</Alert>}
                  {sensor.normalized && (
                    <Text size="sm">
                      Converted reading: {Number(sensor.normalized.value)}{' '}
                      {metricUnits[sensor.metric]} · Assigned date: {sensor.normalized.date}
                    </Text>
                  )}
                  {sensor.lastChanged && (
                    <Text size="xs" c="dimmed">
                      Last changed: {sensor.lastChanged} · Last updated: {sensor.lastUpdated}
                    </Text>
                  )}
                </Stack>
              </Paper>
            ))}
          </>
        )}
      </Stack>
    </Paper>
  );
}

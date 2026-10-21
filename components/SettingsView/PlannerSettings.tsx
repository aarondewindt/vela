'use client';
import { Alert, Select, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PlanningDefaultsSettings } from './PlanningDefaultsSettings';
import { useAuth } from '@/hooks/auth';
import { trpc } from '@/lib/trpc/client';
import { TaskIndexSettings } from '@/components/ModelSettings/SharedIndexSettings';
const timezoneOptions = Intl.supportedValuesOf('timeZone').map((timezone) => ({
  value: timezone,
  label: timezone.replaceAll('_', ' '),
}));
export function PlannerSettings() {
  const { session } = useAuth();
  const user = session.data?.user;
  const preferences = trpc.settings.getPreferences.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const updateTimezone = trpc.settings.updateTimezone.useMutation({
    onSuccess: async () => {
      await preferences.refetch();
      notifications.show({ message: 'Time zone updated', color: 'green' });
    },
    onError: (error) => {
      notifications.show({ message: error.message, color: 'red' });
    },
  });

  return (
    <Stack gap="lg">
      <Title order={3}>Planner</Title>
      <Text c="dimmed">
        Set the time zone used across Vela for schedules, diary dates and health readings.
      </Text>
      {!user && <Alert color="yellow">Sign in to manage planner settings.</Alert>}
      <Select
        label="Time zone"
        searchable
        data={timezoneOptions}
        value={preferences.data?.timezone ?? null}
        onChange={(timezone) => {
          if (timezone) {
            updateTimezone.mutate({ timezone });
          }
        }}
        disabled={!user || preferences.isLoading}
        error={preferences.error?.message}
      />
      {user && (
        <>
          <PlanningDefaultsSettings />
          <TaskIndexSettings />
        </>
      )}
    </Stack>
  );
}

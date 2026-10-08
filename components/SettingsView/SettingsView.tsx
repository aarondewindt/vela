'use client';

import {
  Alert,
  Button,
  Container,
  Divider,
  Group,
  Select,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/auth';
import { authClient } from '@/lib/auth-client';
import { trpc } from '@/lib/trpc/client';

const timezoneOptions = Intl.supportedValuesOf('timeZone').map((timezone) => ({
  value: timezone,
  label: timezone.replaceAll('_', ' '),
}));

export function SettingsView() {
  const { session } = useAuth();
  const user = session.data?.user;
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
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

  useEffect(() => {
    setName(user?.name ?? '');
  }, [user?.name]);

  const saveName = async () => {
    const nextName = name.trim();
    if (!nextName) {
      notifications.show({ message: 'Name cannot be empty', color: 'red' });
      return;
    }

    setSavingName(true);
    try {
      const result = await authClient.updateUser({ name: nextName });
      if (result.error) {
        notifications.show({ message: result.error.message, color: 'red' });
        return;
      }

      await session.refetch();
      notifications.show({ message: 'Profile updated', color: 'green' });
    } catch (error) {
      notifications.show({
        message: error instanceof Error ? error.message : 'Could not update profile',
        color: 'red',
      });
    } finally {
      setSavingName(false);
    }
  };

  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <div>
          <Title order={2}>Settings</Title>
          <Text c="dimmed" mt={4}>
            Manage your profile and app preferences.
          </Text>
        </div>

        {!user && <Alert color="yellow">Sign in to manage your settings.</Alert>}

        <Stack gap="md">
          <div>
            <Title order={4}>Profile</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Update the name associated with your account.
            </Text>
          </div>
          <TextInput
            label="Display name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            disabled={!user}
          />
          <Group justify="flex-end">
            <Button
              onClick={saveName}
              loading={savingName}
              disabled={!user || name.trim() === user.name}
            >
              Save profile
            </Button>
          </Group>
        </Stack>

        <Divider />

        <Stack gap="md">
          <div>
            <Title order={4}>Planner</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Set the time zone used for your schedule.
            </Text>
          </div>
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
        </Stack>

        <Divider />

        <Stack gap="md">
          <div>
            <Title order={4}>Appearance</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Choose how Vela is displayed.
            </Text>
          </div>
          <SegmentedControl
            aria-label="Color scheme"
            value={colorScheme}
            onChange={(value) => setColorScheme(value as 'light' | 'dark' | 'auto')}
            data={[
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
              { label: 'System', value: 'auto' },
            ]}
          />
        </Stack>
      </Stack>
    </Container>
  );
}

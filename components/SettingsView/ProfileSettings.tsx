'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useAuth } from '@/hooks/auth';
import { authClient } from '@/lib/auth-client';

export function ProfileSettings() {
  const { session } = useAuth();
  const user = session.data?.user;
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
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
    <Stack>
      {!user && <Alert color="yellow">Sign in to manage your profile.</Alert>}
      <Stack gap="md">
        <div>
          <Title order={3}>Profile</Title>
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
    </Stack>
  );
}

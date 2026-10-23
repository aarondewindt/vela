'use client';
import { useState } from 'react';
import { Alert, Button, Card, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
export function DeviceSettings() {
  const [code, setCode] = useState('');
  const utils = trpc.useUtils();
  const devices = trpc.devices.list.useQuery(undefined, { refetchInterval: 15_000 });
  const review = trpc.devices.review.useMutation();
  const approve = trpc.devices.approve.useMutation({
    onSuccess: () => {
      review.reset();
      setCode('');
    },
  });
  const revoke = trpc.devices.revoke.useMutation({
    onSuccess: () => utils.devices.list.invalidate(),
  });
  return (
    <Stack>
      <Title order={3}>Connected devices</Title>
      <Text>
        Start pairing on your device, then enter its code here. Only approve a request you
        initiated.
      </Text>
      <TextInput
        label="Pairing code"
        value={code}
        maxLength={12}
        onChange={(event) => {
          setCode(event.currentTarget.value.toUpperCase());
          review.reset();
          approve.reset();
        }}
      />
      <Button loading={review.isPending} onClick={() => review.mutate({ code })}>
        Review pairing
      </Button>
      {review.data && review.variables?.code === code && (
        <Card withBorder>
          <Stack>
            <Text>
              {review.data.name} ({review.data.clientType})
            </Text>
            <Text>
              Permissions: {review.data.scopes.join(', ')}. Expires:{' '}
              {review.data.expiresAt.toLocaleString()}
            </Text>
            <Button loading={approve.isPending} onClick={() => approve.mutate({ code })}>
              Approve this device
            </Button>
          </Stack>
        </Card>
      )}
      {approve.isSuccess && <Alert>Approved. Return to the device to finish pairing.</Alert>}
      {[devices.error, review.error, approve.error, revoke.error]
        .filter(Boolean)
        .map((error, index) => (
          <Alert key={index}>{error!.message}</Alert>
        ))}
      {devices.isLoading && <Text>Loading devices…</Text>}
      {devices.data?.length === 0 && <Text>No connected devices.</Text>}
      {devices.data?.map((device) => (
        <Card key={device.id} withBorder>
          <Stack gap="xs">
            <Text fw={600}>
              {device.name} ({device.clientType})
            </Text>
            <Text>
              {device.scopes.join(', ')} · Created {device.createdAt.toLocaleString()}
            </Text>
            <Text>
              Last used: {device.lastUsedAt?.toLocaleString() ?? 'Never'} · Expires:{' '}
              {device.expiresAt?.toLocaleString() ?? 'No expiry'}
            </Text>
            <Group>
              {device.revokedAt ? (
                <Text>Revoked</Text>
              ) : (
                <Button loading={revoke.isPending} onClick={() => revoke.mutate({ id: device.id })}>
                  Revoke access
                </Button>
              )}
            </Group>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

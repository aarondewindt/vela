import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { DiscoverView } from '@/components/Discover/DiscoverView';

export default async function DiscoverPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="xl" py="xl">
        <Stack>
          <Title order={2}>Discover</Title>
          <Alert color="yellow">
            Sign in using the navigation menu to manage your Discover collection.
          </Alert>
        </Stack>
      </Container>
    );
  }
  return <DiscoverView key={session.user.id} />;
}

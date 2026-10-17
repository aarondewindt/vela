import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { EmbeddingsView } from '@/components/EmbeddingsView/EmbeddingsView';

export default async function EmbeddingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="lg" py="xl">
        <Stack>
          <Title order={2}>Embeddings</Title>
          <Alert color="yellow">Sign in using the navigation menu to use AI Dev.</Alert>
        </Stack>
      </Container>
    );
  }
  return <EmbeddingsView key={session.user.id} />;
}

import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { AiDevView } from '@/components/AiDevView/AiDevView';

export default async function AiDevPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="lg" py="xl">
        <Stack>
          <Title order={2}>AI Dev</Title>
          <Alert color="yellow">Sign in using the navigation menu to use AI Dev.</Alert>
        </Stack>
      </Container>
    );
  }
  return <AiDevView key={session.user.id} />;
}

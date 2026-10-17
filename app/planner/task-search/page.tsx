import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { TaskSearchView } from '@/components/TaskSearchView/TaskSearchView';

export default async function TaskSearchPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="lg" py="xl">
        <Stack>
          <Title order={2}>Fuzzy task search</Title>
          <Alert color="yellow">Sign in using the navigation menu to test task search.</Alert>
        </Stack>
      </Container>
    );
  }
  return <TaskSearchView key={session.user.id} />;
}

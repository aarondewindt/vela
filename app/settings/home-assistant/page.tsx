import { Alert, Container } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { HomeAssistantSettings } from '@/components/Health/HomeAssistantSettings';
export default async function HomeAssistantPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container py="xl">
        <Alert color="yellow">Sign in using the navigation menu to configure Home Assistant.</Alert>
      </Container>
    );
  }
  return <HomeAssistantSettings key={session.user.id} />;
}

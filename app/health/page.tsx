import { Alert, Container } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { settingsService } from '@/lib/settings/service';
import { dateInTimezone } from '@/lib/nutrition/dates';
import { HealthView } from '@/components/Health/HealthView';
export default async function HealthPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container py="xl">
        <Alert color="yellow">Sign in using the navigation menu to track your health.</Alert>
      </Container>
    );
  }
  const { timezone } = await settingsService.getPreferences(session.user.id);
  return (
    <HealthView key={session.user.id} timezone={timezone} initialDate={dateInTimezone(timezone)} />
  );
}

import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { settingsService } from '@/lib/settings/service';
import { dateInTimezone } from '@/lib/nutrition/dates';
import { NutritionGoalsWidget } from '@/components/Nutrition/NutritionGoalsWidget';

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const preferences = session?.user ? await settingsService.getPreferences(session.user.id) : null;
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Dashboard</Title>
        {session?.user && preferences ? (
          <NutritionGoalsWidget
            key={session.user.id}
            initialDate={dateInTimezone(preferences.timezone)}
            timezone={preferences.timezone}
          />
        ) : (
          <Alert color="yellow">Sign in using the navigation menu to view your dashboard.</Alert>
        )}
      </Stack>
    </Container>
  );
}

import { headers } from 'next/headers';
import { Alert, Container, Stack, Title } from '@mantine/core';
import { auth } from '@/lib/auth';
import { settingsService } from '@/lib/settings/service';
import { dateInTimezone } from '@/lib/nutrition/dates';
import { DashboardNutrition } from '@/components/Nutrition/DashboardNutrition';
import { DashboardCalorieBalance } from '@/components/Health/DashboardCalorieBalance';

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container py="xl">
        <Title order={1}>Dashboard</Title>
        <Alert color="yellow">Sign in using the navigation menu to see your dashboard.</Alert>
      </Container>
    );
  }
  const { timezone } = await settingsService.getPreferences(session.user.id);
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={1}>Dashboard</Title>
        <DashboardNutrition key={session.user.id} date={dateInTimezone(timezone)} />
        <DashboardCalorieBalance
          key={`health-${session.user.id}`}
          date={dateInTimezone(timezone)}
        />
      </Stack>
    </Container>
  );
}

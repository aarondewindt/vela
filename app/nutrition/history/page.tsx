import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { settingsService } from '@/lib/settings/service';
import { dateInTimezone, diaryDateSchema } from '@/lib/nutrition/dates';
import { NutritionHistoryView } from '@/components/Nutrition/NutritionHistoryView';

export default async function NutritionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="lg" py="xl">
        <Stack>
          <Title order={2}>Nutrition history</Title>
          <Alert color="yellow">
            Sign in using the navigation menu to view your nutrition history.
          </Alert>
        </Stack>
      </Container>
    );
  }
  const preferences = await settingsService.getPreferences(session.user.id);
  const date = diaryDateSchema.safeParse((await searchParams).date);
  return (
    <NutritionHistoryView
      key={session.user.id}
      initialDate={date.success ? date.data : dateInTimezone(preferences.timezone)}
    />
  );
}

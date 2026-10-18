import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { settingsService } from '@/lib/settings/service';
import { dateInTimezone, diaryDateSchema } from '@/lib/nutrition/dates';
import { NutritionDiaryView } from '@/components/Nutrition/NutritionDiaryView';
import { z } from 'zod';

export default async function NutritionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; draft?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="lg" py="xl">
        <Stack>
          <Title order={2}>Nutrition diary</Title>
          <Alert color="yellow">
            Sign in using the navigation menu to use your nutrition diary.
          </Alert>
        </Stack>
      </Container>
    );
  }
  const preferences = await settingsService.getPreferences(session.user.id);
  const params = await searchParams;
  const requested = diaryDateSchema.safeParse(params.date);
  const requestedDraft = z.uuid().safeParse(params.draft);
  return (
    <NutritionDiaryView
      key={session.user.id}
      timezone={preferences.timezone}
      initialDate={requested.success ? requested.data : dateInTimezone(preferences.timezone)}
      initialDraftId={requestedDraft.success ? requestedDraft.data : undefined}
    />
  );
}

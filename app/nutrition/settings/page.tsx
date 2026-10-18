import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { NutritionGoalsView } from '@/components/Nutrition/NutritionGoalsView';
import { diaryDateSchema } from '@/lib/nutrition/dates';

export default async function NutritionSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="sm" py="xl">
        <Stack>
          <Title order={2}>Daily nutrition goals</Title>
          <Alert color="yellow">Sign in using the navigation menu to configure your goals.</Alert>
        </Stack>
      </Container>
    );
  }
  const requested = diaryDateSchema.safeParse((await searchParams).date);
  return (
    <NutritionGoalsView
      key={session.user.id}
      returnDate={requested.success ? requested.data : undefined}
    />
  );
}

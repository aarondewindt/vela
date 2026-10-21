import { Alert, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { NutritionGoalsView } from '@/components/Nutrition/NutritionGoalsView';
import { ProductSearchSettings } from '@/components/Nutrition/ProductSearchSettings';
import { FoodIndexSettings } from '@/components/ModelSettings/SharedIndexSettings';
import { diaryDateSchema } from '@/lib/nutrition/dates';

export default async function NutritionSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <Alert color="yellow">Sign in using the navigation menu to configure Nutrition.</Alert>;
  }
  const requested = diaryDateSchema.safeParse((await searchParams).date);
  return (
    <Stack gap="xl">
      <Title order={3}>Nutrition</Title>
      <NutritionGoalsView
        key={session.user.id}
        returnDate={requested.success ? requested.data : undefined}
      />
      <section id="related-food-search">
        <Stack>
          <Title order={3}>Related-food search</Title>
          <ProductSearchSettings />
          <FoodIndexSettings />
        </Stack>
      </section>
    </Stack>
  );
}

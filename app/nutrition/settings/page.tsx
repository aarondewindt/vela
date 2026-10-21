import { redirect } from 'next/navigation';
import { diaryDateSchema } from '@/lib/nutrition/dates';

export default async function NutritionSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const requested = diaryDateSchema.safeParse((await searchParams).date);
  redirect(
    requested.success ? `/settings/nutrition?date=${requested.data}` : '/settings/nutrition'
  );
}

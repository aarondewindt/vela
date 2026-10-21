import { Alert } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { HealthGoalSettings } from '@/components/Health/HealthGoalSettings';
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <Alert color="yellow">Sign in using the navigation menu to configure Health.</Alert>;
  }
  return <HealthGoalSettings key={session.user.id} />;
}

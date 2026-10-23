import { Alert } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { DeviceSettings } from '@/components/SettingsView/DeviceSettings';
export default async function DevicesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <Alert>Sign in using the navigation menu to manage devices.</Alert>;
  }
  return <DeviceSettings key={session.user.id} />;
}

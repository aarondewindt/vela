import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Alert, Stack } from '@mantine/core';
import { auth } from '@/lib/auth';
import { DevToolsNavigation } from './navigation';
export default async function DevToolsLayout({ children }: { children: React.ReactNode }) {
  if (process.env.VELA_PUBLIC_MODE === 'true') {
    notFound();
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return <Alert>Sign in using the navigation menu to view Dev Tools.</Alert>;
  }
  return (
    <Stack key={session.user.id}>
      <DevToolsNavigation />
      {children}
    </Stack>
  );
}

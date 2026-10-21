import { headers } from 'next/headers';
import { Alert } from '@mantine/core';
import { auth } from '@/lib/auth';
import { PlannerConversation } from '@/components/PlannerConversation/PlannerConversation';

export default async function ConversationPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Alert color="yellow">Sign in using the navigation menu to use planner conversations.</Alert>
    );
  }
  return <PlannerConversation key={session.user.id} />;
}

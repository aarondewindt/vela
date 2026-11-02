import { redirect } from 'next/navigation';

// A single workspace owns scheduling. Historical conversations remain stored and
// owner-readable through the existing conversation APIs.
export default function ConversationPage() {
  redirect('/planner/today');
}

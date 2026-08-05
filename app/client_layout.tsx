'use client';

import ApplicationShell from '@/components/ApplicationShell';
import { useAppShellStore } from '@/store/app_shell_store';
import { useAuth } from '@/hooks/auth';
import Anchor from '@/components/anchor';
import CurrentUserBadge from '@/components/CurrentUserBadge';


export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <ApplicationShell>{children}</ApplicationShell>;
}

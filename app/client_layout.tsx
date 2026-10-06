'use client';

import ApplicationShell from '@/components/ApplicationShell';
import { useAppShellStore } from '@/store/app_shell_store';
import { useAuth } from '@/hooks/auth';
import Anchor from '@/components/anchor';
import CurrentUserBadge from '@/components/CurrentUserBadge';
import { TRPCProvider } from '@/lib/trpc/provider';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      <ApplicationShell>{children}</ApplicationShell>
    </TRPCProvider>
  );
}

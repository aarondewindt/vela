'use client';

import { AppShell, Box, Burger, Stack } from '@mantine/core';
import { useAppShellStore } from '@/store/app_shell_store';
import { useAuth } from '@/hooks/auth';
import Anchor from '@/components/anchor';
import CurrentUserBadge from '@/components/current_user_badge';


export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { navbar_opened, toggle_navbar } = useAppShellStore();

  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: 'sm',
        collapsed: { mobile: !navbar_opened },
      }}
    >
      <AppShell.Header style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingLeft: '1rem' }}>
        <Burger
          opened={navbar_opened}
          onClick={toggle_navbar}
          hiddenFrom="sm"
          size="sm"
          style={{ padding: '0.5rem' }}
        />

        <div>Logo</div>
      </AppShell.Header>

      <AppShell.Navbar>
        <Stack gap="md" style={{ padding: '1rem', height: '100%' }}>
          <Box mt="auto">
            <CurrentUserBadge/>
          </Box>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        { children}
      </AppShell.Main>
    </AppShell>
  );
}

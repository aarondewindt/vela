'use client';

import { AppShell, Burger } from '@mantine/core';
import { useAppShellStore } from '@/store/app_shell_store';


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

      <AppShell.Navbar>Navbar</AppShell.Navbar>

      <AppShell.Main>
        { children}
      </AppShell.Main>
    </AppShell>
  );
}

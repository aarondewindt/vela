'use client';

import { AppShell, Box, Burger, Group, Stack, Title } from '@mantine/core';
import { useAppShellStore } from '@/store/app_shell_store';
import { ParallelogramIcon } from '@phosphor-icons/react';
import CurrentUserBadge from '@/components/CurrentUserBadge';
import { NavbarNested } from '../NavbarNested/NavbarNested';


export default function ApplicationShell({ children }: { children: React.ReactNode }) {
  const { navbar_opened, toggle_navbar } = useAppShellStore();

  return (
    <AppShell
      padding="md"
      header={{ 
        height: 60,
      }}
      navbar={{
        width: 300,
        breakpoint: 'sm',
        collapsed: { mobile: !navbar_opened },
      }}
    >
      <AppShell.Header style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingLeft: '1rem' }}>
        <Group>
          <Burger
            opened={navbar_opened}
            onClick={toggle_navbar}
            hiddenFrom="sm"
            size="sm"
            style={{ padding: '0.5rem' }}
          />
          <ParallelogramIcon size={32}/>
          <Title order={2}>Vela</Title>
        </Group>
        
      </AppShell.Header>

      <AppShell.Navbar>
        <NavbarNested/>
      </AppShell.Navbar>

      <AppShell.Main>
        { children }
      </AppShell.Main>
    </AppShell>
  );
}

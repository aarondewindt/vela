'use client';

import { AppShell, Box, Burger, Group, Stack, Title } from '@mantine/core';
import { useAppShellStore } from '@/store/app_shell_store';
import { ParallelogramIcon } from '@phosphor-icons/react';
import CurrentUserBadge from '@/components/CurrentUserBadge';
import { NavbarNested } from '../NavbarNested/NavbarNested';
import ApplicationShellHeader from './ApplicationShellHeader';


export default function ApplicationShell({ children }: { children: React.ReactNode }) {
  const { navbar_opened, toggle_navbar } = useAppShellStore();

  return (
    <AppShell padding="md"
              header={{ 
                height: 32,
              }}
              navbar={{
                width: 300,
                breakpoint: 'sm',
                collapsed: { mobile: !navbar_opened },
              }}>
      
      <ApplicationShellHeader/>

      <AppShell.Navbar>
        <NavbarNested/>
      </AppShell.Navbar>

      <AppShell.Main>
        { children }
      </AppShell.Main>
    </AppShell>
  );
}

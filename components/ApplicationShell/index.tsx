'use client';

import { useEffect } from 'react';
import { AppShell, Box, Burger, Group, Stack, Title, useAppShellResize } from '@mantine/core';
import { useAppShellStore } from '@/store/app_shell_store';
import { ParallelogramIcon } from '@phosphor-icons/react';
import CurrentUserBadge from '@/components/CurrentUserBadge';
import { NavbarNested } from '../NavbarNested/NavbarNested';
import ApplicationShellHeader from './ApplicationShellHeader';


export default function ApplicationShell({ children }: { children: React.ReactNode }) {
  const { navbar_opened, aside_opened, sizes, set_sizes } = useAppShellStore();
  useEffect(() => {
    useAppShellStore.persist.rehydrate();
  }, []);
  const resize = useAppShellResize({
    navbar: { min: 200, max: 500, label: 'Resize navigation' },
    aside: { min: 300, max: 1200, label: 'Resize inspector' },
    initialSizes: sizes,
    onResizeEnd: set_sizes,
  });

  return (
    <AppShell padding="md"
              resize={resize}
              header={{ 
                height: 32,
              }}
              navbar={{
                width: 300,
                breakpoint: 'sm',
                collapsed: { mobile: !navbar_opened },
              }}
              aside={{
                width: 380,
                breakpoint: 'md',
                collapsed: { desktop: !aside_opened, mobile: !aside_opened },
              }}>
      
      <ApplicationShellHeader/>

      <AppShell.Navbar>
        <NavbarNested/>
      </AppShell.Navbar>

      <AppShell.Aside>
        <div id="app-aside" style={{ height: '100%' }} />
      </AppShell.Aside>

      <AppShell.Main>
        { children }
      </AppShell.Main>
    </AppShell>
  );
}

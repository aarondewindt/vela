import { AppShell, Group, Burger, Title } from '@mantine/core';
import { useAppShellStore } from '@/store/app_shell_store';


export default function ApplicationShellHeader() {
  const { navbar_opened, toggle_navbar } = useAppShellStore();
  return (
    <AppShell.Header style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingLeft: '1rem' }}>
      <Group>
          <Burger
            opened={navbar_opened}
            onClick={toggle_navbar}
            hiddenFrom="sm"
            size="sm"
            style={{ padding: '0.5rem' }}
          />
        </Group>
    </AppShell.Header>
  );
}

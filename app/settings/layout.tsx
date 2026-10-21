import { Container, Stack, Title } from '@mantine/core';
import { SettingsNavigation } from '@/components/SettingsView/SettingsNavigation';
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <Title order={2}>Settings</Title>
        <SettingsNavigation />
        {children}
      </Stack>
    </Container>
  );
}

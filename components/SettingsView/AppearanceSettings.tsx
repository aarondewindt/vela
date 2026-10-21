'use client';
import { SegmentedControl, Stack, Text, Title, useMantineColorScheme } from '@mantine/core';
export function AppearanceSettings() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Stack>
      <Title order={3}>Appearance</Title>
      <Text c="dimmed">Choose how Vela is displayed on this device.</Text>
      <SegmentedControl
        aria-label="Color scheme"
        value={colorScheme}
        onChange={(value) => setColorScheme(value as 'light' | 'dark' | 'auto')}
        data={[
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
          { label: 'System', value: 'auto' },
        ]}
      />
    </Stack>
  );
}

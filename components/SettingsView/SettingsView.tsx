'use client';

import Link from 'next/link';
import { Card, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { settingsSections } from './sections';
export function SettingsView() {
  return (
    <Stack gap="lg">
      <Text c="dimmed">Manage your account, app preferences and integrations.</Text>
      {(['Account', 'Apps', 'Integrations'] as const).map((group) => (
        <Stack key={group} gap="sm">
          <Title order={3}>{group}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {settingsSections
              .filter((section) => section.group === group)
              .map((section) => (
                <Card
                  key={section.href}
                  component={Link}
                  href={section.href}
                  withBorder
                  padding="md"
                >
                  <Text fw={600}>{section.label}</Text>
                  <Text size="sm" c="dimmed">
                    {section.description}
                  </Text>
                </Card>
              ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  );
}

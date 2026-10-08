import { Container, Stack, Text, Title } from '@mantine/core';

export default function DevToolsPage() {
  return (
    <Container size="lg" py="xl">
      <Stack gap="xs">
        <Title order={2}>Dev tools</Title>
        <Text c="dimmed">Developer tools will be available here.</Text>
      </Stack>
    </Container>
  );
}

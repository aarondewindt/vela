import { Anchor, Stack, Text } from '@mantine/core';

export function NevoAttribution({
  sources,
}: {
  sources: { name: string | null; version: string | null }[];
}) {
  const versions = [
    ...new Set(
      sources
        .filter((source) => source.name === 'NEVO')
        .map((source) => {
          const match = /^NEVO(?:-Online)?\s+(\d{4})\s+(\d+(?:\.\d+){0,3})$/i.exec(
            source.version ?? ''
          );
          return match ? `${match[1]}/${match[2]}` : source.version;
        })
        .filter(Boolean)
    ),
  ];
  if (!versions.length) {
    return null;
  }
  return (
    <Stack gap={4}>
      {versions.map((version) => (
        <Text key={version} size="xs" c="dimmed">
          Based on data from NEVO online version {version}, RIVM, Bilthoven and other data sources.{' '}
          <Anchor
            size="xs"
            href="https://www.rivm.nl/en/dutch-food-composition-database/use-of-nevo-online/copyright-and-disclaimer"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </Anchor>
        </Text>
      ))}
    </Stack>
  );
}

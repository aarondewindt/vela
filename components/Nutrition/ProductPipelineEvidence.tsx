'use client';

import { Anchor, Paper, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { indexSourceEvidence } from '@/lib/ai/source-evidence';
import type { ProductSuggestion } from '@/lib/nutrition/product-extraction/schema';

/** Review original observations independently of interpreted and normalized suggestions. */
export function ProductPipelineEvidence({
  pipeline,
}: {
  pipeline: NonNullable<ProductSuggestion['pipeline']>;
}) {
  const cells = indexSourceEvidence(pipeline.evidence);
  const photographs = pipeline.evidence.photographs;
  const photographLink = (id: string) => (
    <Anchor href={`/api/attachments/${encodeURIComponent(id)}`} target="_blank" size="xs">
      Photograph {photographs.findIndex((photograph) => photograph.id === id) + 1}
    </Anchor>
  );
  return (
    <Stack gap="xs">
      <Text size="xs">
        Vision transcription: {pipeline.diagnostics.transcription.selection.modelId}
        {pipeline.diagnostics.transcription.reused ? ' · Reused transcription' : ''}
        {' · '}Text interpretation: {pipeline.diagnostics.interpretation.selection.modelId}
      </Text>
      <details>
        <summary>Photograph sources and user corrections</summary>
        <Stack gap="xs" mt="xs">
          {Object.entries(pipeline.provenance).map(([field, references]) => (
            <Paper withBorder p="xs" key={field}>
              <Text size="sm" fw={600}>
                {field}
              </Text>
              {references.map((reference, index) => {
                const cell = reference.cellId ? cells.get(reference.cellId) : undefined;
                const correction = pipeline.corrections.find(
                  (item) => item.id === reference.correctionId
                );
                return (
                  <Stack gap={2} key={index}>
                    <Text size="xs" style={{ overflowWrap: 'anywhere' }}>
                      {correction ? `User correction: ${correction.text}` : cell?.text}
                      {cell?.uncertain && ' · Uncertain reading'}
                    </Text>
                    {reference.photographId && photographLink(reference.photographId)}
                    <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                      Source: {reference.cellId ?? reference.messageId}
                    </Text>
                  </Stack>
                );
              })}
            </Paper>
          ))}
          <Text size="xs" c="dimmed">
            Values refer to the original source cells above. Conversions and rounding are applied by
            Vela; compare suggestions with the photographs before applying them.
          </Text>
        </Stack>
      </details>
      <details>
        <summary>Original photograph transcription</summary>
        <Stack gap="xs" mt="xs">
          {photographs.map((photograph) => (
            <Paper withBorder p="xs" key={photograph.id}>
              {photographLink(photograph.id)}
              {photograph.text.map((block) => (
                <Text size="xs" key={block.id} style={{ overflowWrap: 'anywhere' }}>
                  {block.text}
                  {block.uncertain && ' · Uncertain reading'}
                </Text>
              ))}
              {photograph.tables.map((table) => (
                <ScrollArea key={table.id} type="auto" mt="xs">
                  <Table withTableBorder withColumnBorders fz="xs">
                    <Table.Caption>{table.caption}</Table.Caption>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Printed row</Table.Th>
                        {table.columns.map((column) => (
                          <Table.Th key={column.id}>
                            {column.text}
                            {column.uncertain && ' · Uncertain'}
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {table.rows.map((row) => (
                        <Table.Tr key={row.id}>
                          <Table.Th scope="row">
                            {row.label.text}
                            {row.label.uncertain && ' · Uncertain'}
                          </Table.Th>
                          {table.columns.map((column) => {
                            const cell = row.cells.find((item) => item.columnId === column.id);
                            return (
                              <Table.Td key={column.id}>
                                {cell?.text ?? 'Unreadable'}
                                {cell?.uncertain && ' · Uncertain'}
                              </Table.Td>
                            );
                          })}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              ))}
            </Paper>
          ))}
          {pipeline.evidence.warnings.map((warning, index) => (
            <Text size="xs" key={index}>
              {warning}
            </Text>
          ))}
          <Text size="xs" c="dimmed">
            Transcription: {(pipeline.diagnostics.transcription.durationMs / 1000).toFixed(1)} s
            {' · '}Interpretation:{' '}
            {(pipeline.diagnostics.interpretation.durationMs / 1000).toFixed(1)} s{' · '}Total:{' '}
            {(pipeline.diagnostics.totalDurationMs / 1000).toFixed(1)} s{' · '}
            {pipeline.version}
          </Text>
        </Stack>
      </details>
    </Stack>
  );
}

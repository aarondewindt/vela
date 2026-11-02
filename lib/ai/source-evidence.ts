import { z } from 'zod';

const sourceId = z.string().min(1).max(160);
const observedText = z
  .object({
    id: sourceId,
    text: z.string().max(8000),
    uncertain: z.boolean(),
  })
  .strict();

/** Domain-neutral OCR: preserve the observed grid before assigning meaning to it. */
export const sourceEvidenceSchema = z
  .object({
    version: z.literal(1),
    photographs: z
      .array(
        z
          .object({
            id: sourceId,
            text: z.array(observedText).max(80),
            tables: z
              .array(
                z
                  .object({
                    id: sourceId,
                    caption: z.string().max(2000),
                    columns: z.array(observedText).min(1).max(16),
                    rows: z
                      .array(
                        z
                          .object({
                            id: sourceId,
                            label: observedText,
                            cells: z.array(observedText.extend({ columnId: sourceId })).max(16),
                          })
                          .strict()
                      )
                      .max(80),
                  })
                  .strict()
              )
              .max(12),
          })
          .strict()
      )
      .min(1)
      .max(16),
    warnings: z.array(z.string().max(1000)).max(40),
  })
  .strict()
  .superRefine((evidence, context) => {
    const ids = new Set<string>();
    function unique(id: string) {
      if (ids.has(id)) {
        context.addIssue({
          code: 'custom',
          message: 'Source identifiers must be globally unique.',
        });
      }
      ids.add(id);
    }
    for (const photo of evidence.photographs) {
      unique(photo.id);
      photo.text.forEach((cell) => unique(cell.id));
      for (const table of photo.tables) {
        unique(table.id);
        const columns = new Set(table.columns.map((column) => column.id));
        table.columns.forEach((column) => unique(column.id));
        for (const row of table.rows) {
          unique(row.id);
          unique(row.label.id);
          const used = new Set<string>();
          for (const cell of row.cells) {
            unique(cell.id);
            if (!columns.has(cell.columnId) || used.has(cell.columnId)) {
              context.addIssue({
                code: 'custom',
                message: 'A row cell must refer to a distinct column in its own table.',
              });
            }
            used.add(cell.columnId);
          }
        }
      }
    }
  });
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;

const transcriptionText = observedText.omit({ id: true });
const transcriptionPhotograph = z
  .object({
    id: sourceId,
    text: z.array(transcriptionText).max(80),
    tables: z
      .array(
        z
          .object({
            caption: z.string().max(2000),
            columns: z.array(transcriptionText).min(1).max(16),
            rows: z
              .array(
                z
                  .object({
                    label: transcriptionText,
                    cells: z.array(transcriptionText).min(1).max(16),
                  })
                  .strict()
              )
              .max(80),
          })
          .strict()
      )
      .max(12),
  })
  .strict();
export const sourceTranscriptionSchema = z
  .object({
    version: z.literal(1),
    photographs: z.array(transcriptionPhotograph).min(1).max(16),
    warnings: z.array(z.string().max(1000)).max(40),
  })
  .strict();
export type SourceTranscription = z.infer<typeof sourceTranscriptionSchema>;

/** Models transcribe ordered slots; source identifiers and relationships belong to application code. */
export function sourceTranscriptionSchemaForPhotographs(photographIds: string[]) {
  const ids = [...new Set(photographIds)];
  if (!ids.length || ids.length > 16) {
    throw new Error('Provide one to sixteen authorized photographs.');
  }
  return sourceTranscriptionSchema.extend({
    photographs: z
      .array(
        transcriptionPhotograph.extend({
          id: z.enum(ids as [string, ...string[]]),
        })
      )
      .length(ids.length),
  });
}

export function assignSourceIdentifiers(
  value: SourceTranscription,
  photographIds: string[]
): SourceEvidence {
  const transcription = sourceTranscriptionSchemaForPhotographs(photographIds).parse(value);
  const ids = [...new Set(photographIds)];
  const indexed = new Map(transcription.photographs.map((photo) => [photo.id, photo]));
  if (indexed.size !== ids.length) {
    throw new Error('Transcription must retain every authorized photograph exactly once.');
  }
  return sourceEvidenceSchema.parse({
    version: 1,
    photographs: ids.map((id, photoIndex) => {
      const photo = indexed.get(id)!;
      const prefix = `source:${photoIndex}`;
      return {
        id,
        text: photo.text.map((text, index) => ({ ...text, id: `${prefix}:text:${index}` })),
        tables: photo.tables.map((table, tableIndex) => {
          const tableId = `${prefix}:table:${tableIndex}`;
          const columns = table.columns.map((text, index) => ({
            ...text,
            id: `${tableId}:column:${index}`,
          }));
          return {
            id: tableId,
            caption: table.caption,
            columns,
            rows: table.rows.map((row, rowIndex) => {
              if (row.cells.length !== columns.length) {
                throw new Error(
                  'Every transcribed row must retain one cell slot per source column.'
                );
              }
              const rowId = `${tableId}:row:${rowIndex}`;
              return {
                id: rowId,
                label: { ...row.label, id: `${rowId}:label` },
                cells: row.cells.map((text, index) => ({
                  ...text,
                  id: `${rowId}:cell:${index}`,
                  columnId: columns[index].id,
                })),
              };
            }),
          };
        }),
      };
    }),
    warnings: transcription.warnings,
  });
}
export type SourceCell = {
  id: string;
  text: string;
  uncertain: boolean;
  photographId: string;
  tableId?: string;
  columnId?: string;
  rowId?: string;
};

/** Call only after schema validation. Includes text blocks, headings and row labels. */
export function indexSourceEvidence(evidence: SourceEvidence): Map<string, SourceCell> {
  const cells = new Map<string, SourceCell>();
  for (const photograph of evidence.photographs) {
    for (const cell of photograph.text) {
      cells.set(cell.id, { ...cell, photographId: photograph.id });
    }
    for (const table of photograph.tables) {
      for (const column of table.columns) {
        cells.set(column.id, {
          ...column,
          photographId: photograph.id,
          tableId: table.id,
          columnId: column.id,
        });
      }
      for (const row of table.rows) {
        cells.set(row.label.id, {
          ...row.label,
          photographId: photograph.id,
          tableId: table.id,
          rowId: row.id,
        });
        for (const cell of row.cells) {
          cells.set(cell.id, {
            ...cell,
            photographId: photograph.id,
            tableId: table.id,
            rowId: row.id,
          });
        }
      }
    }
  }
  return cells;
}

/** Printed lexemes, including precision and censoring. No parsing, conversion or repair. */
export function sourceNumberMatches(text: string): RegExpMatchArray[] {
  return [
    ...text.matchAll(/(?:[<>≤≥~≈+-]\s*)?\d+(?:(?:[.,]\d+)|(?:[ \u00a0\u202f]\d{3}(?!\d)))*/g),
  ];
}
export function sourceNumbers(text: string): string[] {
  return sourceNumberMatches(text).map((match) => match[0].trim());
}

export function validatePhotographSources(evidence: SourceEvidence, photographIds: string[]) {
  const expected = new Set(photographIds);
  const actual = new Set(evidence.photographs.map((photo) => photo.id));
  if (expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) {
    throw new Error('Transcription must retain every authorized photograph identifier exactly.');
  }
  return evidence;
}

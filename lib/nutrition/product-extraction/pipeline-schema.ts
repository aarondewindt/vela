import { z } from 'zod';
import {
  sourceEvidenceSchema,
  indexSourceEvidence,
  type SourceEvidence,
  sourceNumbers,
} from '@/lib/ai/source-evidence';
import { sourceAmountUnit, sourcePhysicalUnit, explicitCorrectionReference } from './source-units';

export const extractionPipelineVersion = 'nutrition-two-stage-v1' as const;
export const transcriptionPromptVersion = 'packaging-transcription-v2';
export const interpretationPromptVersion = 'nutrition-interpretation-v1';
export const transcriptionSchemaVersion = 'source-transcription-v2';
export const interpretationSchemaVersion = 'nutrition-mappings-v1';

const sourceId = z
  .string()
  .min(1)
  .max(160)
  .describe('An existing source identifier, never copied source text.');
const identityReference = sourceId
  .nullable()
  .describe(
    'The ID of one existing source text block or cell, not its text/value. Null if unknown.'
  );
const numericReference = z
  .object({ cellId: sourceId, numberIndex: z.number().int().min(0).max(100).nullable() })
  .strict();
const correctionReference = z
  .object({ correctionId: sourceId, numberIndex: z.number().int().min(0).max(100) })
  .strict();
const nutrient = z.enum([
  'calories',
  'protein',
  'carbohydrates',
  'fat',
  'fiber',
  'sugars',
  'saturatedFat',
  'salt',
  'sodium',
]);
const amountUnit = z.enum(['g', 'mg', 'kcal', 'kJ', '%']);
const packageUnit = z.enum(['G', 'KG', 'ML', 'L']);
export const userCorrectionSchema = z
  .object({ id: sourceId, messageId: sourceId, text: z.string().max(12_000) })
  .strict();
export type UserCorrection = z.infer<typeof userCorrectionSchema>;

/** No numeric observation is accepted from the interpreting model: only cell/token references. */
export const nutritionInterpretationSchema = z
  .object({
    identity: z
      .object({
        name: identityReference,
        brand: identityReference,
        variant: identityReference,
        description: identityReference,
        ingredients: identityReference,
        aliases: z
          .array(sourceId)
          .max(30)
          .describe(
            'Existing source cell IDs only. Use [] if no additional aliases are explicitly visible.'
          ),
      })
      .strict(),
    package: z
      .object({ quantity: numericReference.nullable(), unit: packageUnit.nullable() })
      .strict(),
    columns: z
      .array(
        z
          .object({
            columnId: sourceId,
            reference: numericReference.nullable(),
            unit: z.enum(['G', 'ML', '%']).nullable(),
            values: z
              .array(
                z
                  .object({
                    nutrient,
                    amount: numericReference.nullable(),
                    unit: amountUnit,
                    note: z.string().max(500),
                  })
                  .strict()
              )
              .max(30),
            note: z.string().max(500),
          })
          .strict()
      )
      .max(16),
    corrections: z
      .array(
        z
          .object({
            field: z.enum([
              'name',
              'brand',
              'variant',
              'description',
              'ingredients',
              'packageQuantity',
              'calories',
              'protein',
              'carbohydrates',
              'fat',
              'fiber',
              'sugars',
              'saturatedFat',
              'salt',
              'sodium',
            ]),
            correctionId: sourceId,
            // Text must be a verbatim substring of the trusted user message. Numeric fields use numberIndex instead.
            text: z.string().max(4000).nullable(),
            numberIndex: z.number().int().min(0).max(100).nullable(),
            unit: z.enum(['g', 'mg', 'kcal', 'kJ', '%', 'G', 'KG', 'ML', 'L']).nullable(),
            reference: correctionReference.nullable(),
            referenceUnit: z.enum(['G', 'ML']).nullable(),
          })
          .strict()
      )
      .max(40),
    problems: z
      .array(z.object({ cellIds: z.array(sourceId).max(30), note: z.string().max(1000) }).strict())
      .max(40),
  })
  .strict();
export type NutritionInterpretation = z.infer<typeof nutritionInterpretationSchema>;

/** Constrain provider generation itself to this evidence snapshot's actual identifiers. */
export function nutritionInterpretationSchemaForEvidence(
  evidence: SourceEvidence,
  corrections: UserCorrection[] = []
): z.ZodType<NutritionInterpretation> {
  const cells = [...indexSourceEvidence(evidence).values()];
  const enumIds = (ids: string[]) =>
    z.enum(ids.length ? (ids as [string, ...string[]]) : ['__no_readable_source__']);
  const ids = enumIds(cells.map((cell) => cell.id));
  const headings = cells.filter((cell) => cell.columnId === cell.id);
  const correctionIds = enumIds(corrections.map((correction) => correction.id));
  const numberRef = numericReference.extend({ cellId: ids });
  const correctionRef = correctionReference.extend({ correctionId: correctionIds });
  const correctionSchemas = corrections.flatMap((correction) => {
    const base = nutritionInterpretationSchema.shape.corrections.element.extend({
      correctionId: z.literal(correction.id),
      reference: correctionRef.nullable(),
    });
    const text = base.extend({
      field: z.enum(['name', 'brand', 'variant', 'description', 'ingredients']),
      text: z.string().min(1).max(4000),
      numberIndex: z.null(),
      unit: z.null(),
      reference: z.null(),
      referenceUnit: z.null(),
    });
    const indices = sourceNumbers(correction.text).map((_value, index) => index);
    const physicalReference = explicitCorrectionReference(correction);
    const amountIndices = indices.filter((index) => index !== physicalReference?.index);
    const numeric = base.extend({
      field: nutrient,
      text: z.null(),
      numberIndex: amountIndices.length
        ? z.union(amountIndices.map((index) => z.literal(index)))
        : z.never(),
      reference: physicalReference
        ? z
            .object({
              correctionId: z.literal(correction.id),
              numberIndex: z.literal(physicalReference.index),
            })
            .strict()
        : correctionRef.nullable(),
      referenceUnit: physicalReference
        ? z.literal(physicalReference.unit)
        : base.shape.referenceUnit,
    });
    const quantity = base.extend({
      field: z.literal('packageQuantity'),
      text: z.null(),
      numberIndex: indices.length ? z.union(indices.map((index) => z.literal(index))) : z.never(),
    });
    return indices.length ? [text, numeric, quantity] : [text];
  });
  const packageSchemas = packageUnit.options.flatMap((unit) => {
    const references = cells
      .filter((cell) => !cell.tableId)
      .flatMap((cell) => {
        const indices = sourceNumbers(cell.text).flatMap((_token, index) =>
          sourcePhysicalUnit(cell, index) === unit ? [index] : []
        );
        return indices.length
          ? [
              z
                .object({
                  cellId: z.literal(cell.id),
                  numberIndex: z.union(indices.map((index) => z.literal(index))),
                })
                .strict(),
            ]
          : [];
      });
    return references.length
      ? [z.object({ unit: z.literal(unit), quantity: z.union(references) }).strict()]
      : [];
  });
  const missingPackage = z.object({ unit: z.null(), quantity: z.null() }).strict();
  const columnSchemas = headings.map((heading) => {
    const isPercentage = /(?:%|\bRI\b|\bDV\b|\bNRV\b|reference intake|referentie.inname)/i.test(
      heading.text
    );
    const physicalReferences = sourceNumbers(heading.text).flatMap((token, index) => {
      const unit = sourcePhysicalUnit(heading, index);
      return /^\d+(?:[.,]\d+)?$/.test(token) && (unit === 'G' || unit === 'ML')
        ? [{ index, unit: unit as 'G' | 'ML' }]
        : [];
    });
    const physical =
      !heading.uncertain && physicalReferences.length === 1 ? physicalReferences[0] : null;
    const amounts = cells.filter((cell) => cell.rowId && cell.columnId === heading.id);
    const valueSchemas = amountUnit.options.map((unit) => {
      const references = amounts.flatMap((cell) => {
        const label = cells.find(
          (candidate) => candidate.rowId === cell.rowId && !candidate.columnId
        )?.text;
        const units = sourceNumbers(cell.text).map((_token, index) =>
          sourceAmountUnit(cell, index, label)
        );
        const indices = units.flatMap((sourceUnit, index) => (sourceUnit === unit ? [index] : []));
        if (!indices.length && units.some(Boolean)) {
          return [];
        }
        return [
          z
            .object({
              cellId: z.literal(cell.id),
              numberIndex: indices.length
                ? z.union([...indices.map((index) => z.literal(index)), z.null()])
                : z.null(),
            })
            .strict(),
        ];
      });
      return nutritionInterpretationSchema.shape.columns.element.shape.values.element.extend({
        unit: z.literal(unit),
        nutrient:
          unit === 'kcal' || unit === 'kJ'
            ? z.literal('calories')
            : unit === '%'
              ? nutrient
              : nutrient.exclude(['calories']),
        amount: references.length ? z.union(references).nullable() : z.null(),
      });
    });
    return nutritionInterpretationSchema.shape.columns.element.extend({
      columnId: z.literal(heading.id),
      reference: isPercentage
        ? z.null()
        : physical
          ? z
              .object({ cellId: z.literal(heading.id), numberIndex: z.literal(physical.index) })
              .strict()
          : numberRef.nullable(),
      unit: isPercentage
        ? z.literal('%')
        : physical
          ? z.literal(physical.unit)
          : nutritionInterpretationSchema.shape.columns.element.shape.unit,
      values: z.array(z.union(valueSchemas)).max(30),
    });
  });
  return nutritionInterpretationSchema.extend({
    identity: nutritionInterpretationSchema.shape.identity.extend({
      name: ids.nullable(),
      brand: ids.nullable(),
      variant: ids.nullable(),
      description: ids.nullable(),
      ingredients: ids.nullable(),
      aliases: z.array(ids).max(30),
    }),
    package: z.union([...packageSchemas, missingPackage]),
    columns: z
      .array(columnSchemas.length ? z.union(columnSchemas) : z.never())
      .max(Math.min(headings.length, 16)),
    corrections: z
      .array(correctionSchemas.length ? z.union(correctionSchemas) : z.never())
      .max(corrections.length ? 40 : 0),
    problems: z
      .array(
        nutritionInterpretationSchema.shape.problems.element.extend({
          cellIds: z.array(ids).max(30),
        })
      )
      .max(40),
  });
}

const selectionSchema = z.object({
  provider: z.literal('ollama'),
  modelId: z.string().min(1).max(200),
});
export const stageDiagnosticsSchema = z.object({
  stage: z.string(),
  selection: selectionSchema,
  promptVersion: z.string(),
  schemaVersion: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  timeoutMs: z.number().positive(),
  maxOutputTokens: z.number().positive(),
  attempts: z.number().int().nonnegative(),
  status: z.enum(['completed', 'failed', 'cancelled', 'timedOut']),
  errorCode: z.string().optional(),
  reused: z.boolean().optional(),
});
export const stageFailureSchema = z
  .object({
    stage: z.enum(['transcription', 'interpretation']),
    message: z.string().max(2000),
    diagnostics: stageDiagnosticsSchema,
  })
  .strict();
export const transcriptionCheckpointSchema = z
  .object({
    pipeline: z.literal(extractionPipelineVersion),
    inputFingerprint: z.string(),
    evidence: sourceEvidenceSchema,
    transcription: stageDiagnosticsSchema,
    lastFailure: stageFailureSchema.optional(),
  })
  .strict();
export const sourceProvenanceSchema = z.object({
  cellId: sourceId.optional(),
  photographId: sourceId.optional(),
  numberIndex: z.number().int().nonnegative().nullable(),
  correctionId: sourceId.optional(),
  messageId: sourceId.optional(),
});
export const extractionPipelineMetadataSchema = z.object({
  version: z.literal(extractionPipelineVersion),
  evidence: sourceEvidenceSchema,
  interpretation: nutritionInterpretationSchema,
  corrections: z.array(userCorrectionSchema).max(100),
  diagnostics: z.object({
    transcription: stageDiagnosticsSchema,
    interpretation: stageDiagnosticsSchema,
    normalization: z.object({
      durationMs: z.number().nonnegative(),
      status: z.literal('completed'),
      validationFailures: z.array(z.string()),
    }),
    totalDurationMs: z.number().nonnegative(),
  }),
  provenance: z.record(z.string(), z.array(sourceProvenanceSchema)),
});
export type ExtractionPipelineMetadata = z.infer<typeof extractionPipelineMetadataSchema>;

import { z } from 'zod';
import { productInputSchema, decimalSchema } from '../schema';
import { extractionPipelineMetadataSchema } from './pipeline-schema';

// Evidence is deliberately separate from the partial ProductInput patch. Null is unknown, never zero.
export const evidenceSchema = z
  .object({
    value: z.string().max(4000).nullable(),
    status: z.enum(['printed', 'corrected', 'uncertain', 'missing']),
    note: z.string().max(500),
  })
  .strict();
export const nutrientNames = [
  'calories',
  'protein',
  'carbohydrates',
  'fat',
  'fiber',
  'sugars',
  'saturatedFat',
  'salt',
  'sodium',
] as const;
export const extractionSchema = z
  .object({
    name: evidenceSchema,
    brand: evidenceSchema,
    variant: evidenceSchema,
    description: evidenceSchema,
    ingredients: evidenceSchema,
    aliases: z.array(z.string().trim().min(1).max(240)).max(30),
    package: z
      .object({ quantity: evidenceSchema, unit: z.enum(['G', 'KG', 'ML', 'L']).nullable() })
      .strict(),
    tables: z
      .array(
        z
          .object({
            basis: z.enum(['per100', 'serving', 'referenceIntake', 'unknown']),
            unit: z.enum(['G', 'ML']).nullable(),
            servingQuantity: evidenceSchema,
            note: z.string().max(500),
            values: z
              .array(
                z
                  .object({
                    nutrient: z.enum(nutrientNames),
                    unit: z.enum(['g', 'mg', 'kcal', 'kJ', '%']),
                    ...evidenceSchema.shape,
                  })
                  .strict()
              )
              .max(30),
          })
          .strict()
      )
      .max(16),
    warnings: z.array(z.string().max(500)).max(30),
  })
  .strict();

// Inference transcribes fixed rows and physical headings; the application owns basis classification.
const massObservation = evidenceSchema.extend({ unit: z.enum(['g', 'mg', '%']) });
const columnValuesSchema = z
  .object({
    energyKcal: evidenceSchema,
    energyKj: evidenceSchema,
    fat: massObservation,
    saturatedFat: massObservation,
    carbohydrates: massObservation,
    sugars: massObservation,
    fiber: massObservation,
    protein: massObservation,
    salt: massObservation,
    sodium: massObservation,
  })
  .strict();
const physicalColumnSchema = z
  .object({
    referenceQuantity: evidenceSchema.describe(
      'Complete printed column heading, including any physical portion size: "per 100 g", "blokje (4,2 g)". Keep the amount in this value, not just in note.'
    ),
    unit: z.enum(['G', 'ML', '%']).nullable(),
    values: columnValuesSchema,
    note: z.string().max(500),
  })
  .strict();
// Put nutrition first so long ingredient transcription cannot displace it.
// At least one explicit unknown column is required if no physical heading is readable.
export const columnExtractionSchema = z
  .object({
    tables: z.array(physicalColumnSchema).min(1).max(16),
    ...extractionSchema.omit({ tables: true }).shape,
  })
  .strict();
export type ColumnExtraction = z.infer<typeof columnExtractionSchema>;

export const productPatchSchema = z
  .object(productInputSchema.shape)
  .pick({
    name: true,
    brand: true,
    description: true,
    aliases: true,
    calculationMode: true,
    referenceQuantity: true,
    referenceUnit: true,
    calories: true,
    protein: true,
    carbohydrates: true,
    fat: true,
    fiber: true,
    verificationStatus: true,
    servings: true,
  })
  .partial()
  .strict();
const normalizedValueSchema = z.object({
  value: decimalSchema.nullable(),
  status: z.enum(['printed', 'corrected', 'calculated', 'uncertain', 'missing']),
  note: z.string(),
});
export const productSuggestionSchema = z.object({
  version: z.literal(1),
  product: productPatchSchema,
  evidence: extractionSchema,
  nutrition: z.record(z.enum(nutrientNames), normalizedValueSchema),
  warnings: z.array(z.string()),
  pipeline: extractionPipelineMetadataSchema.optional(),
});
export type Extraction = z.infer<typeof extractionSchema>;
export type ProductSuggestion = z.infer<typeof productSuggestionSchema>;

import { z } from 'zod';
import { normalizeProductText } from './normalization';
import { quantityUnits, referenceUnits, sourceTypes, verificationStatuses } from './types';

// PostgreSQL NUMERIC(20,8): 12 integer digits and at most eight fractional digits.
export const decimalSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/,
    'Enter a nonnegative decimal with up to 8 decimal places.'
  );
export const positiveDecimalSchema = decimalSchema.refine(
  (value) => /[1-9]/.test(value),
  'Quantity must be greater than zero.'
);
const optionalText = (length: number) => z.string().trim().max(length).nullable();
const aliasesSchema = (length: number) => z.array(z.string().trim().min(1).max(length)).max(30);

export const servingSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  aliases: aliasesSchema(80),
  quantity: positiveDecimalSchema,
  canonicalUnit: z.enum(referenceUnits),
  isDefault: z.boolean(),
  isEstimated: z.boolean(),
});

export const componentInputSchema = z
  .object({
    childProductId: z.uuid(),
    quantity: positiveDecimalSchema,
    unit: z.enum(quantityUnits),
    servingId: z.uuid().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.servingId && input.unit !== 'SERVING') {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Use the selected serving unit.' });
    }
  });

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    brand: optionalText(240),
    description: optionalText(4000),
    aliases: aliasesSchema(240),
    calculationMode: z.enum(['DIRECT', 'CALCULATED']),
    components: z.array(componentInputSchema).max(40).optional(),
    yieldQuantity: positiveDecimalSchema.nullable().optional(),
    yieldUnit: z.enum(referenceUnits).nullable().optional(),
    referenceQuantity: positiveDecimalSchema,
    referenceUnit: z.enum(referenceUnits),
    referenceLabel: optionalText(80),
    calories: decimalSchema,
    protein: decimalSchema,
    carbohydrates: decimalSchema,
    fat: decimalSchema,
    fiber: decimalSchema.nullable(),
    servingSizeQuantity: positiveDecimalSchema.nullable(),
    servingSizeUnit: z.enum(['G', 'ML']).nullable(),
    servingSizeIsEstimated: z.boolean(),
    densityGramsPerMl: positiveDecimalSchema.nullable(),
    densityIsEstimated: z.boolean(),
    verificationStatus: z.enum(verificationStatuses),
    servings: z.array(servingSchema).max(40),
  })
  .superRefine((product, ctx) => {
    const error = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if ((product.yieldQuantity == null) !== (product.yieldUnit == null)) {
      error(['yieldQuantity'], 'Enter both the prepared yield and its unit.');
    }
    if (product.calculationMode === 'CALCULATED') {
      if (!product.components?.length) {
        error(['components'], 'Add at least one ingredient.');
      }
      if (!product.yieldQuantity || !product.yieldUnit) {
        error(['yieldQuantity'], 'Enter the complete prepared recipe yield.');
      }
    }
    if (normalizeProductText(product.name).length > 240) {
      error(['name'], 'The normalized product name must be at most 240 characters.');
    }
    if (product.referenceUnit === 'SERVING' && !product.referenceLabel?.trim()) {
      error(['referenceLabel'], 'Name the nutrition serving, for example bar or bowl.');
    }
    if ((product.servingSizeQuantity === null) !== (product.servingSizeUnit === null)) {
      error(['servingSizeQuantity'], 'Enter both the physical serving size and its unit.');
    }
    if (product.referenceUnit !== 'SERVING' && product.servingSizeQuantity !== null) {
      error(['servingSizeQuantity'], 'Physical serving size applies to serving-based nutrition.');
    }
    if (product.servingSizeIsEstimated && product.servingSizeQuantity === null) {
      error(['servingSizeIsEstimated'], 'Enter the serving size before marking it estimated.');
    }
    if (product.densityIsEstimated && product.densityGramsPerMl === null) {
      error(['densityIsEstimated'], 'Enter a density before marking it estimated.');
    }
    const names = new Set<string>();
    const ids = new Set<string>();
    product.servings.forEach((serving, index) => {
      const name = normalizeProductText(serving.name);
      if (name.length > 80) {
        error(
          ['servings', index, 'name'],
          'The normalized serving name must be at most 80 characters.'
        );
      }
      if (names.has(name)) {
        error(['servings', index, 'name'], 'Serving names must be unique.');
      }
      names.add(name);
      if (serving.id && ids.has(serving.id)) {
        error(['servings', index, 'id'], 'A serving can only appear once.');
      }
      if (serving.id) {
        ids.add(serving.id);
      }
      if (serving.canonicalUnit === 'SERVING' && product.referenceUnit !== 'SERVING') {
        error(['servings', index, 'canonicalUnit'], 'Use g or ml for this product.');
      }
    });
    if (product.servings.filter((serving) => serving.isDefault).length > 1) {
      error(['servings'], 'Choose at most one default serving.');
    }
  });

// Imports and AI estimates are future write paths. Manual creation cannot forge provenance.
export const productSourceSchema = z.enum(sourceTypes);
export const productIdSchema = z.object({ id: z.uuid() });
export const updateProductSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  product: productInputSchema,
});
export const archiveProductSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  archived: z.boolean(),
});
export const productSearchSchema = z.object({
  query: z.string().trim().max(240).default(''),
  archived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).max(100_000).default(0),
});
export const quantityInputSchema = z
  .object({
    quantity: positiveDecimalSchema,
    unit: z.enum(quantityUnits),
    servingId: z.uuid().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.servingId && input.unit !== 'SERVING') {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Use the selected serving unit.' });
    }
  });
export const calculateProductSchema = z.object({
  id: z.uuid(),
  input: quantityInputSchema,
});
export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductSearchInput = z.infer<typeof productSearchSchema>;

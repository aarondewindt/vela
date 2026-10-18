import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { AiError } from '@/lib/ai/errors';
import { EmbeddingCollectionError } from '@/lib/embeddings/errors';
import { nutritionProductIndex } from './product-index';
import { hybridProductSearchSchema, productRebuildSchema } from './product-search-schema';
import { Prisma } from '../../generated/prisma/client';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { NutritionCalculationError } from './calculations';
import { nutritionProducts } from './products';
import { nutritionDiary } from './diary';
import { nutritionGoals } from './goals';
import { nutritionNevo } from './nevo';
import { NevoImportError } from './nevo-csv';
import { nevoApplySchema, nevoUploadSchema } from './nevo-schema';
import { nutritionDrafts } from './drafts';
import { nutritionDraftGeneration } from './draft-generation';
import {
  createDraftSchema,
  draftIdSchema,
  draftRevisionSchema,
  editDraftSchema,
  draftTurnSchema,
  confirmDraftSchema,
} from './draft-schema';
import {
  createLogEntrySchema,
  deleteLogEntrySchema,
  diaryDaySchema,
  goalsInputSchema,
  previewLogEntrySchema,
  updateLogEntrySchema,
} from './diary-schema';
import {
  archiveProductSchema,
  calculateProductSchema,
  productIdSchema,
  productInputSchema,
  productSearchSchema,
  updateProductSchema,
} from './schema';

async function call<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    if (error instanceof NevoImportError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    if (error instanceof EmbeddingCollectionError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    if (error instanceof AiError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    if (error instanceof NutritionCalculationError || error instanceof ZodError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          error instanceof ZodError ? 'Check the nutrition values and try again.' : error.message,
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2034'].includes(error.code)
    ) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'The nutrition change conflicts with an existing name, reference or version. Reload and try again.',
      });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Nutrition is temporarily unavailable. Please retry.',
    });
  }
}

export const nutritionRouter = router({
  previewNevoImport: protectedProcedure
    .input(nevoUploadSchema)
    .mutation(({ ctx, input }) => call(() => nutritionNevo.preview(ctx.userId, input))),
  applyNevoImport: protectedProcedure
    .input(nevoApplySchema)
    .mutation(({ ctx, input }) => call(() => nutritionNevo.apply(ctx.userId, input))),
  draftModels: protectedProcedure.query(() => call(() => nutritionDraftGeneration.models())),
  listDrafts: protectedProcedure.query(({ ctx }) => call(() => nutritionDrafts.list(ctx.userId))),
  getDraft: protectedProcedure
    .input(draftIdSchema)
    .query(({ ctx, input }) => call(() => nutritionDrafts.get(ctx.userId, input.id))),
  createDraft: protectedProcedure
    .input(createDraftSchema)
    .mutation(({ ctx, input }) => call(() => nutritionDrafts.create(ctx.userId, input))),
  editDraft: protectedProcedure
    .input(editDraftSchema)
    .mutation(({ ctx, input }) => call(() => nutritionDrafts.edit(ctx.userId, input))),
  discardDraft: protectedProcedure
    .input(draftRevisionSchema)
    .mutation(({ ctx, input }) =>
      call(() => nutritionDrafts.discard(ctx.userId, input.id, input.revision))
    ),
  interpretDraft: protectedProcedure
    .input(draftTurnSchema)
    .mutation(({ ctx, input, signal }) =>
      call(() => nutritionDraftGeneration.interpret(ctx.userId, input, signal))
    ),
  confirmDraft: protectedProcedure
    .input(confirmDraftSchema)
    .mutation(({ ctx, input }) => call(() => nutritionDrafts.confirm(ctx.userId, input))),
  searchProducts: protectedProcedure
    .input(hybridProductSearchSchema)
    .query(({ ctx, input }) => call(() => nutritionProducts.search(ctx.userId, input))),
  productIndexStatus: protectedProcedure.query(({ ctx }) =>
    call(() => nutritionProductIndex.status(ctx.userId))
  ),
  retryProductIndex: protectedProcedure.mutation(({ ctx }) =>
    call(() => nutritionProductIndex.retry(ctx.userId))
  ),
  productEmbeddingModels: protectedProcedure.query(({ ctx }) =>
    call(() => nutritionProductIndex.models(ctx.userId))
  ),
  rebuildProductIndex: protectedProcedure
    .input(productRebuildSchema)
    .mutation(({ ctx, input }) =>
      call(() => nutritionProductIndex.rebuild(ctx.userId, input.selection, input.queryInstruction))
    ),
  listProducts: protectedProcedure
    .input(productSearchSchema)
    .query(({ ctx, input }) => call(() => nutritionProducts.list(ctx.userId, input))),
  getProduct: protectedProcedure
    .input(productIdSchema)
    .query(({ ctx, input }) => call(() => nutritionProducts.get(ctx.userId, input.id))),
  createProduct: protectedProcedure
    .input(productInputSchema)
    .mutation(({ ctx, input }) => call(() => nutritionProducts.create(ctx.userId, input))),
  updateProduct: protectedProcedure
    .input(updateProductSchema)
    .mutation(({ ctx, input }) =>
      call(() => nutritionProducts.update(ctx.userId, input.id, input.version, input.product))
    ),
  setProductArchived: protectedProcedure
    .input(archiveProductSchema)
    .mutation(({ ctx, input }) =>
      call(() => nutritionProducts.setArchived(ctx.userId, input.id, input.version, input.archived))
    ),
  calculateProduct: protectedProcedure
    .input(calculateProductSchema)
    .query(({ ctx, input }) =>
      call(() => nutritionProducts.calculate(ctx.userId, input.id, input.input))
    ),
  getDiary: protectedProcedure
    .input(diaryDaySchema)
    .query(({ ctx, input }) => call(() => nutritionDiary.day(ctx.userId, input.date))),
  createLogEntry: protectedProcedure
    .input(createLogEntrySchema)
    .mutation(({ ctx, input }) => call(() => nutritionDiary.create(ctx.userId, input))),
  updateLogEntry: protectedProcedure
    .input(updateLogEntrySchema)
    .mutation(({ ctx, input }) => call(() => nutritionDiary.update(ctx.userId, input))),
  deleteLogEntry: protectedProcedure
    .input(deleteLogEntrySchema)
    .mutation(({ ctx, input }) =>
      call(() => nutritionDiary.remove(ctx.userId, input.id, input.version))
    ),
  previewLogEntry: protectedProcedure
    .input(previewLogEntrySchema)
    .query(({ ctx, input }) =>
      call(() => nutritionDiary.preview(ctx.userId, input.id, input.input))
    ),
  getGoals: protectedProcedure.query(({ ctx }) => call(() => nutritionGoals.get(ctx.userId))),
  saveGoals: protectedProcedure
    .input(goalsInputSchema)
    .mutation(({ ctx, input }) => call(() => nutritionGoals.save(ctx.userId, input))),
});

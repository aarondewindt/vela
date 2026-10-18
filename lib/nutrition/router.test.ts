/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./recipe-autofill', () => ({ autofillRecipe: jest.fn() }));
jest.mock('./products', () => ({
  nutritionProducts: {
    list: jest.fn(),
    search: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setArchived: jest.fn(),
    calculate: jest.fn(),
  },
}));
jest.mock('./diary', () => ({
  nutritionDiary: {
    day: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    preview: jest.fn(),
  },
}));
jest.mock('./goals', () => ({ nutritionGoals: { get: jest.fn(), save: jest.fn() } }));
jest.mock('./history', () => ({ nutritionHistory: { get: jest.fn() } }));
jest.mock('./product-suggestions', () => ({ nutritionSuggestions: { get: jest.fn() } }));
jest.mock('./meal-copy', () => ({ copyNutritionMeal: jest.fn() }));
jest.mock('./nevo', () => ({ nutritionNevo: { preview: jest.fn(), apply: jest.fn() } }));
jest.mock('./drafts', () => ({
  nutritionDrafts: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    edit: jest.fn(),
    discard: jest.fn(),
    confirm: jest.fn(),
  },
}));
jest.mock('./draft-generation', () => ({
  nutritionDraftGeneration: { models: jest.fn(), interpret: jest.fn() },
}));
jest.mock('./product-index', () => ({
  nutritionProductIndex: {
    status: jest.fn(),
    retry: jest.fn(),
    models: jest.fn(),
    rebuild: jest.fn(),
  },
}));
import { autofillRecipe } from './recipe-autofill';
import { nutritionRouter } from './router';
import { nutritionProducts } from './products';
import { NutritionCalculationError } from './calculations';
import { nutritionDiary } from './diary';
import { nutritionGoals } from './goals';
import { nutritionProductIndex } from './product-index';
import { nutritionDrafts } from './drafts';
import { nutritionDraftGeneration } from './draft-generation';
import { nutritionNevo } from './nevo';
import { NevoImportError } from './nevo-csv';
import { nutritionHistory } from './history';
import { nutritionSuggestions } from './product-suggestions';
import { copyNutritionMeal } from './meal-copy';

const id = '00000000-0000-4000-8000-000000000001';
const input = {
  name: 'Milk',
  brand: null,
  description: null,
  aliases: [],
  calculationMode: 'DIRECT' as const,
  referenceQuantity: '100',
  referenceUnit: 'ML' as const,
  referenceLabel: null,
  calories: '45',
  protein: '3.5',
  carbohydrates: '4.8',
  fat: '1.5',
  fiber: null,
  servingSizeQuantity: null,
  servingSizeUnit: null,
  servingSizeIsEstimated: false,
  densityGramsPerMl: null,
  densityIsEstimated: false,
  verificationStatus: 'UNVERIFIED' as const,
  servings: [],
};
beforeEach(() => jest.resetAllMocks());
it('protects history, recent/frequent foods and meal copying with session ownership', async () => {
  const anonymous = nutritionRouter.createCaller({ userId: null });
  const copy = {
    requestId: id,
    sourceDate: '2026-10-17',
    targetDate: '2026-10-18',
    sourceMeal: 'LUNCH' as const,
    targetMeal: 'DINNER' as const,
    entries: [{ id, version: 1 }],
  };
  for (const operation of [
    () => anonymous.getHistory({ endDate: '2026-10-18', days: 7 }),
    () => anonymous.productSuggestions(),
    () => anonymous.copyMeal(copy),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }
  const caller = nutritionRouter.createCaller({ userId: 'owner' });
  await caller.getHistory({ endDate: '2026-10-18', days: 30 });
  await caller.productSuggestions();
  await caller.copyMeal(copy);
  expect(nutritionHistory.get).toHaveBeenCalledWith('owner', { endDate: '2026-10-18', days: 30 });
  expect(nutritionSuggestions.get).toHaveBeenCalledWith('owner');
  expect(copyNutritionMeal).toHaveBeenCalledWith('owner', copy);
});
it('authenticates dataset uploads, takes ownership from the session and returns safe CSV errors', async () => {
  const anonymous = nutritionRouter.createCaller({ userId: null });
  await expect(anonymous.previewNevoImport({ csv: 'CSV' })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(
    anonymous.applyNevoImport({ csv: 'CSV', planHash: 'a'.repeat(64) })
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  const caller = nutritionRouter.createCaller({ userId: 'owner' });
  await caller.previewNevoImport({ csv: 'CSV' });
  expect(nutritionNevo.preview).toHaveBeenCalledWith('owner', {
    csv: 'CSV',
    overwriteEdited: false,
  });
  (nutritionNevo.preview as jest.Mock).mockRejectedValue(
    new NevoImportError('Row 2: PROT is missing.')
  );
  await expect(caller.previewNevoImport({ csv: 'CSV' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Row 2: PROT is missing.',
  });
});
it('authenticates every draft operation and uses only the session owner', async () => {
  const caller = nutritionRouter.createCaller({ userId: null });
  for (const operation of [
    () => caller.draftModels(),
    () => caller.listDrafts(),
    () => caller.getDraft({ id }),
    () =>
      caller.createDraft({
        id,
        date: '2026-10-18',
        mealCategory: 'LUNCH',
        selection: { provider: 'ollama', modelId: 'chat' },
      }),
    () => caller.editDraft({ id, revision: 1, change: { type: 'add', query: 'Food' } }),
    () => caller.discardDraft({ id, revision: 1 }),
    () => caller.confirmDraft({ id, revision: 1 }),
    () => caller.interpretDraft({ id, revision: 1, requestId: id, text: 'Rice' }),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }
  [...Object.values(nutritionDrafts), ...Object.values(nutritionDraftGeneration)].forEach(
    (method) => expect(method).not.toHaveBeenCalled()
  );
  const authorized = nutritionRouter.createCaller({ userId: 'owner' });
  await authorized.editDraft({ id, revision: 1, change: { type: 'add', query: 'Food' } });
  expect(nutritionDrafts.edit).toHaveBeenCalledWith('owner', {
    id,
    revision: 1,
    change: { type: 'add', query: 'Food' },
  });
});
it('authenticates every catalog and calculation procedure', async () => {
  const caller = nutritionRouter.createCaller({ userId: null });
  for (const operation of [
    () => caller.listProducts({}),
    () => caller.searchProducts({ query: 'nuts' }),
    () => caller.productIndexStatus(),
    () => caller.retryProductIndex(),
    () => caller.productEmbeddingModels(),
    () => caller.rebuildProductIndex({ selection: { provider: 'ollama', modelId: 'embed' } }),
    () => caller.getProduct({ id }),
    () => caller.createProduct(input),
    () => caller.updateProduct({ id, version: 1, product: input }),
    () => caller.setProductArchived({ id, version: 1, archived: true }),
    () => caller.calculateProduct({ id, input: { quantity: '1', unit: 'ML' } }),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }
  Object.values(nutritionProducts).forEach((method) => expect(method).not.toHaveBeenCalled());
  Object.values(nutritionProductIndex).forEach((method) => expect(method).not.toHaveBeenCalled());
});
it('takes ownership from the session and validates before service calls', async () => {
  const caller = nutritionRouter.createCaller({ userId: 'owner' });
  await caller.createProduct({ ...input, userId: 'foreign' } as typeof input);
  expect(nutritionProducts.create).toHaveBeenCalledWith('owner', input);
  await expect(
    caller.calculateProduct({ id, input: { quantity: '0', unit: 'ML' } })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(nutritionProducts.calculate).not.toHaveBeenCalled();
});
it('returns safe conversion errors and masks database details', async () => {
  const caller = nutritionRouter.createCaller({ userId: 'owner' });
  (nutritionProducts.calculate as jest.Mock).mockRejectedValue(
    new NutritionCalculationError('Density is required.')
  );
  await expect(
    caller.calculateProduct({ id, input: { quantity: '1', unit: 'G' } })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Density is required.' });
  (nutritionProducts.get as jest.Mock).mockRejectedValue(new Error('private query details'));
  await expect(caller.getProduct({ id })).rejects.toMatchObject({
    message: 'Nutrition is temporarily unavailable. Please retry.',
  });
});

const entryInput = {
  requestId: id,
  productId: id,
  productVersion: 1,
  logDate: '2026-10-17',
  mealCategory: 'BREAKFAST' as const,
  input: { quantity: '30', unit: 'G' as const },
};
it('authenticates all diary and goal procedures', async () => {
  const caller = nutritionRouter.createCaller({ userId: null });
  for (const operation of [
    () => caller.getDiary({ date: '2026-10-17' }),
    () => caller.createLogEntry(entryInput),
    () =>
      caller.updateLogEntry({
        id,
        version: 1,
        logDate: '2026-10-17',
        mealCategory: 'LUNCH',
        input: entryInput.input,
      }),
    () => caller.deleteLogEntry({ id, version: 1 }),
    () => caller.previewLogEntry({ id, input: entryInput.input }),
    () => caller.getGoals(),
    () =>
      caller.saveGoals({
        version: 0,
        calories: null,
        protein: null,
        carbohydrates: null,
        fat: null,
      }),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }
  [...Object.values(nutritionDiary), ...Object.values(nutritionGoals)].forEach((method) =>
    expect(method).not.toHaveBeenCalled()
  );
});
it('passes only session ownership and validated logging fields to services', async () => {
  const caller = nutritionRouter.createCaller({ userId: 'owner' });
  await caller.getDiary({ date: '2026-10-17' });
  await caller.createLogEntry({
    ...entryInput,
    userId: 'foreign',
    calories: '1',
    referenceSnapshot: {},
  } as typeof entryInput);
  await caller.saveGoals({
    version: 0,
    calories: '2400',
    protein: null,
    carbohydrates: null,
    fat: null,
  });
  expect(nutritionDiary.day).toHaveBeenCalledWith('owner', '2026-10-17');
  expect(nutritionDiary.create).toHaveBeenCalledWith('owner', entryInput);
  expect(nutritionGoals.save).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ calories: '2400' })
  );
});
it('rejects malformed calendar dates and zero goals before persistence', async () => {
  const caller = nutritionRouter.createCaller({ userId: 'owner' });
  await expect(caller.getDiary({ date: '2026-02-29' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(
    caller.createLogEntry({ ...entryInput, logDate: '2026-10-17T12:00:00Z' })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(
    caller.saveGoals({ version: 0, calories: '0', protein: null, carbohydrates: null, fat: null })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(nutritionGoals.save).not.toHaveBeenCalled();
  expect(nutritionDiary.create).not.toHaveBeenCalled();
});

it('authenticates and scopes recipe autofill without creating a product', async () => {
  const request = {
    name: '',
    aliases: [],
    description: null,
    components: [{ childProductId: id, quantity: '1', unit: 'G' as const }],
    yieldQuantity: null,
    yieldUnit: null,
  };
  await expect(
    nutritionRouter.createCaller({ userId: null }).autofillRecipe(request)
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await nutritionRouter.createCaller({ userId: 'owner' }).autofillRecipe(request);
  expect(autofillRecipe).toHaveBeenCalledWith('owner', request, undefined);
  expect(nutritionProducts.create).not.toHaveBeenCalled();
});

/** @jest-environment node */
import { generationReviewSchema, reviewDocumentSchema } from './schema';
it('restricts theme suggestions to supplied themes and supports explicit removal', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const schema = generationReviewSchema([id]).shape.themeId;
  expect(schema.safeParse({ value: id, explanation: 'Matches.' }).success).toBe(true);
  expect(schema.safeParse({ value: 'NONE', explanation: 'Remove.' }).success).toBe(true);
  expect(
    schema.safeParse({ value: '00000000-0000-4000-8000-000000000002', explanation: 'Invented.' })
      .success
  ).toBe(false);
});
it('validates categories and bounds replacement tags and brief text', () => {
  expect(
    reviewDocumentSchema.shape.category.safeParse({ value: 'OTHER', explanation: 'Bad.' }).success
  ).toBe(false);
  const tags = reviewDocumentSchema.shape.tags;
  for (const value of [
    ['duplicate', 'duplicate'],
    [' '],
    ['x'.repeat(41)],
    Array(31).fill('tag'),
  ]) {
    expect(tags.safeParse({ value, explanation: 'Bad.' }).success).toBe(false);
  }
  expect(
    reviewDocumentSchema.shape.brief.safeParse({
      value: 'x'.repeat(4001),
      explanation: 'Too long.',
    }).success
  ).toBe(false);
});

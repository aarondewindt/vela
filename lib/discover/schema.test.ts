/* eslint-disable no-script-url -- Tests verify rejection of unsafe URLs. */
import { itemInputSchema, listItemsSchema, quickAddSchema, statusLabels } from './schema';

it('requires only a title and supplies the shared workflow defaults', () => {
  expect(itemInputSchema.parse({ title: '  Dune  ' })).toEqual({
    title: 'Dune',
    contentType: 'Other',
    status: 'WANT_TO_EXPLORE',
    description: null,
    url: null,
    imageUrl: null,
    tags: [],
    priority: null,
    notes: null,
    rating: null,
  });
  expect(itemInputSchema.safeParse({}).success).toBe(false);
  expect(itemInputSchema.safeParse({ title: '  ' }).success).toBe(false);
  expect(itemInputSchema.safeParse({ title: 'x'.repeat(241) }).success).toBe(false);
});
it('allows custom types, all statuses, optional details, zero ratings and normalized tags', () => {
  for (const status of Object.keys(statusLabels)) {
    expect(
      itemInputSchema.parse({
        title: 'Explore',
        contentType: 'Museum',
        status,
        rating: 0,
        tags: [' Space ', 'space', 'SCI-FI'],
        notes: '  My notes  ',
        description: ' ',
        url: '',
        imageUrl: null,
      })
    ).toMatchObject({
      contentType: 'Museum',
      status,
      rating: 0,
      tags: ['space', 'sci-fi'],
      notes: 'My notes',
      description: null,
      url: null,
      imageUrl: null,
    });
  }
});
it.each(['https://example.com/a?q=b#section', 'http://localhost:8080/', 'https://例え.jp/本'])(
  'accepts web URL %s',
  (url) => {
    expect(itemInputSchema.parse({ title: 'Link', url, imageUrl: url }).url).toBe(url);
  }
);
it.each([
  'invalid',
  'javascript:alert(1)',
  'data:image/png;base64,a',
  'ftp://example.com',
  'https://user:secret@example.com',
  'https://',
  `https://${'x'.repeat(2048)}`,
])('rejects unsafe or invalid URLs without throwing outside validation: %s', (url) => {
  expect(itemInputSchema.safeParse({ title: 'Link', url }).success).toBe(false);
  expect(itemInputSchema.safeParse({ title: 'Link', imageUrl: url }).success).toBe(false);
});
it.each([
  { rating: -1 },
  { rating: 11 },
  { rating: 5.5 },
  { rating: '5' },
  { priority: 0 },
  { priority: 4 },
  { priority: 1.5 },
  { status: 'DONE' },
  { contentType: '' },
  { tags: [' '] },
  { tags: ['x'.repeat(61)] },
  { notes: 'x'.repeat(20001) },
  { description: 'x'.repeat(10001) },
])('rejects out of range fields: %j', (patch) => {
  expect(itemInputSchema.safeParse({ title: 'Item', ...patch }).success).toBe(false);
});
it('quick adds titles or URLs without a metadata dependency', () => {
  expect(quickAddSchema.parse({ text: '  Outer Wilds ', contentType: 'Video game' })).toMatchObject(
    { title: 'Outer Wilds', url: null, contentType: 'Video game' }
  );
  const url = `https://example.com/${'a'.repeat(300)}`;
  expect(quickAddSchema.parse({ text: url })).toMatchObject({
    title: url.slice(0, 240),
    url,
    contentType: 'Other',
  });
  expect(quickAddSchema.safeParse({ text: 'https://' }).success).toBe(false);
  expect(quickAddSchema.safeParse({ text: '' }).success).toBe(false);
  expect(quickAddSchema.safeParse({ text: 'x'.repeat(241) }).success).toBe(false);
});
it('bounds collection queries and normalizes exact tags', () => {
  expect(listItemsSchema.parse({ tag: ' SPACE ' })).toMatchObject({
    query: '',
    tag: 'space',
    sort: 'newest',
    limit: 24,
    offset: 0,
  });
  for (const input of [
    { limit: 101 },
    { offset: -1 },
    { sort: 'random' },
    { query: 'x'.repeat(241) },
  ]) {
    expect(listItemsSchema.safeParse(input).success).toBe(false);
  }
});

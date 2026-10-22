/** @jest-environment node */
/* eslint-disable no-script-url -- Verifies unsafe metadata images are rejected. */
jest.mock('server-only', () => ({}));
import { extractMetadata } from './metadata';

const source = 'https://example.com/original';
const final = 'https://example.com/articles/page';
it('prefers Open Graph, decodes entities, resolves images, and retains provenance', () => {
  const result = extractMetadata(
    `<title>Fallback</title><meta property="og:title" content="Book &amp; film"><meta name="twitter:title" content="Twitter"><meta property="og:description" content=" A story "><meta property="og:image" content="../cover.jpg"><meta property="og:site_name" content="Library">`,
    source,
    final
  );
  expect(result).toEqual({
    provider: 'web',
    sourceUrl: source,
    resolvedUrl: final,
    retrievedAt: expect.any(String),
    siteName: 'Library',
    title: 'Book & film',
    description: 'A story',
    imageUrl: 'https://example.com/cover.jpg',
  });
});
it('supports title, standard descriptions, Twitter and microdata fallbacks', () => {
  expect(
    extractMetadata(
      '<title> Page &amp; title </title><meta name="description" content="Details">',
      source,
      final
    )
  ).toMatchObject({ title: 'Page & title', description: 'Details', imageUrl: null });
  expect(
    extractMetadata(
      '<meta name="twitter:title" content="Tweet"><meta name="twitter:image" content="/pic">',
      source,
      final
    )
  ).toMatchObject({ title: 'Tweet', imageUrl: 'https://example.com/pic' });
  expect(extractMetadata('<meta itemprop="name" content="Microdata">', source, final).title).toBe(
    'Microdata'
  );
});
it('extracts bounded JSON-LD without following scripts and tolerates malformed structured data', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"headline":"Article","description":"Summary","image":{"url":"/cover"}}]}</script>`;
  expect(extractMetadata(html, source, final)).toMatchObject({
    title: 'Article',
    description: 'Summary',
    imageUrl: 'https://example.com/cover',
  });
  expect(
    extractMetadata(
      '<script type="application/ld+json">bad</script><title>Fallback</title>',
      source,
      final
    ).title
  ).toBe('Fallback');
  expect(extractMetadata(`<title>${'a'.repeat(500)}</title>`, source, final).title).toHaveLength(
    240
  );
});
it('returns empty/partial metadata and rejects unsafe image schemes or credentials', () => {
  expect(extractMetadata('<html></html>', source, final)).toMatchObject({
    title: null,
    description: null,
    imageUrl: null,
  });
  for (const image of ['javascript:alert(1)', 'https://user:pass@example.com/pic']) {
    expect(
      extractMetadata(
        `<title>Only title</title><meta property="og:image" content="${image}">`,
        source,
        final
      )
    ).toMatchObject({ title: 'Only title', imageUrl: null });
  }
});

import 'server-only';
import { Parser } from 'htmlparser2';
import { webUrlSchema } from './schema';

export type PageMetadata = {
  provider: 'web';
  sourceUrl: string;
  resolvedUrl: string;
  siteName: string | null;
  retrievedAt: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

// No scripts, embedded resources, canonical URLs or provider APIs are followed.
export function extractMetadata(
  html: string,
  sourceUrl: string,
  resolvedUrl: string
): PageMetadata {
  const meta = new Map<string, string>();
  let pageTitle = '';
  let inTitle = false;
  let inJson = false;
  let json = '';
  const structured: Record<string, unknown>[] = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        inTitle = name === 'title' || inTitle;
        if (name === 'meta') {
          const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
          if (attrs.content?.trim() && !meta.has(key)) {
            meta.set(key, attrs.content);
          }
        }
        if (name === 'script' && attrs.type?.toLowerCase() === 'application/ld+json') {
          inJson = true;
          json = '';
        }
      },
      ontext(text) {
        if (inTitle) {
          pageTitle += text;
        }
        if (inJson) {
          json += text;
        }
      },
      onclosetag(name) {
        if (name === 'title') {
          inTitle = false;
        }
        if (name === 'script' && inJson) {
          inJson = false;
          try {
            const parsed: unknown = JSON.parse(json);
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            for (const entry of entries) {
              if (entry && typeof entry === 'object') {
                structured.push(entry);
                if (Array.isArray(entry['@graph'])) {
                  structured.push(...entry['@graph']);
                }
              }
            }
          } catch {
            // Malformed optional JSON-LD does not invalidate the page's other metadata.
          }
        }
      },
    },
    { decodeEntities: true }
  );
  parser.end(html);
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;
  const ld = (key: string) =>
    structured.find((entry) => entry && typeof entry[key] === 'string')?.[key];
  const image = structured.find((entry) => entry && entry.image)?.image;
  const imageValue = Array.isArray(image) ? image[0] : image;
  const imageCandidate =
    meta.get('og:image') ||
    meta.get('twitter:image') ||
    meta.get('image') ||
    (typeof imageValue === 'object' && imageValue ? imageValue.url : imageValue);
  let imageUrl: string | null = null;
  if (typeof imageCandidate === 'string') {
    try {
      const parsed = webUrlSchema.safeParse(new URL(imageCandidate, resolvedUrl).href);
      if (parsed.success) {
        imageUrl = parsed.data;
      }
    } catch {
      /* Ignore invalid optional images. */
    }
  }
  return {
    provider: 'web',
    sourceUrl,
    resolvedUrl,
    retrievedAt: new Date().toISOString(),
    siteName: text(meta.get('og:site_name'), 240),
    title: text(
      meta.get('og:title') ||
        meta.get('twitter:title') ||
        meta.get('name') ||
        ld('headline') ||
        ld('name') ||
        pageTitle,
      240
    ),
    description: text(
      meta.get('og:description') ||
        meta.get('twitter:description') ||
        meta.get('description') ||
        ld('description'),
      10000
    ),
    imageUrl,
  };
}

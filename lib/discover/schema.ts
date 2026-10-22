import { z } from 'zod';

export const contentTypes = [
  'Movie',
  'TV show',
  'Video game',
  'Book',
  'Article',
  'Video',
  'Podcast',
  'Application',
  'Website',
  'Other',
];
export const statusLabels = {
  WANT_TO_EXPLORE: 'Want to Explore',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  DROPPED: 'Dropped',
} as const;
export const statusSchema = z.enum(
  Object.keys(statusLabels) as [keyof typeof statusLabels, ...(keyof typeof statusLabels)[]]
);
export const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({
  value,
  label,
}));
export const priorityOptions = [
  { value: '3', label: 'High' },
  { value: '2', label: 'Medium' },
  { value: '1', label: 'Low' },
];
export const sortOptions = [
  { value: 'newest', label: 'Newest added' },
  { value: 'oldest', label: 'Oldest added' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'priority', label: 'Highest priority' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'updated', label: 'Recently updated' },
];
const contentTypeSchema = z.string().trim().min(1).max(80);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
export const webUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  }, 'Use an HTTP or HTTPS URL without embedded credentials.');
const optionalUrl = z
  .union([webUrlSchema, z.literal(''), z.null()])
  .optional()
  .transform((value) => value || null);
const tagSchema = z.string().trim().min(1).max(60).toLowerCase();

export const itemInputSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(240),
  contentType: contentTypeSchema.default('Other'),
  status: statusSchema.default('WANT_TO_EXPLORE'),
  description: optionalText(10000),
  url: optionalUrl,
  imageUrl: optionalUrl,
  tags: z
    .array(tagSchema)
    .max(30)
    .default([])
    .transform((tags) => [...new Set(tags)]),
  priority: z.number().int().min(1).max(3).nullable().default(null),
  notes: optionalText(20000),
  rating: z.number().int().min(0).max(10).nullable().default(null),
});
export const quickAddSchema = z
  .object({
    text: z.string().trim().min(1, 'Enter a title or URL.').max(2048),
    contentType: contentTypeSchema.default('Other'),
  })
  .transform(({ text, contentType }, ctx) => {
    const isUrl = /^https?:\/\//i.test(text);
    // A URL is a useful initial title without fetching anything from the internet.
    const parsed = itemInputSchema.safeParse({
      title: isUrl ? text.slice(0, 240) : text,
      url: isUrl ? text : null,
      contentType,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: [issue.path[0] === 'contentType' ? 'contentType' : 'text'],
        });
      }
      return z.NEVER;
    }
    return parsed.data;
  });

export const itemIdSchema = z.object({ id: z.uuid() });
export const itemVersionSchema = itemIdSchema.extend({ version: z.number().int().positive() });
export const updateItemSchema = itemVersionSchema.extend({ item: itemInputSchema });
export const setStatusSchema = itemVersionSchema.extend({ status: statusSchema });
export const listItemsSchema = z.object({
  query: z.string().trim().max(240).default(''),
  contentType: contentTypeSchema.optional(),
  status: statusSchema.optional(),
  tag: tagSchema.optional(),
  priority: z.number().int().min(1).max(3).optional(),
  sort: z.enum(['newest', 'oldest', 'title', 'priority', 'rating', 'updated']).default('newest'),
  limit: z.number().int().min(1).max(100).default(24),
  offset: z.number().int().min(0).default(0),
});
export type ItemInput = z.output<typeof itemInputSchema>;
export type ListItemsInput = z.output<typeof listItemsSchema>;

export const pageMetadataSchema = z.object({
  provider: z.literal('web'),
  sourceUrl: webUrlSchema,
  resolvedUrl: webUrlSchema,
  siteName: z.string().nullable(),
  retrievedAt: z.iso.datetime(),
  title: z.string().max(240).nullable(),
  description: z.string().max(10000).nullable(),
  imageUrl: webUrlSchema.nullable(),
});

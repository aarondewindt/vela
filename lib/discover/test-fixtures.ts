import type { DiscoverItem } from './service';
import { itemInputSchema } from './schema';

export const itemFixture: DiscoverItem = {
  ...itemInputSchema.parse({ title: 'Dune', contentType: 'Book' }),
  id: '00000000-0000-4000-8000-000000000001',
  version: 1,
  createdAt: new Date('2026-10-22T10:00:00Z'),
  updatedAt: new Date('2026-10-22T10:00:00Z'),
};

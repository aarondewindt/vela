import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { healthRangeSchema, type HealthRange } from '@/lib/health/history-range';

export const useHealthHistoryStore = create<{
  range: HealthRange;
  setRange: (range: HealthRange) => void;
}>()(
  persist((set) => ({ range: '10d', setRange: (range) => set({ range }) }), {
    name: 'health-history',
    storage: createJSONStorage(() => localStorage),
    partialize: ({ range }) => ({ range }),
    merge: (saved, current) => ({
      ...current,
      range:
        healthRangeSchema.safeParse((saved as { range?: unknown } | null)?.range).data ?? '10d',
    }),
    skipHydration: true,
  })
);

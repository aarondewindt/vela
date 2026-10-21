import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type NutritionProductsState = {
  fuzzySearch: boolean;
  setFuzzySearch: (enabled: boolean) => void;
};

export const useNutritionProductsStore = create<NutritionProductsState>()(
  persist(
    (set) => ({
      fuzzySearch: true,
      setFuzzySearch: (fuzzySearch) => set({ fuzzySearch }),
    }),
    {
      name: 'nutrition-products',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ fuzzySearch }) => ({ fuzzySearch }),
      // Restore after mount so the initial render matches the server.
      skipHydration: true,
    }
  )
);

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AppShellResizeSizes } from '@mantine/core';

type AppShellStoreState = {
  navbar_opened: boolean;
  aside_opened: boolean;
  sizes: AppShellResizeSizes;
};

type AppShellStoreActions = {
  toggle_navbar: () => void;
  set_aside_opened: (opened: boolean) => void;
  set_sizes: (sizes: AppShellResizeSizes) => void;
};

type AppShellStore = AppShellStoreState & AppShellStoreActions;

type PersistedState = Pick<AppShellStoreState, 'sizes'>;

const jsonStorage = createJSONStorage<PersistedState>(() => localStorage);
let hydrated = false;

// Writes before hydration would overwrite the saved sizes with the defaults.
const guardedStorage = jsonStorage && {
  ...jsonStorage,
  setItem: (name: string, value: Parameters<typeof jsonStorage.setItem>[1]) =>
    hydrated ? jsonStorage.setItem(name, value) : undefined,
};

export const useAppShellStore = create<AppShellStore>()(
  persist(
    (set) => ({
      navbar_opened: false,
      aside_opened: false,
      sizes: {},
      toggle_navbar: () => set((state) => ({ navbar_opened: !state.navbar_opened })),
      set_aside_opened: (opened) => set({ aside_opened: opened }),
      set_sizes: (sizes) => set({ sizes }),
    }),
    {
      name: 'app-shell',
      storage: guardedStorage,
      partialize: ({ sizes }): PersistedState => ({ sizes }),
      // Rehydrated in an effect to avoid a server/client hydration mismatch.
      skipHydration: true,
      onRehydrateStorage: () => () => {
        hydrated = true;
      },
    }
  )
);

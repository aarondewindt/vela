import { create } from 'zustand'

type AppShellStoreState = {
  navbar_opened: boolean;
};

type AppShellStoreActions = {
  toggle_navbar: () => void;
};

type AppShellStore = AppShellStoreState & AppShellStoreActions;


export const useAppShellStore = create<AppShellStore>((set) => ({
  navbar_opened: false,
  toggle_navbar: () => set((state) => ({ navbar_opened: !state.navbar_opened })),
}));

import { create } from 'zustand';
import type { ViewConfig } from '@/lib/views/types';

export type Selection = { type: 'task' | 'theme'; id: string } | null;

type TasksViewState = {
  activeViewId: string;
  // Unsaved edits on top of the active view; null means "as saved".
  draft: ViewConfig | null;
  search: string;
  selection: Selection;
  collapsed: Record<string, boolean>;
};

type TasksViewActions = {
  setActiveView: (id: string) => void;
  setDraft: (config: ViewConfig | null) => void;
  setSearch: (search: string) => void;
  select: (selection: Selection) => void;
  toggleCollapsed: (key: string) => void;
};

export const useTasksViewStore = create<TasksViewState & TasksViewActions>((set) => ({
  activeViewId: 'builtin:all',
  draft: null,
  search: '',
  selection: null,
  collapsed: {},
  setActiveView: (id) => set({ activeViewId: id, draft: null }),
  setDraft: (draft) => set({ draft }),
  setSearch: (search) => set({ search }),
  select: (selection) => set({ selection }),
  toggleCollapsed: (key) => set((state) => ({ collapsed: { ...state.collapsed, [key]: !state.collapsed[key] } })),
}));

import { usePlannerStore } from '@/lib/planner/store';
import { create } from 'zustand';

// Transient references only. Proposal content stays in the tRPC query cache.
type PreviewReference = { id: string; date: string };
export const usePlanningWorkspaceStore = create<{
  preview: PreviewReference | null;
  focusedBlockId: string | null;
  focusedTaskId: string | null;
  showPreview: (preview: PreviewReference | null) => void;
  focus: (blockId: string | null, taskId?: string | null) => void;
}>((set) => ({
  preview: null,
  focusedBlockId: null,
  focusedTaskId: null,
  showPreview: (preview) => {
    if (preview) {
      usePlannerStore.getState().setSelectedDate(preview.date);
    }
    set({ preview, focusedBlockId: null, focusedTaskId: null });
  },
  focus: (focusedBlockId, focusedTaskId = null) => set({ focusedBlockId, focusedTaskId }),
}));

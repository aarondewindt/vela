'use client';

import { trpc } from '@/lib/trpc/client';

export function useTasksQuery() {
  return trpc.planner.listTasks.useQuery();
}

export function useThemesQuery() {
  return trpc.planner.listThemes.useQuery();
}

export function useViewsQuery(scope: string) {
  return trpc.planner.listViews.useQuery({ scope });
}

export function useCreateTaskMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.createTask.useMutation({
    onSuccess: () => utils.planner.listTasks.invalidate(),
  });
}

export function useUpdateTaskMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.updateTask.useMutation({
    onSuccess: () => utils.planner.listTasks.invalidate(),
  });
}

export function useDeleteTaskMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.deleteTask.useMutation({
    onSuccess: () => utils.planner.listTasks.invalidate(),
  });
}

export function useTaskContentQuery(id: string) {
  return trpc.planner.getTaskContent.useQuery({ id }, { staleTime: Infinity });
}

export function useUpdateTaskContentMutation() {
  const utils = trpc.useUtils();

  // Keep the cached document in sync so reopening a task shows the latest edit.
  return trpc.planner.updateTaskContent.useMutation({
    onMutate: ({ id, content }) => utils.planner.getTaskContent.setData({ id }, content),
  });
}

export function useCreateThemeMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.createTheme.useMutation({
    onSuccess: () => utils.planner.listThemes.invalidate(),
  });
}

export function useUpdateThemeMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.updateTheme.useMutation({
    onSuccess: () => utils.planner.listThemes.invalidate(),
  });
}

export function useThemeContentQuery(id: string) {
  return trpc.planner.getThemeContent.useQuery({ id }, { staleTime: Infinity });
}

export function useUpdateThemeContentMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.updateThemeContent.useMutation({
    onMutate: ({ id, content }) => utils.planner.getThemeContent.setData({ id }, content),
  });
}

export function useReorderThemesMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.reorderThemes.useMutation({
    onSuccess: () => utils.planner.listThemes.invalidate(),
  });
}

export function useCreateViewMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.createView.useMutation({
    onSuccess: () => utils.planner.listViews.invalidate(),
  });
}

export function useUpdateViewMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.updateView.useMutation({
    onSuccess: () => utils.planner.listViews.invalidate(),
  });
}

export function useDeleteViewMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.deleteView.useMutation({
    onSuccess: () => utils.planner.listViews.invalidate(),
  });
}

export function usePlanQuery(date: string) {
  return trpc.planner.getPlan.useQuery({ date });
}

export function useDayDataQuery(date: string) {
  return trpc.planner.getDayData.useQuery({ date });
}

export function useApplyStandardAvailabilityMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.applyStandardAvailability.useMutation({
    onSuccess: (_result, { date }) => utils.planner.getDayData.invalidate({ date }),
  });
}

export function useCreateManualBlockMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.createManualBlock.useMutation({
    onSuccess: (_result, { date }) => {
      utils.planner.getDayData.invalidate({ date });
      utils.planner.listTasks.invalidate();
    },
  });
}

export function useUpdateBlockTimeMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.updateBlockTime.useMutation({
    onSuccess: (_result, { date }) => utils.planner.getDayData.invalidate({ date }),
  });
}

export function useUpdateBlockOutcomeMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.updateBlockOutcome.useMutation({
    onSuccess: (_result, { date }) => {
      utils.planner.getDayData.invalidate({ date });
      utils.planner.listTasks.invalidate();
    },
  });
}

export function useRemoveBlockFromDayMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.removeBlockFromDay.useMutation({
    onSuccess: (_result, { date }) => {
      utils.planner.getDayData.invalidate({ date });
      utils.planner.listTasks.invalidate();
    },
  });
}

export function useUnskipBlockMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.unskipBlock.useMutation({
    onSuccess: (_result, { date }) => {
      utils.planner.getDayData.invalidate({ date });
      utils.planner.listTasks.invalidate();
    },
  });
}

export function useGenerateDraftMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.generateDraft.useMutation({
    onSuccess: (_plan, { date }) => {
      utils.planner.getPlan.invalidate({ date });
      utils.planner.listTasks.invalidate();
    },
  });
}

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

'use client';

import { trpc } from '@/lib/trpc/client';

export function useTasksQuery() {
  return trpc.planner.listTasks.useQuery();
}

export function useCreateTaskMutation() {
  const utils = trpc.useUtils();

  return trpc.planner.createTask.useMutation({
    onSuccess: () => utils.planner.listTasks.invalidate(),
  });
}

export function usePlanQuery(date: string) {
  return trpc.planner.getPlan.useQuery({ date });
}

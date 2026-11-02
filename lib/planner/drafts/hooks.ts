'use client';
import { trpc } from '@/lib/trpc/client';
import { wallInstant, timeMinute } from '../proposals/time';
import type { PlanningCategoryValue } from '../tasks';

type Callbacks = { onSuccess?: () => void };
export function useWorkingDraft(date: string, timezone: string) {
  const utils = trpc.useUtils();
  const query = trpc.plannerDraft.read.useQuery({ date }, { refetchInterval: 10000, retry: false });
  const draft = query.data?.draft;
  const invalidate = () =>
    Promise.all([
      utils.plannerDraft.read.invalidate(),
      utils.planner.getDayData.invalidate(),
      utils.planner.getPlan.invalidate(),
      utils.planner.listTasks.invalidate(),
    ]);
  const options = {
    onSuccess: invalidate,
    onError: () => {
      void query.refetch();
    },
  };
  const edit = trpc.plannerDraft.edit.useMutation(options);
  const slot = trpc.plannerDraft.slot.useMutation(options);
  const apply = trpc.plannerDraft.applyChanges.useMutation(options);
  const generate = trpc.plannerDraft.generate.useMutation(options);
  const accept = trpc.plannerDraft.accept.useMutation(options);
  const cancel = trpc.plannerDraft.cancel.useMutation(options);
  const undo = trpc.plannerDraft.undo.useMutation(options);
  const redo = trpc.plannerDraft.redo.useMutation(options);
  const refresh = trpc.plannerDraft.refresh.useMutation(options);
  const command = () => ({
    date,
    requestId: crypto.randomUUID(),
    draftId: draft?.id ?? null,
    expectedVersion: draft?.version ?? 0,
  });
  const localInstant = (value: string) =>
    wallInstant(
      value.slice(0, 10),
      timeMinute(value.slice(11, 16)),
      draft?.timezone ?? timezone
    ).toISOString();
  const createBlock = {
    ...edit,
    mutate: (input: { date: string; taskId: string; startsAt: string }, callbacks?: Callbacks) =>
      edit.mutate({ ...command(), ...input, action: 'add' }, callbacks),
  };
  const updateBlockTime = {
    ...edit,
    mutate: (
      input: { date: string; blockId: string; startsAt: string; endsAt: string },
      callbacks?: Callbacks
    ) => {
      edit.mutate({ ...command(), ...input, action: 'time' }, callbacks);
    },
  };
  const removeBlock = {
    ...edit,
    mutate: (input: { date: string; blockId: string }, callbacks?: Callbacks) =>
      edit.mutate({ ...command(), ...input, action: 'remove' }, callbacks),
  };
  const createCategoryBlock = {
    ...slot,
    mutate: (
      input: { date: string; category: PlanningCategoryValue; startsAt: string; endsAt: string },
      callbacks?: Callbacks
    ) =>
      slot.mutate(
        {
          ...command(),
          action: 'add',
          category: input.category,
          startsAt: localInstant(input.startsAt),
          endsAt: localInstant(input.endsAt),
        },
        callbacks
      ),
  };
  const updateCategorySlotTime = {
    ...slot,
    mutate: (
      input: { date: string; slotId: string; startsAt: string; endsAt: string },
      callbacks?: Callbacks
    ) =>
      slot.mutate(
        {
          ...command(),
          action: 'move',
          slotId: input.slotId,
          startsAt: localInstant(input.startsAt),
          endsAt: localInstant(input.endsAt),
        },
        callbacks
      ),
  };
  const removeCategorySlot = {
    ...slot,
    mutate: (input: { date: string; slotId: string }, callbacks?: Callbacks) =>
      slot.mutate({ ...command(), action: 'remove', slotId: input.slotId }, callbacks),
  };
  return {
    query,
    draft,
    command,
    generate,
    accept,
    cancel,
    undo,
    redo,
    refresh,
    apply,
    createBlock,
    updateBlockTime,
    removeBlock,
    createCategoryBlock,
    updateCategorySlotTime,
    removeCategorySlot,
    busy: [edit, slot, apply, generate, accept, cancel, undo, redo, refresh].some(
      (m) => m.isPending
    ),
    error:
      query.error ??
      edit.error ??
      slot.error ??
      apply.error ??
      generate.error ??
      accept.error ??
      cancel.error ??
      undo.error ??
      redo.error ??
      refresh.error,
  };
}

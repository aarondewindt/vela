import 'server-only';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@/generated/prisma/client';
import { plannerService } from '../service';
import { fingerprint } from '../proposals/snapshot';
import { taskPatchSchema, themePatchSchema } from '../record-schema';
import { Clarification, conflict, findMatches, resolveOne } from './resolve';
import type { Instruction, RecordPreview } from './schema';

export async function recordContext(tx: Prisma.TransactionClient, userId: string) {
  const [tasks, themes, occurrences, blocks, dependencies] = await Promise.all([
    tx.task.findMany({ where: { userId }, orderBy: { id: 'asc' }, take: 1001 }),
    tx.theme.findMany({ where: { userId }, orderBy: { id: 'asc' }, take: 1001 }),
    tx.taskOccurrence.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, taskId: true, updatedAt: true },
    }),
    tx.dailyBlock.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, taskOccurrenceId: true, updatedAt: true },
    }),
    tx.taskDependency.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  ]);
  if (tasks.length > 1000 || themes.length > 1000) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'This conversation supports up to 1,000 tasks and themes. Use the regular editor for this inventory.',
    });
  }
  return {
    tasks,
    themes,
    occurrences,
    blocks,
    dependencies,
    hash: fingerprint({ tasks, themes, occurrences, blocks, dependencies }),
  };
}
export type RecordContext = Awaited<ReturnType<typeof recordContext>>;
const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
export function previewRecord(
  context: RecordContext,
  instruction: Extract<Instruction, { type: 'record' }>,
  previous?: RecordPreview
): RecordPreview {
  const { entity, action } = instruction;
  const pool = [
    ...(entity === 'task'
      ? context.tasks.map((t) => ({ ...t, label: t.title }))
      : context.themes.map((t) => ({ ...t, label: t.name }))),
  ];
  const target = action === 'create' ? null : resolveOne(pool, instruction.query, entity);
  let patch: Record<string, unknown>;
  if (entity === 'task') {
    if (instruction.theme && Object.keys(instruction.theme).length) {
      throw new Clarification('Please change the task and theme in separate messages.');
    }
    const { themeQuery, ...fields } = instruction.task ?? {};
    patch = taskPatchSchema.parse({
      ...fields,
      ...(themeQuery !== undefined
        ? {
            themeId:
              themeQuery === null
                ? null
                : resolveOne(
                    context.themes.map((t) => ({ id: t.id, label: t.name })),
                    themeQuery,
                    'theme'
                  ).id,
          }
        : {}),
    });
  } else {
    if (instruction.task && Object.keys(instruction.task).length) {
      throw new Clarification('Please change the task and theme in separate messages.');
    }
    patch = themePatchSchema.parse(instruction.theme ?? {});
  }
  // A correction to a still-pending creation/edit preserves fields already reviewed.
  if (
    previous &&
    previous.baseHash === context.hash &&
    previous.entity === entity &&
    previous.action === action &&
    previous.id === (target?.id ?? null)
  ) {
    patch = { ...previous.patch, ...patch };
  }
  const name = entity === 'task' ? patch.title : patch.name;
  if (action === 'create') {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Clarification(
        `What ${entity === 'task' ? 'title' : 'name'} should the new ${entity} have?`
      );
    }
    const duplicates = findMatches(pool, name).filter(
      (r) => r.label.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (duplicates.length) {
      throw new Clarification(
        `A ${entity} with that name already exists. Do you want to edit it, or create a differently named ${entity}?`,
        duplicates.map((r) => ({ id: r.id, label: r.label }))
      );
    }
  }
  if (action === 'update' && !Object.keys(patch).length) {
    throw new Clarification(`Which properties of this ${entity} should change?`);
  }
  const warnings: string[] = [];
  if (action === 'delete' && target) {
    if (entity === 'theme') {
      warnings.push(
        `${context.tasks.filter((t) => t.themeId === target.id).length} tasks will lose this theme; the tasks are kept.`
      );
    } else {
      const ids = new Set(
        context.occurrences.filter((o) => o.taskId === target.id).map((o) => o.id)
      );
      warnings.push(
        `Deleting this task deletes ${ids.size} occurrences. ${context.blocks.filter((b) => b.taskOccurrenceId && ids.has(b.taskOccurrenceId)).length} plan blocks will keep their history but lose the task link. Dependencies, reviews and its search index are deleted. This cannot be undone.`
      );
    }
  }
  return {
    entity,
    action,
    id: target?.id ?? null,
    baseHash: context.hash,
    references: Object.fromEntries(
      context.themes
        .filter(
          (theme) =>
            theme.id === patch.themeId ||
            theme.id === (target && 'themeId' in target ? target.themeId : undefined)
        )
        .map((theme) => [theme.id, theme.name])
    ),
    before: target ? snapshot(target) : null,
    patch: action === 'delete' ? {} : patch,
    warnings,
  };
}

export async function applyRecord(
  tx: Prisma.TransactionClient,
  userId: string,
  preview: RecordPreview,
  confirmDeletion: boolean
) {
  const context = await recordContext(tx, userId);
  if (context.hash !== preview.baseHash) {
    throw conflict();
  }
  if (preview.action === 'delete' && !confirmDeletion) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Explicit deletion confirmation is required.',
    });
  }
  if (preview.entity === 'task') {
    if (preview.action === 'delete') {
      await plannerService.deleteTask(userId, preview.id!, tx);
      return { id: preview.id };
    }
    const patch = taskPatchSchema.parse(preview.patch);
    let id = preview.id;
    if (preview.action === 'create') {
      const created = await plannerService.createTask(
        userId,
        { title: patch.title!, themeId: patch.themeId },
        tx
      );
      id = created.id;
    }
    await plannerService.updateTask(userId, id!, patch, tx);
    return { id };
  }
  if (preview.action === 'delete') {
    await plannerService.deleteTheme(userId, preview.id!, tx);
    return { id: preview.id };
  }
  const patch = themePatchSchema.parse(preview.patch);
  let id = preview.id;
  if (preview.action === 'create') {
    id = (await plannerService.createTheme(userId, { name: patch.name! }, tx)).id;
  }
  await plannerService.updateTheme(userId, id!, patch, tx);
  return { id };
}

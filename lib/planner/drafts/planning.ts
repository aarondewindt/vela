import 'server-only';
import { TRPCError } from '@trpc/server';
import { planInstruction } from '../conversation/planning';
import type { Instruction } from '../conversation/schema';
import { proposalService, contextForSnapshot } from '../proposals/service';
import { replanDay } from '../proposals/replan';
import { fingerprint } from '../proposals/snapshot';
import { replanSchema } from '../proposals/schema';
import { draftService } from './service';
import { applyDocument, initialState, netDocument, withDraft } from './state';

type DraftInstruction = Exclude<
  Instruction,
  { type: 'record' | 'clarify' | 'find' | 'generate' | 'explain' }
>;
export async function draftInstructions(
  userId: string,
  requestId: string,
  instructions: DraftInstruction[],
  userTimezone?: string
) {
  const instruction = instructions[0];
  if (!instruction || instructions.some((item) => item.date !== instruction.date)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A scheduling batch must target one date.',
    });
  }
  const saved = await draftService.byRequest(userId, requestId);
  if (saved) {
    return { date: instruction.date, reply: 'Draft updated.', draftUpdated: true };
  }
  const { snapshot: baseSnapshot, draft } = await draftService.snapshot(userId, instruction.date);
  let snapshot = baseSnapshot;
  const base = initialState(snapshot);
  let state = base;
  let context = contextForSnapshot(snapshot, true);
  const command = {
    date: instruction.date,
    requestId,
    draftId: draft?.id ?? null,
    expectedVersion: draft?.version ?? 0,
  };
  const port: typeof proposalService = {
    ...proposalService,
    context: async () => context,
    create: async (_owner, input) => {
      if (input.date !== instruction.date || input.baseHash !== context.baseHash) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Planning context changed.' });
      }
      const document = {
        ...input.document,
        operations: input.document.operations.map((op) =>
          op.type === 'add' ? op : { ...op, explicit: true as const }
        ),
      };
      state = applyDocument(baseSnapshot, state, document, 'ai', new Date(), true);
      snapshot = withDraft(baseSnapshot, state);
      context = contextForSnapshot(snapshot, true);
      return { id: draft?.id ?? requestId };
    },
    replan: async (_owner, raw) => {
      const input = replanSchema.parse(raw);
      if (
        ['finish', 'extend', 'skip'].includes(input.action) ||
        input.completeTask ||
        input.estimatedMinutes !== undefined
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Record actual progress on the active schedule. Draft edits cannot complete tasks or alter actual progress.',
        });
      }
      const document = replanDay(snapshot, input, fingerprint(input));
      if (!document.operations.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No eligible future changes are needed.',
        });
      }
      return port.create(userId, {
        requestId,
        date: input.date,
        baseHash: context.baseHash,
        document,
      });
    },
  };
  for (const item of instructions) {
    await planInstruction(userId, requestId, item, undefined, userTimezone, port);
  }
  await draftService.apply(userId, {
    ...command,
    document: netDocument(base, state),
    origin: 'ai',
    preserveIntent: true,
    label: instructions.length > 1 ? 'Chat scheduling batch' : instruction.explanation,
  });
  return {
    date: instruction.date,
    draftUpdated: true,
    reply:
      instruction.type === 'reserve'
        ? 'Kept that interval free in the draft.'
        : 'Updated the draft.',
  };
}

export function draftInstruction(
  userId: string,
  requestId: string,
  instruction: DraftInstruction,
  userTimezone?: string
) {
  return draftInstructions(userId, requestId, [instruction], userTimezone);
}

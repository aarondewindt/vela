import 'server-only';
import { selectionExplanation } from '../proposals/explanations';
import { prisma } from '@/lib/prisma';
import { generateDayPlan } from '../generation/service';
import { proposalService } from '../proposals/service';
import { documentSchema, previewSchema, type ProposalDocument } from '../proposals/schema';
import { reviewDayPlan } from '../review/service';
import { timeMinute, wallInstant } from '../proposals/time';
import { Clarification, resolveOne } from './resolve';
import type { ConversationResult, Instruction } from './schema';

export async function planInstruction(
  userId: string,
  requestId: string,
  instruction: Exclude<Instruction, { type: 'record' | 'clarify' | 'find' }>,
  previous?: Pick<ConversationResult, 'date' | 'proposalId'>,
  userTimezone?: string
) {
  const { date } = instruction;
  const old =
    previous?.proposalId && previous.date === date
      ? await prisma.planningProposal.findFirst({
          where: { id: previous.proposalId, userId, status: 'PENDING' },
        })
      : null;
  if (instruction.type === 'generate') {
    const result = await generateDayPlan(userId, {
      requestId,
      date,
      mode: 'ai',
      guidance: instruction.guidance,
    });
    return {
      reply: result.id
        ? 'Review the proposed day below. Your plan has not changed.'
        : 'No plan changes could fit or were needed.',
      ...(result.id ? { proposalId: result.id } : {}),
      details: result.report.summary,
    };
  }
  if (instruction.type === 'explain') {
    const review = await reviewDayPlan(userId, {
      date,
      proposalId: old?.id,
      mode: 'ai',
      guidance: instruction.question,
    });
    const source =
      old ??
      (await prisma.planningProposal.findFirst({
        where: { userId, planDate: new Date(`${date}T00:00:00Z`), status: 'APPLIED' },
        orderBy: { resolvedAt: 'desc' },
      }));
    const report = source ? documentSchema.parse(source.document).generation : undefined;
    const details = [
      report?.summary,
      ...(report?.outcomes.map(
        (o) =>
          `${o.title}: ${o.reason}${o.selectionReason ? ` AI selection assessment: ${o.selectionReason}` : ''}`
      ) ?? []),
      ...review.conflicts.map((c) => `Verified conflict: ${c.explanation}`),
      ...review.concerns.map((c) => `AI concern: ${c.explanation}`),
      ...review.warnings,
      review.aiError,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      reply:
        'Here are the saved planning reasons and a review of this day. AI assessments are advisory.',
      details:
        details || 'No saved selection explanation or review concern is available for this plan.',
    };
  }
  const context = await proposalService.context(userId, date);
  if (userTimezone && context.timezone !== userTimezone) {
    throw new Clarification(
      `This saved plan uses ${context.timezone}, while your timezone is ${userTimezone}. Use the regular plan review to adjust its times, or choose a day without a saved plan.`
    );
  }
  const pendingPreview = old ? previewSchema.parse(old.preview) : undefined;
  const changedIds = new Set(
    pendingPreview?.changes.flatMap((c) => (c.before ? [c.before.id] : [])) ?? []
  );
  const blocks = [
    ...context.blocks.filter((b) => !changedIds.has(b.id)),
    ...(pendingPreview?.changes.flatMap((c) =>
      c.after
        ? [{ ...c.after, status: c.after.status ?? 'PLANNED', editable: true, adjustable: true }]
        : []
    ) ?? []),
  ].map((b) => ({ ...b, label: b.title }));
  const candidates = context.candidates.map((c) => ({ ...c, label: c.title }));
  if (old && old.baseHash !== context.baseHash) {
    throw new Clarification('Planning inputs changed. Refresh and generate a fresh proposal.');
  }
  if (instruction.type === 'reserve') {
    const startsAt = wallInstant(
      date,
      timeMinute(instruction.startTime),
      context.timezone
    ).toISOString();
    const endsAt = wallInstant(
      date,
      instruction.endTime === '24:00' ? 1440 : timeMinute(instruction.endTime),
      context.timezone
    ).toISOString();
    const overlapping = blocks.filter(
      (b) =>
        b.startsAt < endsAt && b.endsAt > startsAt && !['CANCELED', 'SKIPPED'].includes(b.status)
    );
    if (overlapping.some((b) => !b.editable)) {
      throw new Clarification(
        'That interval contains protected, started or manual commitments. Choose another interval or explicitly adjust those commitments first.',
        overlapping.map((b) => ({ id: b.id, label: b.label }))
      );
    }
    const priorDocument = old ? documentSchema.parse(old.document) : undefined;
    if (priorDocument?.replan) {
      throw new Clarification('Accept or discard the progress preview first.');
    }
    const removed = new Set(overlapping.map((b) => b.id));
    const operations = (priorDocument?.operations ?? []).filter((op, index) => {
      if (removed.has(`new:${index}`) && 'block' in op) {
        return false;
      }
      return !('blockId' in op && removed.has(op.blockId));
    });
    const result = await proposalService.create(userId, {
      requestId,
      date,
      baseHash: context.baseHash,
      document: {
        schemaVersion: 1,
        taskLimits: priorDocument?.taskLimits,
        selectionExplanation: priorDocument ? selectionExplanation(priorDocument) : undefined,
        operations: [
          ...operations,
          ...overlapping.flatMap((b) => {
            if (b.id.startsWith('new:')) {
              const original = priorDocument?.operations[Number(b.id.slice(4))];
              return original && 'blockId' in original
                ? [
                    {
                      type: 'remove' as const,
                      blockId: original.blockId,
                      explanation: instruction.explanation,
                    },
                  ]
                : [];
            }
            return [
              { type: 'remove' as const, blockId: b.id, explanation: instruction.explanation },
            ];
          }),
        ],
        reservations: priorDocument?.reservations?.filter(
          (r) => r.endsAt <= startsAt || r.startsAt >= endsAt
        ),
        freeIntervals: [
          ...(priorDocument?.freeIntervals ?? []),
          { startsAt, endsAt, explanation: instruction.explanation },
        ],
      },
    });
    return {
      reply:
        'Review the enforced free interval and released blocks below. Tasks are kept. This constraint belongs to this proposal; change availability separately for future generation.',
      proposalId: result.id,
    };
  }
  const block =
    instruction.action === 'add' || instruction.action === 'replan'
      ? undefined
      : resolveOne(blocks, instruction.blockQuery, 'block');
  const candidate =
    instruction.action === 'replace' || instruction.action === 'add'
      ? resolveOne(candidates, instruction.candidateQuery, 'eligible task occurrence')
      : undefined;
  if (instruction.type === 'replan') {
    if (old) {
      throw new Clarification(
        'There is a pending proposal. Apply or discard it before adjusting progress on the current day, or ask for a corrected full day plan.'
      );
    }
    let endTime = instruction.endTime ?? undefined;
    if (instruction.additionalMinutes !== null) {
      if (instruction.action !== 'extend' || !block || endTime) {
        throw new Clarification(
          'Specify either an extension in minutes or an end time for the selected block.'
        );
      }
      const endsAt = new Date(
        new Date(block.endsAt).getTime() + instruction.additionalMinutes * 60000
      );
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: context.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        })
          .formatToParts(endsAt)
          .map((p) => [p.type, p.value])
      );
      if (`${parts.year}-${parts.month}-${parts.day}` !== date) {
        throw new Clarification(
          'This extension crosses midnight. Choose an end time within the selected day.'
        );
      }
      endTime = `${parts.hour}:${parts.minute}`;
    }
    const result = await proposalService.replan(userId, {
      requestId,
      date,
      baseHash: context.baseHash,
      action: instruction.action,
      blockId: block?.id,
      candidateId: candidate?.id,
      startTime: instruction.startTime ?? undefined,
      endTime,
      completeTask: instruction.completeTask,
      explanation: instruction.explanation,
    });
    return {
      reply: 'Review the progress adjustment and downstream changes below.',
      proposalId: result.id,
    };
  }
  // Manual edits can refine an existing pending proposal without applying it.
  // New edits of existing blocks replace their earlier operation, preserving unrelated changes.
  if (old) {
    if (old.baseHash !== context.baseHash) {
      throw new Clarification(
        'Planning inputs changed. Generate a fresh full proposal before correcting this preview.'
      );
    }
    const document = documentSchema.parse(old.document);
    if (document.replan) {
      throw new Clarification('Regenerate the progress adjustment after discarding this preview.');
    }
    const explanation = instruction.explanation;
    let operation: ProposalDocument['operations'][number];
    if (instruction.action === 'remove') {
      operation = { type: 'remove', blockId: block!.id, explanation };
    } else {
      if (!instruction.startTime || !instruction.endTime) {
        throw new Clarification('What start and end times should this block use?');
      }
      const startsAt = wallInstant(
        date,
        timeMinute(instruction.startTime),
        context.timezone
      ).toISOString();
      const endsAt = wallInstant(
        date,
        timeMinute(instruction.endTime),
        context.timezone
      ).toISOString();
      if (instruction.action === 'add' || instruction.action === 'replace') {
        const addition = {
          kind: 'TASK' as const,
          taskId: candidate!.taskId,
          occurrenceId: candidate!.occurrenceId,
          startsAt,
          endsAt,
        };
        operation =
          instruction.action === 'add'
            ? { type: 'add', block: addition, explanation }
            : { type: 'replace', blockId: block!.id, block: addition, explanation };
      } else {
        operation = { type: instruction.action, blockId: block!.id, startsAt, endsAt, explanation };
      }
    }
    let operations = [...document.operations];
    if (block?.id.startsWith('new:')) {
      const index = Number(block.id.slice(4));
      const original = operations[index];
      if (!original || !('block' in original)) {
        throw new Clarification(
          'Could not identify this pending addition. Generate a new proposal.'
        );
      }
      if (instruction.action === 'remove') {
        if (original.type === 'add') {
          operations.splice(index, 1);
        } else {
          operations[index] = { type: 'remove', blockId: original.blockId, explanation };
        }
      } else {
        const updated =
          'block' in operation
            ? operation.block
            : 'startsAt' in operation
              ? { ...original.block, startsAt: operation.startsAt, endsAt: operation.endsAt }
              : original.block;
        operations[index] = { ...original, block: updated, explanation };
      }
    } else {
      operations = [
        ...operations.filter((op) => !('blockId' in op && op.blockId === block?.id)),
        operation,
      ];
    }
    if (
      !operations.length &&
      !document.reservations?.length &&
      !document.freeIntervals?.length &&
      !document.taskLimits?.length
    ) {
      throw new Clarification(
        'This would remove every proposed change. Use Discard conversation preview to keep the current plan.'
      );
    }
    const result = await proposalService.create(userId, {
      requestId,
      date,
      baseHash: context.baseHash,
      document: {
        schemaVersion: 1,
        taskLimits: document.taskLimits,
        selectionExplanation: selectionExplanation(document),
        operations,
        reservations: document.reservations,
        freeIntervals: document.freeIntervals,
      },
    });
    return {
      reply: 'Review this revised proposal. It replaces the previous preview.',
      proposalId: result.id,
    };
  }
  if (instruction.action !== 'remove' && (!instruction.startTime || !instruction.endTime)) {
    throw new Clarification('What start and end times should this block use?');
  }
  const result = await proposalService.createEdit(userId, {
    requestId,
    date,
    baseHash: context.baseHash,
    type: instruction.action,
    blockId: block?.id,
    candidateId: candidate?.id,
    startTime: instruction.startTime ?? undefined,
    endTime: instruction.endTime ?? undefined,
    explanation: instruction.explanation,
  });
  return { reply: 'Review the proposed change below.', proposalId: result.id };
}

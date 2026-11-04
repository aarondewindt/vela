import { z } from 'zod';
import type { SlotCategoryPolicy } from '../availability/resolver';
import type { Candidate } from './candidates';

type IntentSlot = {
  id: string;
  startMinute: number;
  endMinute: number;
  policy: SlotCategoryPolicy;
};

export type ResolvedSlotIntent = {
  slotId: string;
  targetTaskMinutes: number;
  reason: string;
  tasks: { candidate: Candidate; reason: string }[];
};

export class SlotIntentValidationError extends Error {
  readonly code = 'INVALID_SLOT_INTENT';

  constructor(
    message: string,
    readonly validationPaths: string[]
  ) {
    super(message);
    this.name = 'SlotIntentValidationError';
  }
}

export function candidateAllowedInSlot(
  category: Candidate['category'],
  policy: SlotCategoryPolicy
) {
  if (policy.mode === 'ALL') {
    return true;
  }
  const listed = policy.categories.includes(category);
  return policy.mode === 'ALLOW_ONLY' ? listed : !listed;
}

export function buildSlotIntentContract(
  slots: readonly IntentSlot[],
  candidates: readonly Candidate[]
) {
  const references = candidates.map((candidate, index) => ({
    key: `C${index + 1}`,
    candidate,
  }));
  const slotIds = slots.map((slot) => slot.id);
  const schema = z
    .object({
      summary: z.string().trim().min(1).max(1500),
      slots: z
        .array(
          z
            .object({
              slotId: z.string().min(1).max(100),
              targetTaskMinutes: z.number().int().min(0).max(1440),
              tasks: z
                .array(
                  z
                    .object({
                      key: z.string().min(1).max(16),
                      reason: z.string().trim().min(1).max(700),
                    })
                    .strict()
                )
                .max(candidates.length),
              reason: z.string().trim().min(1).max(700),
            })
            .strict()
        )
        .max(slots.length),
    })
    .strict();

  return {
    references,
    schema,
    eligibleReferences(slot: IntentSlot) {
      return references.filter(({ candidate }) =>
        candidateAllowedInSlot(candidate.category, slot.policy)
      );
    },
    resolve(raw: unknown): { summary: string; slots: ResolvedSlotIntent[] } {
      const parsed = schema.parse(raw);
      if (
        parsed.slots.length !== slots.length ||
        new Set(parsed.slots.map((slot) => slot.slotId)).size !== slots.length ||
        slotIds.some((slotId) => !parsed.slots.some((slot) => slot.slotId === slotId))
      ) {
        throw new SlotIntentValidationError(
          'The model must return every effective availability slot exactly once.',
          ['slots']
        );
      }
      return {
        summary: parsed.summary,
        slots: parsed.slots.map((intent) => {
          const slot = slots.find((candidate) => candidate.id === intent.slotId);
          if (!slot) {
            throw new SlotIntentValidationError(`Unknown availability slot ${intent.slotId}.`, [
              `slots.${intent.slotId}.slotId`,
            ]);
          }
          if (intent.targetTaskMinutes === 0 && intent.tasks.length > 0) {
            throw new SlotIntentValidationError(
              `Availability slot ${slot.id} has tasks with a zero target.`,
              [`slots.${slot.id}.targetTaskMinutes`, `slots.${slot.id}.tasks`]
            );
          }
          const seen = new Set<string>();
          const tasks = intent.tasks.map((task) => {
            const reference = references.find((candidate) => candidate.key === task.key);
            if (!reference) {
              throw new SlotIntentValidationError(
                `Unknown task reference ${task.key} for availability slot ${slot.id}.`,
                [`slots.${slot.id}.tasks.${task.key}`]
              );
            }
            if (seen.has(reference.candidate.key)) {
              throw new SlotIntentValidationError(
                `Task reference ${task.key} appears more than once in availability slot ${slot.id}.`,
                [`slots.${slot.id}.tasks.${task.key}`]
              );
            }
            seen.add(reference.candidate.key);
            if (!candidateAllowedInSlot(reference.candidate.category, slot.policy)) {
              throw new SlotIntentValidationError(
                `Task reference ${task.key} is not eligible for availability slot ${slot.id}.`,
                [`slots.${slot.id}.tasks.${task.key}`]
              );
            }
            return { candidate: reference.candidate, reason: task.reason };
          });
          return { ...intent, tasks };
        }),
      };
    },
  };
}

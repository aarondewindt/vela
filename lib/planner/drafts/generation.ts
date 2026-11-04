import "server-only";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generateDaySchema } from "../generation/schema";
import { generateDayPlan } from "../generation/service";
import { existingBlocks } from "../proposals/validate";
import type { ProposalDocument } from "../proposals/schema";
import { draftCommandSchema } from "./schema";
import { draftService } from "./service";
import { wallInstant } from "../proposals/time";
import type { GenerationDiagnostics } from "@/lib/ai/diagnostics";

export const generateDraftSchema = draftCommandSchema
  .extend({
    mode: generateDaySchema.shape.mode,
    guidance: generateDaySchema.shape.guidance,
    selection: generateDaySchema.shape.selection,
    freeTimes: generateDaySchema.shape.freeTimes,
    taskLimits: generateDaySchema.shape.taskLimits,
    rebuild: z.boolean().default(false),
  })
  .strict();
export async function generateWorkingDraft(
  userId: string,
  raw: z.input<typeof generateDraftSchema>,
  onDiagnostics?: (details: GenerationDiagnostics) => void,
) {
  const input = generateDraftSchema.parse(raw);
  // Retry the exact saved operation without another inference. The service still
  // checks request identity/payload when saving; generated request metadata is kept
  // in the saved revision request below.
  const saved = await draftService.byRequest(userId, input.requestId);
  const originalHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  if (saved) {
    const result = saved.result as { generationInputHash?: string };
    if (result.generationInputHash !== originalHash) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request ID was already used for different generation inputs.",
      });
    }
    return saved.result;
  }
  const command = {
    date: input.date,
    requestId: input.requestId,
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
  };
  const { snapshot: s, draft } = await draftService.snapshot(userId, input.date);
  if (
    (draft && (draft.id !== command.draftId || draft.version !== command.expectedVersion)) ||
    (!draft && (command.draftId !== null || command.expectedVersion !== 0))
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The draft changed. Reload before generating.",
    });
  }
  const cutoff = new Date(Math.max(Date.now(), wallInstant(input.date, 0, s.timezone).getTime()));
  const removable = existingBlocks(s).filter(
    (b) =>
      b.status === "PLANNED" &&
      b.startsAt >= cutoff &&
      !b.calendarEventId &&
      !b.isFixed &&
      !b.isLocked &&
      !b.mealKind &&
      (input.rebuild || (b.source !== "MANUAL" && !b.manualOverride)),
  );
  const ids = new Set(removable.map((b) => b.id));
  const pruned = { ...s, blocks: s.blocks.filter((b) => !ids.has(b.id)) };
  const removals: ProposalDocument["operations"] = removable.map((b) => ({
    type: "remove",
    blockId: b.id,
    explicit: true,
    explanation: input.rebuild
      ? "Explicitly rebuild eligible future schedule."
      : "Regenerate automatic future placements.",
  }));
  let receipt: unknown;
  const generated = await generateDayPlan(
    userId,
    {
      requestId: input.requestId,
      // Keep the public scheduler schema independent of draft lifecycle metadata.
      date: input.date,
      mode: input.mode,
      guidance: input.guidance,
      selection: input.selection,
      freeTimes: input.freeTimes,
      taskLimits: input.taskLimits,
    },
    {
      snapshot: pruned,
      onDiagnostics,
      save: async (document) => {
        receipt = await draftService.applyGenerated(
          userId,
          command,
          { ...document, operations: [...removals, ...document.operations] },
          originalHash,
          { snapshot: s.availabilitySnapshot, hash: s.availabilityHash },
          s.hash,
        );
        return { id: (receipt as { draftId: string }).draftId };
      },
    },
  );
  if (s.effectiveAvailability.slots.length === 0) {
    return {
      draftId: draft?.id ?? null,
      version: draft?.version ?? 0,
      unchanged: true,
      summary: generated.report.selectionSummary ?? generated.report.summary,
    };
  }
  if (!receipt) {
    receipt = await draftService.applyGenerated(
      userId,
      command,
      { schemaVersion: 1, operations: removals, generation: generated.report },
      originalHash,
      { snapshot: s.availabilitySnapshot, hash: s.availabilityHash },
      s.hash,
    );
  }
  return (
    receipt ?? {
      draftId: draft?.id,
      version: draft?.version,
      unchanged: true,
      summary: generated.report.summary,
    }
  );
}

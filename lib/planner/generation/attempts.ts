import "server-only";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import type { GenerationDiagnostics } from "@/lib/ai/diagnostics";
import { AiError } from "@/lib/ai/errors";
import { prisma } from "@/lib/prisma";
import { SlotIntentValidationError } from "./slot-intent";

type FailureInput = {
  userId: string;
  requestId: string;
  date: string;
  error: unknown;
  diagnostics?: GenerationDiagnostics;
  now?: Date;
};

function causes(error: unknown) {
  const values: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && values.length < 6 && !seen.has(current)) {
    seen.add(current);
    values.push(current);
    current = current.cause;
  }
  return values;
}

function classified(error: unknown, diagnostics?: GenerationDiagnostics) {
  const chain = causes(error);
  const ai = chain.find((value): value is AiError => value instanceof AiError);
  const zod = chain.find((value): value is ZodError => value instanceof ZodError);
  const slotIntent = chain.find(
    (value): value is SlotIntentValidationError => value instanceof SlotIntentValidationError,
  );
  const trpc = chain.find((value): value is TRPCError => value instanceof TRPCError);
  if (diagnostics?.aborted) {
    return {
      stage: "MODEL",
      errorCode: "TIMEOUT",
      failureClass: "TimeoutError",
      detail: "The planning model timed out. Retry or plan manually.",
      validationPaths: [],
    };
  }
  if (ai) {
    if (ai.validationPaths.length) {
      return {
        stage: "VALIDATION",
        errorCode: ai.code,
        failureClass: "AiError",
        detail:
          "The planning model response failed bounded schema validation. Retry or plan manually.",
        validationPaths: ai.validationPaths.slice(0, 20).map((path) => path.slice(0, 200)),
      };
    }
    const detail =
      ai.code === "PROVIDER_UNAVAILABLE"
        ? "The selected planning model was unavailable. Retry or plan manually."
        : ai.code === "MODEL_NOT_FOUND" || ai.code === "MODEL_NOT_SUPPORTED"
          ? "The selected planning model is unavailable or unsupported. Choose another model or plan manually."
          : ai.code === "CONFIGURATION_ERROR"
            ? "Planner model configuration is invalid. Review model settings or plan manually."
            : "The planning model returned an invalid response. Retry or plan manually.";
    return {
      stage: "MODEL",
      errorCode: ai.code,
      failureClass: "AiError",
      detail,
      validationPaths: ai.validationPaths.length
        ? ai.validationPaths.slice(0, 20).map((path) => path.slice(0, 200))
        : zod
          ? zod.issues.slice(0, 20).map((issue) => issue.path.join(".").slice(0, 200))
          : [],
    };
  }
  if (zod) {
    return {
      stage: "VALIDATION",
      errorCode: "INVALID_SLOT_INTENT",
      failureClass: "ZodError",
      detail:
        "The planning model response failed bounded schema validation. Retry or plan manually.",
      validationPaths: zod.issues.slice(0, 20).map((issue) => issue.path.join(".").slice(0, 200)),
    };
  }
  if (slotIntent) {
    return {
      stage: "VALIDATION",
      errorCode: slotIntent.code,
      failureClass: slotIntent.name,
      detail:
        "The planning model returned contradictory or ineligible per-slot intent. Retry or plan manually.",
      validationPaths: slotIntent.validationPaths.slice(0, 20).map((path) => path.slice(0, 200)),
    };
  }
  return {
    stage: trpc?.code === "CONFLICT" ? "PERSISTENCE" : "APPLICATION",
    errorCode: trpc ? `PLANNER_${trpc.code}` : "UNEXPECTED_PLANNING_FAILURE",
    failureClass: (chain[0] instanceof Error ? chain[0].name : "UnknownError").slice(0, 100),
    detail:
      trpc?.code === "CONFLICT"
        ? "Planning inputs changed before the generated revision could be saved. Reload and retry."
        : "Planning failed before the draft could be updated. Retry or plan manually.",
    validationPaths: [],
  };
}

export async function recordGenerationFailure(input: FailureInput) {
  const failure = classified(input.error, input.diagnostics);
  const cutoff = new Date((input.now ?? new Date()).getTime() - 30 * 86_400_000);
  await prisma.$transaction(async (tx) => {
    await tx.plannerGenerationAttempt.create({
      data: {
        userId: input.userId,
        requestId: input.requestId,
        planDate: new Date(`${input.date}T00:00:00.000Z`),
        stage: failure.stage,
        errorCode: failure.errorCode,
        provider: input.diagnostics?.provider?.slice(0, 64),
        modelId: input.diagnostics?.modelId?.slice(0, 200),
        failureClass: failure.failureClass,
        detail: failure.detail.slice(0, 500),
        validationPaths: failure.validationPaths,
      },
    });
    await tx.plannerGenerationAttempt.deleteMany({
      where: { userId: input.userId, createdAt: { lt: cutoff } },
    });
    const excess = await tx.plannerGenerationAttempt.findMany({
      where: { userId: input.userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
      skip: 100,
    });
    if (excess.length) {
      await tx.plannerGenerationAttempt.deleteMany({
        where: { userId: input.userId, id: { in: excess.map(({ id }) => id) } },
      });
    }
  });
}

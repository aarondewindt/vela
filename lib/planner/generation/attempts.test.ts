/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/prisma", () => ({
  prisma: { $transaction: jest.fn() },
}));

import { TRPCError } from "@trpc/server";
import { prisma } from "@/lib/prisma";
import { AiError } from "@/lib/ai/errors";
import { recordGenerationFailure } from "./attempts";

test("persists only bounded sanitized failure diagnostics and enforces owner retention", async () => {
  const tx = {
    plannerGenerationAttempt: {
      create: jest.fn().mockResolvedValue({ id: "attempt" }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([{ id: "old-101" }]),
    },
  };
  jest.mocked(prisma.$transaction).mockImplementation(async (operation) => operation(tx as never));
  const provider = new AiError("PROVIDER_UNAVAILABLE", "secret endpoint and full prompt");
  const error = new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Public actionable message",
    cause: provider,
  });

  await recordGenerationFailure({
    userId: "owner",
    requestId: "00000000-0000-4000-8000-000000000001",
    date: "2030-01-07",
    error,
    diagnostics: {
      provider: "ollama",
      modelId: "model",
      startedAt: "2030-01-07T00:00:00.000Z",
      durationMs: 12,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      rawResponse: "unrestricted raw model output",
      errors: [{ name: "Error", message: "private provider stack" }],
    },
  });

  expect(tx.plannerGenerationAttempt.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      userId: "owner",
      stage: "MODEL",
      errorCode: "PROVIDER_UNAVAILABLE",
      provider: "ollama",
      modelId: "model",
      failureClass: "AiError",
      detail: "The selected planning model was unavailable. Retry or plan manually.",
      validationPaths: [],
    }),
  });
  expect(JSON.stringify(tx.plannerGenerationAttempt.create.mock.calls[0])).not.toMatch(
    /secret|full prompt|raw model output|private provider/i,
  );
  expect(tx.plannerGenerationAttempt.deleteMany).toHaveBeenNthCalledWith(1, {
    where: { userId: "owner", createdAt: { lt: expect.any(Date) } },
  });
  expect(tx.plannerGenerationAttempt.findMany).toHaveBeenCalledWith({
    where: { userId: "owner" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
    skip: 100,
  });
  expect(tx.plannerGenerationAttempt.deleteMany).toHaveBeenNthCalledWith(2, {
    where: { userId: "owner", id: { in: ["old-101"] } },
  });
});

test.each([
  {
    name: "timeout",
    error: new AiError("INVALID_PROVIDER_RESPONSE", "private timeout detail"),
    diagnostics: { aborted: true },
    expected: { stage: "MODEL", errorCode: "TIMEOUT", failureClass: "TimeoutError" },
  },
  {
    name: "schema validation",
    error: new AiError("INVALID_PROVIDER_RESPONSE", "private schema detail", ["slots.0.slotId"]),
    diagnostics: {},
    expected: {
      stage: "VALIDATION",
      errorCode: "INVALID_PROVIDER_RESPONSE",
      failureClass: "AiError",
      validationPaths: ["slots.0.slotId"],
    },
  },
])(
  "classifies $name failures without retaining private detail",
  async ({ error, diagnostics, expected }) => {
    const create = jest.fn().mockResolvedValue({ id: "attempt" });
    const tx = {
      plannerGenerationAttempt: {
        create,
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    jest
      .mocked(prisma.$transaction)
      .mockImplementation(async (operation) => operation(tx as never));
    await recordGenerationFailure({
      userId: "owner",
      requestId: "00000000-0000-4000-8000-000000000002",
      date: "2030-01-07",
      error,
      diagnostics: {
        provider: "ollama",
        modelId: "model",
        startedAt: "2030-01-07T00:00:00.000Z",
        durationMs: 120000,
        maxOutputTokens: 4096,
        timeoutMs: 120000,
        ...diagnostics,
      },
    });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining(expected) });
    expect(JSON.stringify(create.mock.calls[0])).not.toMatch(/private (timeout|schema) detail/i);
  },
);

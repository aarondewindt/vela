/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    planningProposal: { findUnique: jest.fn(), findFirst: jest.fn() },
    task: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/ai/structured", () => ({ generateStructured: jest.fn() }));
jest.mock("@/lib/model-settings/service", () => ({ requireModelSelection: jest.fn() }));
jest.mock("@/lib/task-search/service", () => ({
  taskCollection: { status: jest.fn(), search: jest.fn() },
}));
jest.mock("@/lib/task-reviews/service", () => ({
  taskReviewService: { schedulerContext: jest.fn() },
}));
jest.mock("../proposals/service", () => ({ proposalService: { create: jest.fn() } }));

import { prisma } from "@/lib/prisma";
import { generateStructured } from "@/lib/ai/structured";
import { AiError } from "@/lib/ai/errors";
import { requireModelSelection } from "@/lib/model-settings/service";
import { taskCollection } from "@/lib/task-search/service";
import { taskReviewService } from "@/lib/task-reviews/service";
import { proposalService } from "../proposals/service";
import { generateDayPlan } from "./service";
import { date, fixture, taskId } from "./fixtures";

const input = {
  requestId: taskId(99),
  date,
  mode: "ai" as const,
  guidance: "Keep today light and focus on housework",
};
let snapshot = fixture();

function intent(
  tasks: { key: string; reason: string }[] = [{ key: "C1", reason: "Housework focus." }],
  targetTaskMinutes = 30,
) {
  return {
    summary: "Use the day slot intentionally.",
    slots: [
      {
        slotId: snapshot.effectiveAvailability.slots[0].id,
        targetTaskMinutes,
        tasks,
        reason: "Follow the one-off guidance before saved guidance.",
      },
    ],
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  snapshot = fixture();
  snapshot.effectiveAvailability.slots[0].guidance = "Prefer concentrated work.";
  snapshot.availabilitySnapshot.slots[0].guidance = "Prefer concentrated work.";
  jest.mocked(prisma.task.findMany).mockResolvedValue([]);
  jest.mocked(taskReviewService.schedulerContext).mockResolvedValue([]);
  jest.mocked(prisma.planningProposal.findUnique).mockResolvedValue(null);
  jest.mocked(prisma.$transaction).mockImplementation(async () => snapshot);
  jest.mocked(requireModelSelection).mockResolvedValue({
    provider: "ollama",
    modelId: "fixture-model",
  });
  jest.mocked(taskCollection.status).mockResolvedValue({ pending: 0 } as never);
  jest.mocked(taskCollection.search).mockResolvedValue({ results: [] } as never);
  jest.mocked(proposalService.create).mockResolvedValue({ id: taskId(100) } as never);
  jest.mocked(generateStructured).mockImplementation(async () => intent());
});

it("requests typed intent for all slots once and leaves timestamps and categories to the application", async () => {
  const before = JSON.stringify(snapshot);
  const result = await generateDayPlan("owner", input);

  expect(generateStructured).toHaveBeenCalledTimes(1);
  const call = jest.mocked(generateStructured).mock.calls[0][0];
  const prompt = JSON.parse(call.prompt);
  expect(prompt).toMatchObject({
    globalGuidance: input.guidance,
    availabilitySlots: [
      {
        slotId: snapshot.effectiveAvailability.slots[0].id,
        savedGuidance: "Prefer concentrated work.",
        categoryPolicy: { mode: "ALL", categories: [] },
        eligibleCandidateKeys: ["C1", "C2"],
      },
    ],
  });
  expect(call.system).toMatch(/Global one-off guidance is the strongest soft preference/);
  expect(call.system).toMatch(/application.*computes timestamps/i);

  const document = jest.mocked(proposalService.create).mock.calls[0][1].document;
  expect(document.operations[0]).toMatchObject({
    type: "add",
    block: { kind: "TASK", taskId: taskId(1), startsAt: `${date}T09:00:00.000Z` },
  });
  expect(result.report.outcomes).toMatchObject([
    { scheduledMinutes: 30, remainingMinutes: 30, selectionReason: "Housework focus." },
    { scheduledMinutes: 0, remainingMinutes: 45 },
  ]);
  expect(result.report.slots).toEqual([
    {
      slotId: snapshot.effectiveAvailability.slots[0].id,
      targetTaskMinutes: 30,
      scheduledTaskMinutes: 30,
      shortfallMinutes: 0,
      reason: "Follow the one-off guidance before saved guidance.",
    },
  ]);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it("enforces slot policy against the application-resolved task category", async () => {
  snapshot.effectiveAvailability.slots[0].policy = {
    mode: "ALLOW_ONLY",
    categories: ["LIFE"],
  };
  snapshot.tasks[1].category = "LIFE";
  jest
    .mocked(generateStructured)
    .mockImplementation(async () => intent([{ key: "C2", reason: "Wrong." }]));

  await expect(generateDayPlan("owner", input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(proposalService.create).not.toHaveBeenCalled();
  expect(generateStructured).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(jest.mocked(generateStructured).mock.calls[0][0].prompt).availabilitySlots[0]
      .eligibleCandidateKeys,
  ).toEqual(["C1"]);
});

it("accepts sparse intent and reports unfilled work without an application fill pass", async () => {
  jest.mocked(generateStructured).mockImplementation(async () => intent([], 0));
  const result = await generateDayPlan("owner", { ...input, guidance: "" });
  expect(result.id).toBeNull();
  expect(proposalService.create).not.toHaveBeenCalled();
  expect(result.report.outcomes.map((outcome) => outcome.scheduledMinutes)).toEqual([0, 0]);
  expect(result.report.additionalCandidateCount).toBe(0);
  expect(result.report.slots).toMatchObject([
    {
      targetTaskMinutes: 0,
      scheduledTaskMinutes: 0,
      shortfallMinutes: 0,
      reason: "Follow the one-off guidance before saved guidance.",
    },
  ]);
});

it("skips the model for explicit unavailability and explains the empty date", async () => {
  snapshot.effectiveAvailability.origin = "DATE_OVERRIDE";
  snapshot.effectiveAvailability.slots = [];
  const result = await generateDayPlan("owner", input);
  expect(generateStructured).not.toHaveBeenCalled();
  expect(requireModelSelection).not.toHaveBeenCalled();
  expect(result.id).toBeNull();
  expect(result.report.selectionSummary).toMatch(/explicitly unavailable/i);
});

it("skips the model for an unassigned weekday and distinguishes that state", async () => {
  snapshot.effectiveAvailability.origin = "UNASSIGNED_WEEKDAY";
  snapshot.effectiveAvailability.slots = [];
  const result = await generateDayPlan("owner", input);
  expect(generateStructured).not.toHaveBeenCalled();
  expect(result.report.selectionSummary).toMatch(/no availability assignment/i);
});

it.each([
  {
    summary: "Unknown task.",
    slots: [
      {
        slotId: taskId(93),
        targetTaskMinutes: 30,
        tasks: [{ key: "C999", reason: "Invented." }],
        reason: "Invalid.",
      },
    ],
  },
  { summary: "Missing slot.", slots: [] },
  {
    summary: "Contradictory.",
    slots: [
      {
        slotId: taskId(93),
        targetTaskMinutes: 0,
        tasks: [{ key: "C1", reason: "Contradiction." }],
        reason: "Invalid.",
      },
    ],
  },
])("fails malformed or contradictory intent atomically in one call", async (output) => {
  jest.mocked(generateStructured).mockResolvedValue(output as never);
  await expect(generateDayPlan("owner", input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(generateStructured).toHaveBeenCalledTimes(1);
  expect(proposalService.create).not.toHaveBeenCalled();
});

it("returns an actionable manual-planning error without exposing provider detail or falling back", async () => {
  jest
    .mocked(generateStructured)
    .mockRejectedValue(new AiError("PROVIDER_UNAVAILABLE", "Private provider response"));
  await expect(generateDayPlan("owner", input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringMatching(/draft is unchanged.*manually/i),
  });
  await expect(generateDayPlan("owner", input)).rejects.not.toThrow("Private provider response");
  expect(proposalService.create).not.toHaveBeenCalled();
});

it("clamps slot targets to remaining task effort and explicit task limits", async () => {
  snapshot = fixture([180, 45]);
  snapshot.tasks[0].title = "Clean room";
  jest
    .mocked(generateStructured)
    .mockImplementation(async () => intent([{ key: "C1", reason: "Clean." }], 120));
  const result = await generateDayPlan("owner", {
    ...input,
    taskLimits: [{ taskQuery: "Clean room", maxMinutes: 30 }],
  });
  expect(result.report.outcomes[0].scheduledMinutes).toBe(30);
  expect(snapshot.tasks[0].estimatedMinutes).toBe(180);
});

it("replays a saved request without another model call and rejects changed inputs", async () => {
  const first = await generateDayPlan("owner", input);
  const document = jest.mocked(proposalService.create).mock.calls[0][1].document;
  jest.mocked(prisma.planningProposal.findUnique).mockResolvedValue({
    id: first.id,
    document,
  } as never);
  jest.mocked(generateStructured).mockClear();
  expect(await generateDayPlan("owner", input)).toEqual(first);
  expect(generateStructured).not.toHaveBeenCalled();
  await expect(generateDayPlan("owner", { ...input, guidance: "Changed" })).rejects.toMatchObject({
    code: "CONFLICT",
  });
});

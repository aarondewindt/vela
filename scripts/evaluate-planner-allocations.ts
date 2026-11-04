/** Opt-in synthetic Ollama allocation check; reads no user records and saves no proposals.
 * Run: node --conditions=react-server --import tsx scripts/evaluate-planner-allocations.ts
 * Uses OLLAMA_BASE_URL from .env; defaults to qwen3:8b (PLANNER_EVAL_MODEL overrides).
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { generateStructured } from '../lib/ai/structured';
import { PLANNING_SYSTEM } from '../lib/planner/generation/service';
import { planningCandidates } from '../lib/planner/generation/candidates';
import { buildSlotIntentContract } from '../lib/planner/generation/slot-intent';
import { scheduleDay } from '../lib/planner/generation/schedule';
import { fixture, at } from '../lib/planner/generation/fixtures';
import { DEFAULT_MEAL_PREFERENCES } from '../lib/planner/meals';
import { mealPreferences } from '../lib/planner/generation/meals';
import { resolveEffectiveAvailability } from '../lib/planner/availability/resolver';
async function main() {
  const s = fixture([9999, 30, 300, 30]);
  s.timezone = 'Europe/Amsterdam';
  s.effectiveAvailability = resolveEffectiveAvailability({
    date: s.date,
    timezonePeriods: [{ effectiveDate: '2000-01-01', timezone: s.timezone }],
    weeklyAssignments: [],
    templates: [],
    dateOverrides: [
      {
        id: 'evening',
        date: s.date,
        slots: [
          {
            id: 'evening-slot',
            position: 0,
            startMinute: 1119,
            endMinute: 1440,
            name: 'Evening',
            guidance: 'Balance focused work, chores, creative work and leisure.',
            policy: { mode: 'ALL', categories: [] },
          },
        ],
      },
    ],
  });
  s.tasks.forEach((task, i) => {
    task.title = ['Work on Vela', 'Tidy living room', 'SoLocos blooper video', 'Practice guitar'][
      i
    ];
  });
  s.tasks[3].category = 'LEISURE';
  const meals = structuredClone(DEFAULT_MEAL_PREFERENCES);
  meals.DINNER.enabled = true;
  s.settings = { ...s.settings, leisureMinutes: 60, mealPreferences: meals } as typeof s.settings;
  const guidance =
    'Work on Vela for maybe another hour, then clean my room for max 30min, spend most of the rest of the evening on the SoLocos video, and practice guitar for a bit.';
  const candidates = planningCandidates(s).candidates;
  const contract = buildSlotIntentContract(s.effectiveAvailability.slots, candidates);
  const slotIntent = contract.resolve(
    await generateStructured({
      selection: { provider: 'ollama', modelId: process.env.PLANNER_EVAL_MODEL || 'qwen3:8b' },
      schema: contract.schema,
      system: PLANNING_SYSTEM,
      prompt: JSON.stringify({
        date: s.date,
        timezone: s.timezone,
        globalGuidance: guidance,
        availabilitySlots: s.effectiveAvailability.slots.map((slot) => ({
          slotId: slot.id,
          savedGuidance: slot.guidance,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          categoryPolicy: slot.policy,
          eligibleCandidateKeys: contract.eligibleReferences(slot).map((item) => item.key),
        })),
        settings: s.settings,
        mealRequirements: mealPreferences(s),
        commitments: [],
        busy: [],
        candidates: candidates.map((c, i) => ({
          key: contract.references[i].key,
          title: c.title,
          remainingMinutes: c.remaining,
          category: c.category,
          priority: 3,
          size: 2,
        })),
      }),
    })
  );
  const scheduled = scheduleDay(
    s,
    slotIntent.slots.flatMap((slot) =>
      slot.tasks.map((task) => ({
        ...task,
        slotId: slot.slotId,
        slotTargetMinutes: slot.targetTaskMinutes,
      }))
    ),
    null,
    at('00:00')
  );
  const allocations = candidates.map((c) => ({
    title: c.title,
    selected: slotIntent.slots.some((slot) =>
      slot.tasks.some((item) => item.candidate.key === c.key)
    ),
    scheduled: scheduled.scheduled.get(c.key) ?? 0,
  }));
  process.stdout.write(`${JSON.stringify({ allocations, summary: slotIntent.summary })}\n`);
  assert.ok(allocations.some((allocation) => allocation.scheduled > 0));
  assert.ok(
    scheduled.document.operations.every(
      (operation) =>
        operation.type !== 'add' ||
        (operation.block.startsAt >= s.effectiveAvailability.slots[0].startsAt &&
          operation.block.endsAt <= s.effectiveAvailability.slots[0].endsAt)
    )
  );
}
main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Allocation check failed'}\n`);
  process.exitCode = 1;
});

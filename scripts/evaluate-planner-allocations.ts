/** Opt-in synthetic Ollama allocation check; reads no user records and saves no proposals.
 * Run: node --conditions=react-server --import tsx scripts/evaluate-planner-allocations.ts
 * Uses OLLAMA_BASE_URL from .env; defaults to qwen3:8b (PLANNER_EVAL_MODEL overrides).
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { generateStructured } from '../lib/ai/structured';
import { PLANNING_SYSTEM } from '../lib/planner/generation/service';
import { selectionContract } from '../lib/planner/generation/selection';
import { planningCandidates } from '../lib/planner/generation/candidates';
import { placementIntent } from '../lib/planner/generation/intent';
import { scheduleDay } from '../lib/planner/generation/schedule';
import { fixture, at } from '../lib/planner/generation/fixtures';
import { DEFAULT_MEAL_PREFERENCES } from '../lib/planner/meals';
import { mealPreferences } from '../lib/planner/generation/meals';
async function main() {
  const s = fixture([9999, 30, 300, 30]);
  s.timezone = 'Europe/Amsterdam';
  s.windows = [{ startMinute: 1119, endMinute: 1440 }] as typeof s.windows;
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
  const contract = selectionContract(candidates);
  const selection = contract.resolve(
    await generateStructured({
      selection: { provider: 'ollama', modelId: process.env.PLANNER_EVAL_MODEL || 'qwen3:8b' },
      schema: contract.schema,
      system: PLANNING_SYSTEM,
      prompt: JSON.stringify({
        date: s.date,
        timezone: s.timezone,
        guidance,
        availability: [{ startsAt: '2030-01-07T17:39:00Z', endsAt: '2030-01-07T23:00:00Z' }],
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
  ).selection;
  const intent = placementIntent(candidates, selection, guidance);
  const scheduled = scheduleDay(s, intent.ordered, intent.workBudgetMinutes, at('00:00'));
  const allocations = candidates.map((c) => ({
    title: c.title,
    requested: selection.selected.find((item) => item.key === c.key)?.plannedMinutes,
    scheduled: scheduled.scheduled.get(c.key) ?? 0,
  }));
  process.stdout.write(`${JSON.stringify({ allocations, summary: selection.summary })}\n`);
  assert.equal(allocations[0].scheduled, 60);
  assert.ok(allocations[1].scheduled > 0 && allocations[1].scheduled <= 30);
  assert.ok(allocations[2].scheduled > allocations[0].scheduled);
  assert.ok(allocations[3].scheduled > 0);
}
main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Allocation check failed'}\n`);
  process.exitCode = 1;
});

/* eslint-disable no-console -- Opt-in smoke output contains only synthetic planning data. */
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], quiet: true });
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { plannerSmokeAccount } from './planner-smoke-fixture';
import { prisma } from '../lib/prisma';
import { discoverModels } from '../lib/ai/ollama';
import { modelSettingsService } from '../lib/model-settings/service';
import { plannerChatConversations, streamPlannerChat } from '../lib/planner/chat/service';
import { draftService } from '../lib/planner/drafts/service';
import { generateWorkingDraft } from '../lib/planner/drafts/generation';
async function main() {
  if (process.env.VELA_PLANNER_OLLAMA_SMOKE !== '1') {
    throw new Error('Set VELA_PLANNER_OLLAMA_SMOKE=1 for this opt-in live-model test.');
  }
  const account = await plannerSmokeAccount();
  const userId = account.id;
  const date = '2030-01-07';
  try {
    const models = await discoverModels();
    console.log('Available models:', models.map((m) => m.id).join(', '));
    const conversationModel = process.env.VELA_PLANNER_CONVERSATION_MODEL || 'qwen3:8b';
    const schedulerModel = process.env.VELA_PLANNER_SCHEDULER_MODEL || 'qwen3:14b';
    await modelSettingsService.update(userId, {
      key: 'planner.conversation',
      value: { provider: 'ollama', modelId: conversationModel },
    });
    await modelSettingsService.update(userId, {
      key: 'planner.dayPlan',
      value: { provider: 'ollama', modelId: schedulerModel },
    });
    await prisma.availabilityWindow.createMany({
      data: [{ userId, weekday: 1, startMinute: 540, endMinute: 1020 }],
      skipDuplicates: true,
    });
    if (!(await prisma.task.findFirst({ where: { userId, title: 'Synthetic thesis' } }))) {
      await prisma.task.create({
        data: { userId, title: 'Synthetic thesis', estimatedMinutes: 120, category: 'WORK' },
      });
    }
    const oldDraft = (await draftService.read(userId, date)).draft;
    if (oldDraft) {
      await draftService.cancel(userId, {
        date,
        requestId: randomUUID(),
        draftId: oldDraft.id,
        expectedVersion: oldDraft.version,
        confirmed: true,
      });
    }
    const conversation = await plannerChatConversations.create(userId);
    const turn = async (text: string) => {
      const input = {
        date,
        conversationId: conversation.id,
        message: {
          id: randomUUID(),
          role: 'user' as const,
          parts: [{ type: 'text' as const, text }],
        },
      };
      const response = await streamPlannerChat(userId, input, AbortSignal.timeout(150000));
      const stream = await response.text();
      const saved = await plannerChatConversations.get(userId, conversation.id);
      const message = saved.messages.at(-1)!;
      const parts = message.parts as any[];
      const output = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const data = parts.filter((p) => p.type === 'data-planning').map((p) => p.data);
      console.log(JSON.stringify({ status: saved.lastResponseStatus, reply: output, tools: data }));
      assert.equal(saved.lastResponseStatus, 'COMPLETED');
      const toolErrors = parts
        .filter((p) => p.type === 'data-plannerDebug')
        .flatMap((p) => p.data.events.filter((event: any) => event.kind === 'tool-error'));
      if (stream.includes('tool-output-error')) {
        console.log(
          `Recovered tool argument/execution errors: ${toolErrors.length}; final persisted behavior is checked below.`
        );
      }
      return { output, data };
    };
    await turn(`Generate a draft for ${date}, allocating 60 minutes to Synthetic thesis.`);
    let draft = (await draftService.read(userId, date)).draft;
    assert(
      draft && draft.state.blocks.some((b) => b.taskId),
      'live generation must persist draft blocks'
    );
    assert.equal(
      await prisma.dailyPlan.count({
        where: { userId, planDate: new Date(`${date}T00:00:00Z`), isCurrent: true },
      }),
      0
    );
    const before = draft.version;
    await turn('What date are we planning? Just answer; do not change the schedule.');
    assert.equal((await draftService.read(userId, date)).draft?.version, before);
    const block = draft.state.blocks.find((b) => b.taskId)!;
    const hour = Array.from({ length: 8 }, (_, i) => i + 9).find((hour) => {
      const start = new Date(`${date}T${String(hour - 1).padStart(2, '0')}:00:00Z`);
      const end = new Date(start.getTime() + 3600000);
      return (
        !draft!.state.blocks.some(
          (b) => b.id !== block.id && new Date(b.startsAt) < end && new Date(b.endsAt) > start
        ) &&
        !draft!.state.slots.some(
          (s) => s.category !== 'WORK' && new Date(s.startsAt) < end && new Date(s.endsAt) > start
        ) &&
        block.startsAt !== start.toISOString()
      );
    });
    assert(hour !== undefined, 'fixture has a free valid hour');
    await turn(
      `Move block ${block.id} to ${String(hour).padStart(2, '0')}:00 until ${String(hour + 1).padStart(2, '0')}:00 on ${date}.`
    );
    draft = (await draftService.read(userId, date)).draft;
    assert(draft && draft.version === before + 1, 'one chat instruction must create one revision');
    assert(
      draft.state.blocks.some(
        (b) =>
          b.taskId === block.taskId &&
          b.startsAt.includes(`${String(hour - 1).padStart(2, '0')}:00:00`)
      ),
      'Amsterdam 14:00 stored as 13:00Z'
    );
    const manualBlock = draft.state.blocks.find((b) => b.taskId === block.taskId)!;
    const regenerate = {
      date,
      requestId: randomUUID(),
      draftId: draft.id,
      expectedVersion: draft.version,
      mode: 'ai' as const,
    };
    const regenerated = await generateWorkingDraft(userId, regenerate);
    assert.deepEqual(
      await generateWorkingDraft(userId, regenerate),
      regenerated,
      'retrying a completed generation request must replay its receipt'
    );
    draft = (await draftService.read(userId, date)).draft;
    assert.deepEqual(
      draft?.state.blocks.find((candidate) => candidate.id === manualBlock.id),
      manualBlock,
      'normal live regeneration must preserve the manual override exactly'
    );
    await prisma.task.create({
      data: { userId, title: 'Synthetic outage fixture', estimatedMinutes: 30 },
    });
    const beforeFailure = (await draftService.read(userId, date)).draft!;
    const originalURL = process.env.OLLAMA_BASE_URL;
    try {
      process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
      await assert.rejects(
        generateWorkingDraft(userId, {
          date,
          requestId: randomUUID(),
          draftId: beforeFailure.id,
          expectedVersion: beforeFailure.version,
          mode: 'ai',
        })
      );
    } finally {
      process.env.OLLAMA_BASE_URL = originalURL;
    }
    const afterFailure = (await draftService.read(userId, date)).draft!;
    assert.equal(afterFailure.version, beforeFailure.version);
    assert.deepEqual(afterFailure.state, beforeFailure.state);
    await plannerChatConversations.delete(userId, conversation.id);
    assert((await draftService.read(userId, date)).draft, 'deleting chat must retain draft');
    console.log(JSON.stringify({ date, conversationModel, schedulerModel, result: 'passed' }));
    console.log('Live persistent draft generation/question/edit/conversation-delete passed.');
  } finally {
    await account.cleanup();
    await prisma.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { plannerSmokeAccount } from './planner-smoke-fixture.ts';
import { prisma } from '../lib/prisma.ts';
if (process.env.VELA_PLANNER_BROWSER_SMOKE !== '1')
  throw new Error('Set VELA_PLANNER_BROWSER_SMOKE=1 to run this opt-in synthetic browser test.');
const { chromium } = await import(process.env.VELA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.VELA_CHROMIUM_EXECUTABLE_PATH,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 1720, height: 1050 },
  timezoneId: 'Europe/Amsterdam',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const root = process.env.VELA_PLANNER_SMOKE_BASE_URL || 'http://localhost:3000';
const user = await plannerSmokeAccount();
async function call(name, input, read = false) {
  const data = { json: input };
  const response = read
    ? await context.request.get(
        `${root}/api/trpc/${name}?input=${encodeURIComponent(JSON.stringify(data))}`
      )
    : await context.request.post(`${root}/api/trpc/${name}`, { data });
  const body = await response.json();
  if (!response.ok() || body.error) throw new Error(`${name}: ${JSON.stringify(body)}`);
  return body.result.data.json;
}
try {
  const login = await context.request.post(`${root}/api/auth/sign-in/email`, {
    headers: { Origin: process.env.VELA_PLANNER_SMOKE_ORIGIN || root },
    data: { email: user.email, password: user.password },
  });
  assert(login.ok(), `login ${login.status()}`);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(new Date(`${today}T12:00:00Z`).getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  const old = (await call('plannerDraft.read', { date }, true)).draft;
  if (old)
    await call('plannerDraft.cancel', {
      date,
      draftId: old.id,
      expectedVersion: old.version,
      requestId: randomUUID(),
      confirmed: true,
    });
  await call('planner.updateDayAvailability', {
    date,
    windows: [{ startMinute: 540, endMinute: 1020 }],
  });
  const task = await call('planner.createTask', {
    title: `Drag fixture ${randomUUID().slice(0, 6)}`,
  });
  await call('planner.updateTask', { id: task.id, patch: { estimatedMinutes: 30 } });
  await page.goto(`${root}/planner/today`);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  const sidebarTask = page.locator('[draggable="true"]').filter({ hasText: task.title }).first();
  await sidebarTask.waitFor();
  const slot = page.locator('[aria-label="Active schedule"] [aria-label*="11:00:00 - 11:15:00"]');
  await sidebarTask.dragTo(slot);
  await page.locator('[aria-label="Editable draft schedule"]').waitFor();
  let draft = (await call('plannerDraft.read', { date }, true)).draft;
  assert(draft.state.blocks.some((b) => b.taskId === task.id));
  let block = draft.state.blocks.find((b) => b.taskId === task.id);
  const editable = page.locator('[aria-label="Editable draft schedule"]');
  const event = editable.locator(`[data-event-id="${block.id}"]`);
  await event.dragTo(editable.locator('[aria-label*="12:00:00 - 12:15:00"]'));
  await page.waitForTimeout(700);
  draft = (await call('plannerDraft.read', { date }, true)).draft;
  block = draft.state.blocks.find((b) => b.taskId === task.id);
  assert(block.startsAt.includes('11:00:00'), 'move to local noon persists as 11:00Z');
  const handle = editable.locator(`[data-event-id="${block.id}"] [data-edge="bottom"]`);
  const box = await handle.boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const edge = await editable.locator('[aria-label*="12:15:00 - 12:30:00"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, edge.y + 1, { steps: 8 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(700);
  draft = (await call('plannerDraft.read', { date }, true)).draft;
  assert(
    draft.state.blocks.find((b) => b.taskId === task.id).durationMinutes < 30,
    'pointer resize persists shorter duration'
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
  await page.locator('[aria-label="Editable draft schedule"]').waitFor({ state: 'detached' });
  const before = await call('planner.getPlan', { date }, true);
  const second = await call('planner.createTask', {
    title: `Second fixture ${randomUUID().slice(0, 6)}`,
  });
  await call('planner.updateTask', { id: second.id, patch: { estimatedMinutes: 30 } });
  await page.reload();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await page
    .locator('[draggable="true"]')
    .filter({ hasText: second.title })
    .first()
    .dragTo(page.locator('[aria-label="Active schedule"] [aria-label*="14:00:00 - 14:15:00"]'));
  await page.locator('[aria-label="Editable draft schedule"]').waitFor();
  const activeView = page.locator('[aria-label="Active schedule, read only"]');
  assert.equal(await activeView.locator('[draggable="true"]').count(), 0);
  assert.deepEqual(await call('planner.getPlan', { date }, true), before);
  await page.getByRole('button', { name: 'Cancel draft', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel draft', exact: true }).click();
  await page.locator('[aria-label="Editable draft schedule"]').waitFor({ state: 'detached' });
  assert.deepEqual(await call('planner.getPlan', { date }, true), before);

  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: [
        'real candidate drag/drop creates draft',
        'real event move',
        'pointer resize',
        'undo resize',
        'accept',
        'first edit clones existing active',
        'active calendar read-only',
        'cancel preserves active',
      ],
      date,
    })
  );
} finally {
  await browser.close();
  await user.cleanup();
  await prisma.$disconnect();
}

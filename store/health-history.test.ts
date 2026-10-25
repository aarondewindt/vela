import { useHealthHistoryStore } from './health-history';

beforeEach(() => {
  localStorage.clear();
  useHealthHistoryStore.setState({ range: '10d' });
});

it('restores a valid shared range after reload and persists subsequent choices', async () => {
  localStorage.setItem('health-history', JSON.stringify({ state: { range: 'all' }, version: 0 }));
  await useHealthHistoryStore.persist.rehydrate();
  expect(useHealthHistoryStore.getState().range).toBe('all');
  useHealthHistoryStore.getState().setRange('6m');
  expect(JSON.parse(localStorage.getItem('health-history')!).state.range).toBe('6m');
});

it('ignores unsupported stored choices and keeps the default', async () => {
  localStorage.setItem('health-history', JSON.stringify({ state: { range: 'today' }, version: 0 }));
  await useHealthHistoryStore.persist.rehydrate();
  expect(useHealthHistoryStore.getState().range).toBe('10d');
});

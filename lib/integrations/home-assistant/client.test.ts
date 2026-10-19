/** @jest-environment node */
jest.mock('server-only', () => ({}));
import { HomeAssistantClient } from './client';
class FakeSocket extends EventTarget {
  static OPEN = 1;
  static current: FakeSocket;
  readyState = 1;
  send = jest.fn();
  close = jest.fn();
  constructor(readonly url: URL) {
    super();
    FakeSocket.current = this;
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}
const originalSocket = global.WebSocket;
const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  process.env.HOME_ASSISTANT_ALLOWED_ORIGINS = 'https://ha.example.com';
  global.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  jest.useRealTimers();
  global.WebSocket = originalSocket;
  global.fetch = originalFetch;
  delete process.env.HOME_ASSISTANT_ALLOWED_ORIGINS;
});
it('authenticates, subscribes only selected entities and reconstructs compact state changes', async () => {
  const client = new HomeAssistantClient('https://ha.example.com', 'private');
  const stop = new AbortController();
  const receive = jest.fn();
  const listening = client.listen(['sensor.weight'], receive, stop.signal);
  const socket = FakeSocket.current;
  socket.message({ type: 'auth_required' });
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
    type: 'auth',
    access_token: 'private',
  });
  socket.message({ type: 'auth_ok' });
  expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({
    id: 1,
    type: 'subscribe_entities',
    entity_ids: ['sensor.weight'],
  });
  socket.message({
    type: 'event',
    id: 1,
    event: {
      a: {
        'sensor.weight': {
          s: '80',
          a: { unit_of_measurement: 'kg', obsolete: true },
          lc: 1768087800,
        },
        'sensor.other': { s: '10' },
      },
    },
  });
  socket.message({
    type: 'event',
    id: 1,
    event: {
      c: { 'sensor.weight': { '+': { s: '81', lc: 1768087900 }, '-': { a: ['obsolete'] } } },
    },
  });
  expect(receive).toHaveBeenCalledTimes(2);
  expect(receive.mock.calls[1][0]).toMatchObject({
    entity_id: 'sensor.weight',
    state: '81',
    attributes: { unit_of_measurement: 'kg' },
  });
  expect(receive.mock.calls[1][0].attributes).not.toHaveProperty('obsolete');
  stop.abort();
  await listening;
  expect(socket.close).toHaveBeenCalled();
});
it('rejects invalid authentication without echoing server data or credentials', async () => {
  const stop = new AbortController();
  const listening = new HomeAssistantClient('https://ha.example.com', 'private').listen(
    ['sensor.a'],
    jest.fn(),
    stop.signal
  );
  FakeSocket.current.message({ type: 'auth_invalid', message: 'secret data' });
  await expect(listening).rejects.toThrow('rejected the token');
});
it('detects stalled connections and closes them for worker reconnection', async () => {
  const listening = new HomeAssistantClient('https://ha.example.com', 'private').listen(
    ['sensor.a'],
    jest.fn(),
    new AbortController().signal
  );
  jest.advanceTimersByTime(60000);
  await expect(listening).rejects.toThrow('timed out');
  expect(FakeSocket.current.close).toHaveBeenCalled();
});
it('uses bearer auth with redirects disabled and sanitizes remote HTTP errors', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response('secret data', { status: 401 }));
  await expect(
    new HomeAssistantClient('https://ha.example.com', 'private').states()
  ).rejects.toThrow('rejected the token or permissions');
  expect(global.fetch).toHaveBeenCalledWith(
    'https://ha.example.com/api/states',
    expect.objectContaining({
      headers: { Authorization: 'Bearer private' },
      redirect: 'error',
      cache: 'no-store',
    })
  );
});

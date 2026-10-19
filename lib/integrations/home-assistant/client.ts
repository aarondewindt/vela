import 'server-only';
import { z } from 'zod';
import { homeAssistantUrl } from './security';

export const stateSchema = z.object({
  entity_id: z.string().max(240),
  state: z.string().max(500),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.iso.datetime({ offset: true }),
  last_updated: z.iso.datetime({ offset: true }),
});
export type HomeAssistantState = z.infer<typeof stateSchema>;
export class HomeAssistantError extends Error {
  constructor(message = 'Home Assistant is unavailable. Check the URL, network and token.') {
    super(message);
  }
}
/** Server-only, read-only adapter. Callers supply credentials resolved for their owner. */
export class HomeAssistantClient {
  readonly baseUrl: string;
  constructor(
    baseUrl: string,
    private readonly token: string
  ) {
    this.baseUrl = homeAssistantUrl(baseUrl);
  }
  private async get(path: string) {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new HomeAssistantError(
          response.status === 401 || response.status === 403
            ? 'Home Assistant rejected the token or permissions.'
            : undefined
        );
      }
      // Bound response size, including chunked responses.
      const reader = response.body?.getReader();
      if (!reader) {
        throw new HomeAssistantError();
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          bytes += value.length;
          if (bytes > 8_000_000) {
            throw new HomeAssistantError('Home Assistant response exceeds the import limit.');
          }
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof HomeAssistantError) {
        throw error;
      }
      throw new HomeAssistantError();
    }
  }
  async states() {
    return z
      .array(stateSchema)
      .max(20000)
      .parse(await this.get('/api/states'));
  }
  async history(entityIds: string[], start: Date, end: Date) {
    if (!entityIds.length) {
      return [];
    }
    const query = new URLSearchParams({
      filter_entity_id: entityIds.join(','),
      end_time: end.toISOString(),
      significant_changes_only: '0',
      skip_initial_state: '1',
    });
    return z
      .array(z.array(stateSchema))
      .parse(
        await this.get(`/api/history/period/${encodeURIComponent(start.toISOString())}?${query}`)
      )
      .flat();
  }
  /** Subscribe before reconciliation so changes during the history read are not lost. */
  listen(
    entityIds: string[],
    onState: (state: HomeAssistantState) => void,
    signal: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/websocket', this.baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      const states = new Map<string, HomeAssistantState>();
      let settled = false;
      let lastMessage = Date.now();
      let authenticated = false;
      let nextId = 2;
      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(timer);
        signal.removeEventListener('abort', abort);
        socket.close();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const abort = () => finish();
      const timer = setInterval(() => {
        if (Date.now() - lastMessage > 45000) {
          finish(new HomeAssistantError('Home Assistant subscription timed out.'));
        } else if (authenticated && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: nextId++, type: 'ping' }));
        }
      }, 15000);
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('error', () => finish(new HomeAssistantError()));
      socket.addEventListener('close', () =>
        finish(
          signal.aborted
            ? undefined
            : new HomeAssistantError('Home Assistant disconnected. Reconnecting.')
        )
      );
      socket.addEventListener('message', (event) => {
        try {
          if (typeof event.data !== 'string' || event.data.length > 2_000_000) {
            throw new HomeAssistantError('Invalid Home Assistant subscription response.');
          }
          const msg = JSON.parse(event.data);
          lastMessage = Date.now();
          if (msg.type === 'auth_required') {
            socket.send(JSON.stringify({ type: 'auth', access_token: this.token }));
          } else if (msg.type === 'auth_invalid') {
            finish(new HomeAssistantError('Home Assistant rejected the token.'));
          } else if (msg.type === 'auth_ok') {
            authenticated = true;
            socket.send(
              JSON.stringify({ id: 1, type: 'subscribe_entities', entity_ids: entityIds })
            );
          } else if (msg.type === 'result' && msg.success === false) {
            finish(
              new HomeAssistantError(
                'Home Assistant rejected the subscription. Check permissions and version.'
              )
            );
          } else if (msg.type === 'event' && msg.id === 1) {
            const payload = msg.event;
            for (const [id, raw] of Object.entries(payload.a ?? {})) {
              if (!entityIds.includes(id)) {
                continue;
              }
              const value = raw as {
                s: string;
                a: Record<string, unknown>;
                lc: number;
                lu?: number;
              };
              const state = stateSchema.parse({
                entity_id: id,
                state: value.s,
                attributes: value.a,
                last_changed: new Date(value.lc * 1000).toISOString(),
                last_updated: new Date((value.lu ?? value.lc) * 1000).toISOString(),
              });
              states.set(id, state);
              onState(state);
            }
            for (const [id, raw] of Object.entries(payload.c ?? {})) {
              const previous = states.get(id);
              if (!previous) {
                continue;
              }
              const change = raw as {
                '+': { s?: string; a?: Record<string, unknown>; lc?: number; lu?: number };
                '-': { a?: string[] };
              };
              const added = change['+'] ?? {};
              const attributes = { ...previous.attributes, ...added.a };
              for (const key of change['-']?.a ?? []) {
                delete attributes[key];
              }
              const state = stateSchema.parse({
                ...previous,
                state: added.s ?? previous.state,
                attributes,
                last_changed:
                  added.lc === undefined
                    ? previous.last_changed
                    : new Date(added.lc * 1000).toISOString(),
                last_updated:
                  added.lu === undefined
                    ? added.lc === undefined
                      ? previous.last_updated
                      : new Date(added.lc * 1000).toISOString()
                    : new Date(added.lu * 1000).toISOString(),
              });
              states.set(id, state);
              onState(state);
            }
            for (const id of payload.r ?? []) {
              const previous = states.get(id);
              if (previous) {
                onState({ ...previous, state: 'unavailable' });
              }
              states.delete(id);
            }
          }
        } catch {
          finish(new HomeAssistantError('Invalid Home Assistant subscription response.'));
        }
      });
      if (signal.aborted) {
        abort();
      }
    });
  }
}

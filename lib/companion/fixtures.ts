// Synthetic diagnostic fixtures for boundary and persistence tests; never personal health data.
export const attemptFixture = {
  id: '10000000-0000-4000-8000-000000000001',
  trigger: 'manual',
  createdAt: '2026-01-01T12:00:00Z',
  startedAt: '2026-01-01T12:00:00Z',
  endedAt: '2026-01-01T12:00:01Z',
  durationMs: 1000,
  timezone: 'Europe/Amsterdam',
  status: 'failed',
  source: 'samsung_health',
  appVersion: 'test',
  os: 'test',
  provider: 'Samsung test',
  stages: [{ name: 'permission', at: '2026-01-01T12:00:00Z' }],
  queries: [],
  metrics: [],
  requests: [],
  error: { category: 'permission', detail: 'Read permission missing.' },
};
export const snapshotFixture = {
  version: 1,
  appVersion: 'test',
  capturedAt: '2026-01-01T12:01:00Z',
  diagnostic: {
    source: 'Samsung test',
    environment: 'Android test',
    report: null,
    reportAvailable: false,
    permission: 'denied',
    pending: false,
    paused: false,
    historyAvailable: true,
  },
  attempts: [attemptFixture],
};
export const healthFixture = {
  version: 1,
  source: 'samsung_health',
  measurements: [
    {
      metric: 'STEPS',
      value: 1234,
      unit: 'steps',
      date: '2026-01-01',
      timezone: 'UTC',
      periodStart: '2026-01-01T00:00:00Z',
      periodEnd: '2026-01-02T00:00:00Z',
      observedAt: '2026-01-02T01:00:00Z',
      measurementKind: 'sdk_steps_total',
    },
  ],
};

import { attemptSchema, diagnosticUploadSchema, historyFilterSchema, redact } from './schema';
import { attemptFixture, snapshotFixture } from './fixtures';
it('accepts bounded scheduler diagnostics and stop reasons while retaining old clients', () => {
  const background = {
    intervalMinutes: 15,
    workAvailable: true,
    powerSaveMode: false,
    batteryOptimizationIgnored: false,
    backgroundRestricted: false,
    interactive: false,
    networkValidated: true,
    batteryPercent: 39,
    work: [
      {
        id: attemptFixture.id,
        state: 'ENQUEUED',
        runAttemptCount: 1,
        generation: 7,
        stopReason: -256,
        nextScheduleAt: '2099-01-01T00:00:00Z',
      },
    ],
  };
  const snapshot = {
    ...snapshotFixture,
    diagnostic: { ...snapshotFixture.diagnostic, background },
    attempts: [{ ...attemptFixture, workStopReason: 7 }],
  };
  expect(diagnosticUploadSchema.parse(snapshot).diagnostic.background).toEqual(background);
  expect(diagnosticUploadSchema.safeParse(snapshotFixture).success).toBe(true);
  for (const invalid of [
    { intervalMinutes: 10 },
    { batteryPercent: 101 },
    { work: Array(6).fill(background.work[0]) },
    { token: 'untrusted' },
  ]) {
    expect(
      diagnosticUploadSchema.safeParse({
        ...snapshot,
        diagnostic: { ...snapshot.diagnostic, background: { ...background, ...invalid } },
      }).success
    ).toBe(false);
  }
});
it('accepts an explicit report-unavailable snapshot even without readings or attempts', () => {
  expect(
    diagnosticUploadSchema.parse({ ...snapshotFixture, attempts: [] }).diagnostic.report
  ).toBeNull();
});
it('bounds structured history and rejects arbitrary logs, timestamps and inverted times', () => {
  expect(
    diagnosticUploadSchema.safeParse({ ...snapshotFixture, logcat: 'untrusted' }).success
  ).toBe(false);
  expect(
    diagnosticUploadSchema.safeParse({
      ...snapshotFixture,
      attempts: Array(101).fill(attemptFixture),
    }).success
  ).toBe(false);
  expect(
    diagnosticUploadSchema.safeParse({ ...snapshotFixture, capturedAt: '2099-01-01T00:00:00Z' })
      .success
  ).toBe(false);
  expect(
    attemptSchema.safeParse({ ...attemptFixture, endedAt: '2025-01-01T00:00:00Z' }).success
  ).toBe(false);
  expect(
    diagnosticUploadSchema.safeParse({
      ...snapshotFixture,
      diagnostic: { ...snapshotFixture.diagnostic, report: 'x'.repeat(32001) },
    }).success
  ).toBe(false);
  expect(
    diagnosticUploadSchema.safeParse({
      ...snapshotFixture,
      diagnostic: { ...snapshotFixture.diagnostic, reportAvailable: true },
    }).success
  ).toBe(false);
});
it('redacts credential patterns from every accepted diagnostic text field', () => {
  const secret = 'vela_device_fake-private-token';
  const result = diagnosticUploadSchema.parse({
    ...snapshotFixture,
    diagnostic: {
      ...snapshotFixture.diagnostic,
      reportAvailable: true,
      report: `Bearer abc\n${secret}\ntoken=hidden\nAuthorization: hidden`,
    },
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('hidden');
  expect(redact('password=private')).not.toContain('private');
});
it('caps pages and validates date filters', () => {
  expect(historyFilterSchema.parse({}).limit).toBe(25);
  expect(historyFilterSchema.safeParse({ limit: 51 }).success).toBe(false);
  expect(historyFilterSchema.safeParse({ from: '2026-02-02', to: '2026-01-01' }).success).toBe(
    false
  );
});

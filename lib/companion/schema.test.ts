import { attemptSchema, diagnosticUploadSchema, historyFilterSchema, redact } from './schema';
import { attemptFixture, snapshotFixture } from './fixtures';
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

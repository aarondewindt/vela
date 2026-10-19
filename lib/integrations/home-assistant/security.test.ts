/** @jest-environment node */
jest.mock('server-only', () => ({}));
import { decryptToken, encryptToken, homeAssistantUrl } from './security';
const original = { ...process.env };
beforeEach(() => {
  process.env.HOME_ASSISTANT_ALLOWED_ORIGINS = 'http://192.168.0.5:8123,https://ha.example.com';
  process.env.INTEGRATION_ENCRYPTION_KEY = 'ab'.repeat(32);
});
afterAll(() => {
  process.env = original;
});
it('only accepts exact operator-approved origins without credentials, query, path or fragment', () => {
  expect(homeAssistantUrl('http://192.168.0.5:8123/')).toBe('http://192.168.0.5:8123');
  for (const url of [
    'http://169.254.169.254',
    'file:///tmp/a',
    'https://ha.example.com.evil.com',
    'https://ha.example.com/api',
    'https://user:pass@ha.example.com',
    'https://ha.example.com?token=abc',
    'https://ha.example.com#x',
  ]) {
    expect(() => homeAssistantUrl(url)).toThrow();
  }
  delete process.env.HOME_ASSISTANT_ALLOWED_ORIGINS;
  expect(() => homeAssistantUrl('https://ha.example.com')).toThrow();
});
it('encrypts using randomized authenticated encryption bound to the owner', () => {
  const a = encryptToken('private-token', 'alice');
  expect(a).not.toContain('private-token');
  expect(a).not.toEqual(encryptToken('private-token', 'alice'));
  expect(decryptToken(a, 'alice')).toBe('private-token');
  expect(() => decryptToken(a, 'bob')).toThrow();
  const parts = a.split('.');
  parts[1] = Buffer.alloc(16).toString('base64');
  expect(() => decryptToken(parts.join('.'), 'alice')).toThrow();
});
it('fails closed without a valid dedicated encryption key', () => {
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  expect(() => encryptToken('secret', 'alice')).toThrow('INTEGRATION_ENCRYPTION_KEY');
});

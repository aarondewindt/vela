/** @jest-environment node */
import { getAuthConfig } from './auth-config';

const env = { BETTER_AUTH_SECRET: 'a'.repeat(48) };
const publicEnv = {
  ...env,
  VELA_PUBLIC_MODE: 'true',
  BETTER_AUTH_URL: 'https://vela.aarondewindt.space',
};

it('requires a strong explicit secret, including for local development', () => {
  for (const secret of [
    undefined,
    'short',
    'your-secret-key-change-this-in-production',
    'REPLACE_WITH_OUTPUT_OF_openssl_rand_hex_32',
  ]) {
    expect(() => getAuthConfig({ BETTER_AUTH_SECRET: secret })).toThrow('BETTER_AUTH_SECRET');
  }
});
it('uses only the canonical HTTPS origin in public mode and closes registration by default', () => {
  const config = getAuthConfig({ ...publicEnv, BETTER_AUTH_TRUSTED_ORIGINS: 'https://evil.test' });
  expect(config.trustedOrigins).toEqual(['https://vela.aarondewindt.space']);
  expect(config.signupDisabled).toBe(true);
  expect(config.canSignUp('someone@test-email.aarondewindt.space')).toBe(false);
  for (const url of ['http://vela.aarondewindt.space', 'https://vela.aarondewindt.space/path']) {
    expect(() => getAuthConfig({ ...publicEnv, BETTER_AUTH_URL: url })).toThrow('HTTPS origin');
  }
});
it('permits only exact allowlisted registration addresses, with no email-verification claim', () => {
  const config = getAuthConfig({ ...publicEnv, VELA_SIGNUP_EMAILS: ' Me@example.com ' });
  expect(config.signupDisabled).toBe(false);
  expect(config.canSignUp('me@EXAMPLE.com')).toBe(true);
  expect(config.canSignUp('other@example.com')).toBe(false);
  expect(config.canSignUp(null)).toBe(false);
});
it('retains local test-domain registration and explicit local trusted origins', () => {
  const config = getAuthConfig({ ...env, BETTER_AUTH_TRUSTED_ORIGIN: 'http://localhost:3002' });
  expect(config.canSignUp('dev@test-email.aarondewindt.space')).toBe(true);
  expect(config.canSignUp('other@example.com')).toBe(false);
  expect(config.trustedOrigins).toContain('http://localhost:3002');
});

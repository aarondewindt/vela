export function getAuthConfig(env: Record<string, string | undefined>) {
  const publicMode = env.VELA_PUBLIC_MODE === 'true';
  const baseURL = env.BETTER_AUTH_URL || 'http://localhost:3000';
  const url = new URL(baseURL);
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || /your.secret|change.this|replace.with/i.test(secret)) {
    throw new Error(
      'BETTER_AUTH_SECRET must be a non-placeholder secret of at least 32 characters.'
    );
  }
  if (publicMode && (url.protocol !== 'https:' || url.origin !== baseURL)) {
    throw new Error('Public mode requires BETTER_AUTH_URL to be an HTTPS origin without a path.');
  }
  const signupEmails = (env.VELA_SIGNUP_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const trustedOrigins = publicMode
    ? [url.origin]
    : Array.from(
        new Set([
          url.origin,
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          ...[env.BETTER_AUTH_TRUSTED_ORIGINS, env.BETTER_AUTH_TRUSTED_ORIGIN]
            .filter(Boolean)
            .flatMap((value) => value!.split(','))
            .map((value) => value.trim())
            .filter(Boolean),
        ])
      );
  return {
    publicMode,
    baseURL,
    secret,
    trustedOrigins,
    signupDisabled: publicMode && signupEmails.length === 0,
    canSignUp(email: unknown) {
      if (typeof email !== 'string') {
        return false;
      }
      const normalized = email.trim().toLowerCase();
      return signupEmails.length > 0
        ? signupEmails.includes(normalized)
        : !publicMode && normalized.endsWith('@test-email.aarondewindt.space');
    },
  };
}

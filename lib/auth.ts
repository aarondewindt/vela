import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { prisma } from '@/lib/prisma';
import { getAuthConfig } from '@/lib/auth-config';

const config = getAuthConfig(process.env);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: config.signupDisabled,
    minPasswordLength: config.publicMode ? 12 : 8,
    maxPasswordLength: 128,
  },
  appName: 'Vela',
  baseURL: config.baseURL,
  basePath: '/api/auth',
  secret: config.secret,
  trustedOrigins: config.trustedOrigins,
  advanced: {
    // The canonical origin is explicit; never derive redirects from forwarded headers.
    trustedProxyHeaders: false,
    useSecureCookies: config.baseURL.startsWith('https://'),
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    ...(config.publicMode ? { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } } : {}),
  },
  // Enable brute-force protection in development too. One process needs no shared store.
  rateLimit: { enabled: true, storage: 'memory' },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email' && !config.canSignUp(ctx.body?.email)) {
        throw new APIError('FORBIDDEN', { message: 'Registration is not enabled for this email.' });
      }
    }),
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = Session['user'];

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware, APIError } from "better-auth/api";
import { prisma } from '@/lib/prisma';

const defaultTrustedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const trustedOriginsFromEnv = [
  process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  process.env.BETTER_AUTH_TRUSTED_ORIGIN,
]
  .filter(Boolean)
  .flatMap((value) => value!.split(','))
  .map((value) => value.trim())
  .filter(Boolean);

const trustedOrigins = Array.from(new Set([
  ...trustedOriginsFromEnv,
  ...defaultTrustedOrigins,
]));

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  appName: 'Vela',
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET || 'your-secret-key',
  trustedOrigins,
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // Update every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  user: {
    additionalFields: {
      // Add any extra fields you want to track
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") {
        return;
      }
      if (!ctx.body?.email.endsWith("@example.com")) {
        throw new APIError("BAD_REQUEST", {
          message: "Email must end with @example.com",
        });
      }
    }),
  },

});

export type Session = typeof auth.$Infer.Session;
export type User = Session["user"];

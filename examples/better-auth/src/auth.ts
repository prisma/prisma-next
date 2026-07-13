import { prismaNextAdapter } from '@prisma-next/extension-better-auth/adapter';
import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';

/**
 * BetterAuth over the contract-typed adapter: hand it the app's shared
 * pool and it builds its space-scoped client view internally — every auth
 * read/write goes through the pack's contract-typed collections against
 * the same database as the app, with no second client in app code.
 */
export function createAuth(pool: Pool, options?: { readonly baseURL?: string }) {
  return betterAuth({
    baseURL: options?.baseURL ?? process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',
    secret: process.env['BETTER_AUTH_SECRET'] ?? 'example-only-secret-set-a-real-one',
    database: prismaNextAdapter({ pg: pool }),
    emailAndPassword: { enabled: true },
  });
}

export type Auth = ReturnType<typeof createAuth>;

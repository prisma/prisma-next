import { prismaNextAdapter } from '@prisma-next/extension-better-auth/adapter';
import { betterAuth } from 'better-auth';
import type { AuthDb } from './prisma/db';

/**
 * BetterAuth over the contract-typed adapter: every auth read/write goes
 * through the contract space's typed collections — same database as the
 * app, no schema drift between BetterAuth and the migrations that
 * created the tables.
 */
export function createAuth(authDb: AuthDb, options?: { readonly baseURL?: string }) {
  return betterAuth({
    baseURL: options?.baseURL ?? process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',
    secret: process.env['BETTER_AUTH_SECRET'] ?? 'example-only-secret-set-a-real-one',
    database: prismaNextAdapter(authDb),
    emailAndPassword: { enabled: true },
  });
}

export type Auth = ReturnType<typeof createAuth>;

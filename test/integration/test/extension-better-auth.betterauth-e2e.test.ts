/**
 * End-to-end consumer path: a real `betterAuth()` instance over
 * `prismaNextAdapter` and a PGlite-backed prisma-next db (managed space
 * migrated via the framework CLI path — no manual SQL).
 *
 * Drives email/password sign-up and session retrieval through the auth
 * API, then asserts the persisted rows landed in the contract-space
 * tables through the contract-typed collections. Fails iff the real
 * consumer path breaks.
 */
import { prismaNextAdapter } from '@prisma-next/extension-better-auth/adapter';
import { timeouts } from '@prisma-next/test-utils';
import { betterAuth } from 'better-auth';
import { afterAll, describe, expect, it } from 'vitest';
import { setupBetterAuthTestApp } from './extension-better-auth.harness.helpers';

const app = await setupBetterAuthTestApp();

const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'better-auth-e2e-test-secret-value',
  database: prismaNextAdapter(app.client),
  emailAndPassword: { enabled: true },
});

afterAll(async () => {
  await app.teardown();
});

describe('betterAuth() end-to-end over prismaNextAdapter (PGlite)', () => {
  it('signs up, persists into contract-space tables, and retrieves the session', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const signUp = await auth.api.signUpEmail({
      body: {
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
        name: 'Alice Example',
      },
      returnHeaders: true,
    });

    expect(signUp.response.user.email).toBe('alice@example.com');
    expect(signUp.response.user.id).toBeTypeOf('string');
    expect(signUp.response.token).toBeTypeOf('string');

    // Persisted rows are readable through the contract-typed collections.
    const userRow = await app.client.orm.public.User.where({
      email: 'alice@example.com',
    }).first();
    expect(userRow).not.toBeNull();
    expect(userRow?.name).toBe('Alice Example');
    expect(userRow?.emailVerified).toBe(false);
    expect(userRow?.createdAt).toBeInstanceOf(Date);

    const accountRow = await app.client.orm.public.Account.where({
      userId: signUp.response.user.id,
    }).first();
    expect(accountRow?.providerId).toBe('credential');
    expect(accountRow?.password).toBeTypeOf('string');

    const sessionRow = await app.client.orm.public.Session.where({
      userId: signUp.response.user.id,
    }).first();
    expect(sessionRow?.token).toBeTypeOf('string');
    expect(sessionRow?.expiresAt).toBeInstanceOf(Date);

    // Session retrieval through the auth API using the sign-up cookie.
    const cookie = signUp.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie ?? '' }),
    });
    expect(session).not.toBeNull();
    expect(session?.user.email).toBe('alice@example.com');
    expect(session?.session.userId).toBe(signUp.response.user.id);

    // Sign-in works against the persisted credential account.
    const signIn = await auth.api.signInEmail({
      body: { email: 'alice@example.com', password: 'correct-horse-battery-staple' },
    });
    expect(signIn.user.id).toBe(signUp.response.user.id);
  });
});

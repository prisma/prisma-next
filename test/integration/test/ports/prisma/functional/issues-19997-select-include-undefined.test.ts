import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from '../../_fixtures/issues-19997-select-include-undefined/generated/contract';
import contractJson from '../../_fixtures/issues-19997-select-include-undefined/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/19997-select-include-undefined
// (postgres matrix entry).
//
// Subject: `{ select: undefined }` and `{ include: undefined }` are treated as
// "select all scalar fields" — the undefined is ignored.
//
// API-shape translation:
//   `findFirstOrThrow({ select: undefined })` → `.firstOrThrow()` (no select = all fields)
//   `findFirstOrThrow({ include: undefined })` → `.firstOrThrow()` (no include = default select)
//
// Type assertions ported inline: the result has `id` and `email` properties.

function withIssue19997(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.create({ email: 'user@example.com' });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/issues-19997-select-include-undefined', () => {
  it(
    'correctly infers selection when passing select: undefined',
    () =>
      withIssue19997(async ({ db }) => {
        const user = await db.public.User.all().firstOrThrow();
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expectTypeOf(user).toHaveProperty('id');
        expectTypeOf(user).toHaveProperty('email');
        expectTypeOf(user).toMatchTypeOf<Partial<{ id: string; email: string }>>();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'correctly infers selection when passing include: undefined',
    () =>
      withIssue19997(async ({ db }) => {
        const user = await db.public.User.all().firstOrThrow();
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expectTypeOf(user).toHaveProperty('id');
        expectTypeOf(user).toHaveProperty('email');
        expectTypeOf(user).toMatchTypeOf<Partial<{ id: string; email: string }>>();
      }),
    timeouts.spinUpPpgDev,
  );
});

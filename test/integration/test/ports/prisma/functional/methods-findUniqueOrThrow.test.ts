import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/methods-findUniqueOrThrow/generated/contract';
import contractJson from '../../_fixtures/methods-findUniqueOrThrow/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/findUniqueOrThrow
// (postgres matrix entry).
//
// Upstream uses prisma.user.findUniqueOrThrow({ where: { email } }).
// prisma-next equivalent: db.public.User.where({ email }).all().firstOrThrow()
// which throws RUNTIME.NO_ROWS when no row is found (maps to upstream P2025).
//
// Non-ported:
//   - 'works with transactions' — batch $transaction API not in prisma-next
//   - 'works with interactive transactions' — interactive $transaction not in prisma-next
//   - 'reports correct method name in case of validation error' — type-check/validation error only

const existingEmail = 'existing@example.com';
const nonExistingEmail = 'nonexisting@example.com';

function withFindUniqueOrThrow(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.create({
      email: existingEmail,
      posts: (posts) => posts.create([{ title: 'How to exist?' }]),
    });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/methods-findUniqueOrThrow', () => {
  it(
    'finds existing record',
    () =>
      withFindUniqueOrThrow(async ({ db }) => {
        const record = await db.public.User.where({ email: existingEmail }).all().firstOrThrow();
        expect(record).toMatchObject({ email: existingEmail });
        expect(typeof record.id).toBe('string');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'throws if record was not found',
    () =>
      withFindUniqueOrThrow(async ({ db }) => {
        const query = db.public.User.where({ email: nonExistingEmail }).all().firstOrThrow();
        await expect(query).rejects.toMatchObject({
          code: 'RUNTIME.NO_ROWS',
        });
      }),
    timeouts.spinUpPpgDev,
  );
});

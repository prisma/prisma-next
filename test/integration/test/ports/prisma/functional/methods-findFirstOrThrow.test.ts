import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from '../../_fixtures/methods-findFirstOrThrow/generated/contract';
import contractJson from '../../_fixtures/methods-findFirstOrThrow/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/findFirstOrThrow
// (postgres matrix entry).
//
// Upstream uses prisma.user.findFirstOrThrow({ where: { email } }).
// prisma-next equivalent: db.public.User.where({ email }).all().firstOrThrow()
// which throws RUNTIME.NO_ROWS when no row is found (maps to upstream P2025).
//
// Non-ported:
//   - 'works with transactions' — batch $transaction API not in prisma-next
//   - 'works with interactive transactions' — interactive $transaction not in prisma-next
//   - 'reports correct method name in case of validation error' — type-check/validation
//     error shape differs; prisma-next enforces field names via TypeScript types, not
//     a runtime message containing 'findFirstOrThrow'

const existingEmail = 'existing@example.com';
const nonExistingEmail = 'nonexisting@example.com';

function withFindFirstOrThrow(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.create({
      email: existingEmail,
      posts: (posts) => posts.create([{ title: 'How to exist?' }]),
    });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/methods-findFirstOrThrow', () => {
  it(
    'finds existing record',
    () =>
      withFindFirstOrThrow(async ({ db }) => {
        const record = await db.public.User.where({ email: existingEmail }).all().firstOrThrow();
        expect(record).toMatchObject({ email: existingEmail });
        expect(typeof record.id).toBe('string');
        expectTypeOf(record).not.toBeNullable();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'throws if record was not found',
    () =>
      withFindFirstOrThrow(async ({ db }) => {
        const query = db.public.User.where({ email: nonExistingEmail }).all().firstOrThrow();
        await expect(query).rejects.toMatchObject({
          code: 'RUNTIME.NO_ROWS',
        });
      }),
    timeouts.spinUpPpgDev,
  );
});

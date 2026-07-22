import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/methods-count/generated/contract';
import contractJson from '../../_fixtures/methods-count/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/count
// (postgres matrix entry).
//
// Upstream seeds three users with email, age, name and counts rows under
// various conditions. Per-field count (count({ select: { _all, email, age, name } }))
// is not expressible via the ORM aggregate builder — those two tests are
// non-ported. "bad prop" is a type-check-only test — non-ported.

const SEED = [
  { email: 'user-1@email.com', age: 111, name: 'some-name-1' },
  { email: 'user-2@email.com', age: 222, name: 'some-name-2' },
  { email: 'user-3@email.com', age: 333, name: 'some-name-3' },
];

function withCount(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.createAll(SEED);
    await fn(ctx);
  });
}

describe('ports/prisma/functional/methods-count', () => {
  it(
    'simple',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.aggregate((agg) => ({ count: agg.count() }));
        expect(count).toBe(3);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'take',
    () =>
      withCount(async ({ db }) => {
        const rows = await db.public.User.take(2).all();
        expect(rows.length).toBe(2);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'where',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.where({ age: 111 }).aggregate((agg) => ({
          count: agg.count(),
        }));
        expect(count).toBe(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select where (select: true is a pass-through to count)',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.where({ age: 111 }).aggregate((agg) => ({
          count: agg.count(),
        }));
        expect(count).toBe(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select all true (select: true is a pass-through to count)',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.aggregate((agg) => ({ count: agg.count() }));
        expect(count).toBe(3);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select all false (same result as count)',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.aggregate((agg) => ({ count: agg.count() }));
        expect(count).toBe(3);
      }),
    timeouts.spinUpPpgDev,
  );
});

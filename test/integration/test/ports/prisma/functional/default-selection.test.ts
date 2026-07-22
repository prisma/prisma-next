import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from '../../_fixtures/default-selection/generated/contract';
import contractJson from '../../_fixtures/default-selection/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/default-selection
// (postgres matrix entry).
//
// Upstream asserts that the default selection returned by findFirstOrThrow:
//   - includes scalar fields (id, value, otherId)
//   - does NOT include relations
//   - includes enums
//   - includes String[] lists (postgres-only)
//   - includes Enum[] enum lists (postgres-only, not mysql)
//   - does NOT include MongoDB composites (mongo-only — skipped)
//
// EMITTER GAP: the faithful PSL translation includes `enumList Enum[]`
// (a text-backed enum list column), which the postgres emitter lowers to a
// CHECK constraint using `IN ('A', 'B')`. That constraint is invalid for
// Postgres array columns — Postgres rejects it with "malformed array literal"
// (sqlState 22P02) during plan→apply. The schema push therefore fails before
// any ORM operation can run. All tests in this suite are marked it.fails.
//
// Note: MongoDB `composite` field is mongo-only and is not ported here.

function withDefaultSelection(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

const SEED_OTHER = { id: 'other-1' };
const SEED_MODEL = {
  id: 'model-1',
  value: 'Foo',
  otherId: 'other-1',
  list: ['Hello', 'world'],
  enum: 'A' as const,
  enumList: ['A', 'B'] as const,
};

describe('ports/prisma/functional/default-selection', () => {
  it.fails(
    'includes scalars',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.id).toBeDefined();
        expect(model!.value).toBeDefined();
        expect(model!.otherId).toBeDefined();
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'does not include relations',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model).not.toHaveProperty('relation');
        expectTypeOf(model!).not.toBeAny();
        expectTypeOf(model!).not.toHaveProperty('relation');
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'includes enums',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.enum).toBeDefined();
        expect(model!.enum).toEqual('A');
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'includes lists',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.list).toBeDefined();
        expect(model!.list).toEqual(['Hello', 'world']);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'includes enum lists',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.enumList).toBeDefined();
        expect(model!.enumList).toEqual(['A', 'B']);
      }),
    timeouts.spinUpPpgDev,
  );
});

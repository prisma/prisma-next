import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/default-selection/generated/contract';
import contractJson from '../../_fixtures/default-selection/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/default-selection
// (postgres matrix entry).
//
// The source suite tests that:
//   - Scalar fields (id, value, otherId) are included in the default selection.
//   - Relations are NOT included by default.
//   - The `enum` field is included (postgres provider has native enum support).
//   - `list String[]` fields are included — NOT PORTED: array column types are
//     unsupported by the prisma-next TS contract builder.
//   - `enumList Enum[]` fields are included — NOT PORTED: same reason.
//   - MongoDB composites — NOT PORTED: MongoDB only.
//
// The fixture schema omits `list` and `enumList` (unsupported). Tests that only
// assert on expressible fields are ported below.

const DDL = [
  "create type \"Enum\" as enum ('A', 'B')",
  'create table "Other" ("id" text primary key)',
  'create table "Model" ("id" text primary key, "value" text not null, "otherId" text not null unique, "enum" "Enum" not null, constraint "Model_otherId_fkey" foreign key ("otherId") references "Other"("id"))',
];

function withDefaultSelection(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson, ddl: DDL }, async (ctx) => {
    await ctx.runtime.query('insert into "Other" ("id") values ($1)', ['other-1']);
    await ctx.runtime.query(
      'insert into "Model" ("id", "value", "otherId", "enum") values ($1, $2, $3, $4)',
      ['model-1', 'Foo', 'other-1', 'A'],
    );
    await fn(ctx);
  });
}

describe('ports/prisma/functional/default-selection', () => {
  it(
    'includes scalars',
    () =>
      withDefaultSelection(async ({ db }) => {
        const model = await db.public.Model.first();
        expect(model).not.toBeNull();
        expect(model?.id).toBeDefined();
        expect(model?.value).toBeDefined();
        expect(model?.otherId).toBeDefined();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'does not include relations',
    () =>
      withDefaultSelection(async ({ db }) => {
        const model = await db.public.Model.first();
        expect(model).not.toHaveProperty('relation');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'includes enums',
    () =>
      withDefaultSelection(async ({ db }) => {
        const model = await db.public.Model.first();
        expect(model?.enum).toBeDefined();
      }),
    timeouts.spinUpPpgDev,
  );
});

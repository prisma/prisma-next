import { describe, it } from 'vitest';
import type { Contract } from '../../_fixtures/decimal-list/generated/contract';
import contractJson from '../../_fixtures/decimal-list/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/decimal/list
// (postgres matrix entry only; mongodb/mysql/sqlite/sqlserver opted out — those
// connectors don't support Decimal and/or primitive lists).
//
// All three upstream tests call `prisma.user.create({ data: { decimals: [...] } })`
// with NO return-value assertions — they verify only that the create does not
// throw. The inputs match upstream exactly: `with decimal instances` and
// `with numbers` both pass the JS numbers `[12.3, 45.6]` (despite the name,
// upstream constructs no Decimal.js instances here); `create with strings`
// passes `['12.3', '45.6']`. prisma-next's Numeric codec accepts number and
// string inputs, so all three are faithful.

function withDecimalList(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/decimal-list', () => {
  it(
    'with decimal instances',
    () =>
      withDecimalList(async ({ db }) => {
        await db.public.User.create({
          decimals: [12.3, 45.6],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'with numbers',
    () =>
      withDecimalList(async ({ db }) => {
        await db.public.User.create({
          decimals: [12.3, 45.6],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'create with strings',
    () =>
      withDecimalList(async ({ db }) => {
        await db.public.User.create({
          decimals: ['12.3', '45.6'],
        });
      }),
    timeouts.spinUpPpgDev,
  );
});

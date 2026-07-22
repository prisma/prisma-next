import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/enum-array/generated/contract';
import contractJson from '../../_fixtures/enum-array/generated/contract.json' with { type: 'json' };
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/enum-array
// (postgres matrix entry; sqlserver/mysql/sqlite opted-out upstream).
//
// EMITTER GAP: text-backed enum list columns (`Plan[]` with `@@type("pg/text@1")`)
// emit a CHECK constraint using `IN ('FREE', 'PAID', 'CUSTOM')` which is
// invalid for Postgres array columns — Postgres reports
// "malformed array literal" (sqlState 22P02) during plan→apply.
// The faithful PSL translation must include the list field, so the contract
// push fails before any ORM operation runs. Tests marked it.fails.
// See ledger for confirmed emitter diagnostic.
//
// The third upstream test ("can retrieve data with an enum array with a raw
// query and a custom parser") uses a driver-adapter-specific raw query path
// with a custom OID parser — not expressible through the prisma-next ORM public
// API — non-ported (see ledger).

function withEnumArray(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/enum-array', () => {
  it.fails(
    'can create data with an enum array',
    () =>
      withEnumArray(async ({ db }) => {
        const user = await db.public.User.create({ plans: ['FREE'] });
        expect(user.id).toBeDefined();
        expect(user.plans).toEqual(['FREE']);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'can retrieve data with an enum array',
    () =>
      withEnumArray(async ({ db }) => {
        const created = await db.public.User.create({ plans: ['FREE'] });

        const found = await db.public.User.first({ id: created.id });

        expect(found).not.toBeNull();
        expect(found!.plans).toEqual(['FREE']);
      }),
    timeouts.spinUpPpgDev,
  );
});

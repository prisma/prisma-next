import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/enums/generated/contract';
import contractJson from '../../_fixtures/enums/generated/contract.json' with { type: 'json' };
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/enums
// (postgres matrix entry, sqlserver opted-out upstream).
//
// Upstream seeds a User with plan=CUSTOM and asserts the value round-trips.
// The "fails at runtime with invalid entry" tests are sqlite/mongo-only and
// are not in scope for this postgres port.

function withEnums(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/enums', () => {
  it(
    'can create data with an enum value',
    () =>
      withEnums(async ({ db }) => {
        const user = await db.public.User.create({ plan: 'CUSTOM' });
        expect(user.id).toBeDefined();
        expect(user.plan).toEqual('CUSTOM');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'can retrieve data with an enum value',
    () =>
      withEnums(async ({ db }) => {
        const created = await db.public.User.create({ plan: 'CUSTOM' });

        const found = await db.public.User.first({ id: created.id, plan: 'CUSTOM' });

        expect(found).not.toBeNull();
        expect(found!.plan).toEqual('CUSTOM');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'the enum type can be assigned its own values',
    () =>
      withEnums(async ({ db }) => {
        const user = await db.public.User.create({ plan: 'CUSTOM' });

        expect(user.plan).toEqual('CUSTOM');
        expect(user.plan).toEqual<'FREE' | 'PAID' | 'CUSTOM'>('CUSTOM');
      }),
    timeouts.spinUpPpgDev,
  );
});

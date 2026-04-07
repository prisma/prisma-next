import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { orm as sqlOrm } from '@prisma-next/sql-orm-client';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import { setupTestDatabase } from '@prisma-next/sql-runtime/test/utils';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { describeWithMongoDB } from '../mongo/setup';
import type { Contract as MongoVOContract } from './fixtures/generated/mongo-contract.d';
import mongoContractJson from './fixtures/generated/mongo-contract.json';
import type { Contract as SqlVOContract } from './fixtures/generated/sql-contract.d';
import sqlContractJson from './fixtures/generated/sql-contract.json';

describeWithMongoDB('value objects e2e: Mongo → real DB → typed ORM', (ctx) => {
  const { contract } = validateMongoContract<MongoVOContract>(mongoContractJson);

  it('create and read value objects with correct types', async () => {
    const ormClient = mongoOrm({ contract, executor: ctx.runtime });

    const created = await ormClient.shop.create({
      name: 'Corner Store',
      location: { street: '123 Main St', city: 'Springfield', zip: '62701' },
      notes: null,
    });

    expectTypeOf(created.location).toEqualTypeOf<{
      street: string;
      city: string;
      zip: string;
    }>();
    expectTypeOf(created.notes).toEqualTypeOf<{
      street: string;
      city: string;
      zip: string;
    } | null>();
    expectTypeOf(created.name).toEqualTypeOf<string>();

    expect(created).toMatchObject({
      name: 'Corner Store',
      location: { street: '123 Main St', city: 'Springfield', zip: '62701' },
      notes: null,
    });

    const allShops = await ormClient.shop.all();
    expect(allShops).toHaveLength(1);

    const shop = allShops[0]!;
    expectTypeOf(shop.location).toEqualTypeOf<{
      street: string;
      city: string;
      zip: string;
    }>();
    expectTypeOf(shop.notes).toEqualTypeOf<{
      street: string;
      city: string;
      zip: string;
    } | null>();

    expect(shop.location).toEqual({
      street: '123 Main St',
      city: 'Springfield',
      zip: '62701',
    });
    expect(shop.notes).toBeNull();
  });

  it('non-null value object field roundtrips through update', async () => {
    const ormClient = mongoOrm({ contract, executor: ctx.runtime });

    await ormClient.shop.create({
      name: 'Updated Store',
      location: { street: '1 First Ave', city: 'Oldtown', zip: '11111' },
      notes: { street: '2 Second Ave', city: 'Newtown', zip: '22222' },
    });

    const { MongoFieldFilter } = await import('@prisma-next/mongo-query-ast');
    const updated = await ormClient.shop
      .where(MongoFieldFilter.eq('name', 'Updated Store'))
      .update({
        location: { street: '99 New Blvd', city: 'Metropolis', zip: '99999' },
        notes: null,
      });

    expect(updated).not.toBeNull();
    expect(updated!.location).toEqual({
      street: '99 New Blvd',
      city: 'Metropolis',
      zip: '99999',
    });
    expect(updated!.notes).toBeNull();
  });
});

describe('value objects e2e: SQL → real Postgres → typed round-trip', () => {
  const sqlContract = validateContract<SqlVOContract>(
    sqlContractJson as Record<string, unknown>,
    emptyCodecLookup,
  );

  it(
    'JSONB value object round-trips through Postgres with correct types',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await setupTestDatabase(client, sqlContract, async (c) => {
            await c.query(`
              CREATE TABLE shop (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                location JSONB NOT NULL,
                notes JSONB
              )
            `);
          });

          const locationData = { street: '42 Oak Lane', city: 'Portland', zip: '97201' };
          await client.query(
            'INSERT INTO shop (name, location, notes) VALUES ($1, $2::jsonb, $3)',
            ['Green Cafe', JSON.stringify(locationData), null],
          );

          const stack = createSqlExecutionStack({
            target: postgresTarget,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensionPacks: [],
          });

          const stackInstance = instantiateExecutionStack(stack);
          const context = createExecutionContext({ contract: sqlContract, stack });

          const driver = stackInstance.driver;
          if (!driver) throw new Error('Driver missing');
          await driver.connect({ kind: 'pgClient', client });

          const runtime = createRuntime({
            stackInstance,
            context,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          try {
            const ormClient = sqlOrm({ runtime, context });

            const shops = await ormClient.Shop.all();
            expect(shops).toHaveLength(1);

            const shop = shops[0]!;

            expect(shop.name).toBe('Green Cafe');
            expect(shop.location).toEqual(locationData);
            expect(shop.notes).toBeNull();

            const created = await ormClient.Shop.create({
              id: 2,
              name: 'Blue Bar',
              location: { street: '7 Elm St', city: 'Seattle', zip: '98101' },
              notes: { street: '8 Pine St', city: 'Tacoma', zip: '98401' },
            });

            expect(created.location).toEqual({
              street: '7 Elm St',
              city: 'Seattle',
              zip: '98101',
            });
            expect(created.notes).toEqual({
              street: '8 Pine St',
              city: 'Tacoma',
              zip: '98401',
            });

            const allShops = await ormClient.Shop.all();
            expect(allShops).toHaveLength(2);
          } finally {
            await runtime.close();
          }
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});

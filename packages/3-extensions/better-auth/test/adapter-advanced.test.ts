/**
 * Behavioural coverage for the adapter's advanced surface over PGlite:
 *
 * - `consumeOne` is native on `Collection.delete()` — the atomic
 *   find-first + identity-narrowed `DELETE … RETURNING` — so concurrent
 *   consumers of one row get exactly one winner.
 * - `transaction` is real: a flow that throws after a write rolls the
 *   write back; a completing flow commits.
 * - `join` runs natively through `Collection.include()`: with
 *   `experimental.joins` enabled the factory receives rows already
 *   carrying the joined model (asserted via collection spies proving the
 *   joined model's collection is never queried separately), and a join
 *   the contract cannot express fails with a typed error.
 */
import postgres from '@prisma-next/postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import baselineOps from '../migrations/20260713T0717_create_auth_tables/ops.json' with {
  type: 'json',
};
import { resolveJoinRelations } from '../src/adapter/join';
import type { Contract } from '../src/contract/contract.d';
import contractJson from '../src/contract/contract.json' with { type: 'json' };
import type { AdapterCollection, BetterAuthDb } from '../src/exports/adapter';
import { PrismaNextAdapterError, prismaNextAdapter } from '../src/exports/adapter';

type Client = ReturnType<typeof postgres<Contract>>;
type DbAdapter = ReturnType<ReturnType<typeof prismaNextAdapter>>;

let database: Awaited<ReturnType<typeof createDevDatabase>>;
let client: Client;
let adapter: DbAdapter;
let joinAdapter: DbAdapter;
let collectionCalls: Record<string, number>;

function countingDb(base: Client): BetterAuthDb {
  const spy = (name: string, collection: AdapterCollection): AdapterCollection =>
    new Proxy(collection, {
      get(target, property) {
        if (typeof property === 'string' && property !== 'constructor') {
          collectionCalls[name] = (collectionCalls[name] ?? 0) + 1;
        }
        // Bind to the target (not the proxy receiver) so the Collection's
        // #-private members keep working through the spy.
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  return {
    orm: {
      public: {
        User: spy('User', base.orm.public.User),
        Session: spy('Session', base.orm.public.Session),
        Account: spy('Account', base.orm.public.Account),
        Verification: spy('Verification', base.orm.public.Verification),
      },
    },
    transaction: (fn) => base.transaction((tx) => fn(tx)),
  };
}

beforeAll(async () => {
  database = await createDevDatabase();
  await withClient(database.connectionString, async (pg) => {
    for (const op of baselineOps) {
      for (const step of op.execute) {
        await pg.query(step.sql, 'params' in step ? [...step.params] : []);
      }
    }
  });
  client = postgres<Contract>({
    contractJson,
    url: database.connectionString,
    verifyMarker: false,
  });
  collectionCalls = {};
  adapter = prismaNextAdapter(client)({});
  joinAdapter = prismaNextAdapter(countingDb(client))({ experimental: { joins: true } });
}, timeouts.spinUpPpgDev);

afterAll(async () => {
  await client?.close();
  await database?.close();
}, timeouts.spinUpPpgDev);

beforeEach(async () => {
  await withClient(database.connectionString, async (pg) => {
    await pg.query('DELETE FROM "public"."session"');
    await pg.query('DELETE FROM "public"."account"');
    await pg.query('DELETE FROM "public"."verification"');
    await pg.query('DELETE FROM "public"."user"');
  });
  collectionCalls = {};
});

const NOW = new Date('2026-07-06T09:00:00.000Z');

let seq = 0;
function newUser() {
  seq += 1;
  return {
    name: `User ${seq}`,
    email: `user${seq}@example.com`,
    emailVerified: false,
    image: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function newVerification(identifier: string) {
  return {
    identifier,
    value: `otp-${identifier}`,
    expiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface VerificationRow {
  id: string;
  identifier: string;
  value: string;
}

describe('consumeOne', () => {
  it('consumes the row exactly once; the second call gets null', async () => {
    await adapter.create({ model: 'verification', data: newVerification('once') });

    const first = await adapter.consumeOne<VerificationRow>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'once' }],
    });
    expect(first?.value).toBe('otp-once');

    const second = await adapter.consumeOne<VerificationRow>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'once' }],
    });
    expect(second).toBeNull();
  });

  it('parallel consumers of one row produce exactly one winner (repeated rounds)', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    for (let round = 0; round < 5; round += 1) {
      const identifier = `race-${round}`;
      await adapter.create({ model: 'verification', data: newVerification(identifier) });

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          adapter.consumeOne<VerificationRow>({
            model: 'verification',
            where: [{ field: 'identifier', value: identifier }],
          }),
        ),
      );

      const winners = results.filter((result) => result !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.value).toBe(`otp-${identifier}`);

      const remaining = await adapter.count({
        model: 'verification',
        where: [{ field: 'identifier', value: identifier }],
      });
      expect(remaining).toBe(0);
    }
  });

  it('does not consume rows matching other predicates', async () => {
    await adapter.create({ model: 'verification', data: newVerification('keep-a') });
    await adapter.create({ model: 'verification', data: newVerification('take-b') });

    const consumed = await adapter.consumeOne<VerificationRow>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'take-b' }],
    });
    expect(consumed?.identifier).toBe('take-b');
    expect(await adapter.count({ model: 'verification' })).toBe(1);
  });
});

describe('transaction', () => {
  it('rolls back all writes when the flow throws', async () => {
    await expect(
      adapter.transaction(async (trx) => {
        await trx.create({ model: 'user', data: newUser() });
        await trx.create({ model: 'user', data: newUser() });
        throw new Error('induced failure after two writes');
      }),
    ).rejects.toThrow('induced failure after two writes');

    expect(await adapter.count({ model: 'user' })).toBe(0);
  });

  it('commits all writes when the flow completes', async () => {
    const created = await adapter.transaction(async (trx) => {
      const user = await trx.create<{ id: string }>({ model: 'user', data: newUser() });
      await trx.create({
        model: 'account',
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: 'hash',
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
      return user;
    });

    expect(await adapter.count({ model: 'user' })).toBe(1);
    expect(
      await adapter.count({
        model: 'account',
        where: [{ field: 'userId', value: created.id }],
      }),
    ).toBe(1);
  });
});

describe('join', () => {
  async function seedSessionWithUser() {
    const user = await joinAdapter.create<{ id: string; email: string }>({
      model: 'user',
      data: newUser(),
    });
    await joinAdapter.create({
      model: 'session',
      data: {
        userId: user.id,
        token: `token-${user.id}`,
        expiresAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    return user;
  }

  it('findOne joins session.user natively through include()', async () => {
    const user = await seedSessionWithUser();
    collectionCalls = {};

    const row = await joinAdapter.findOne<{
      userId: string;
      user: { id: string; email: string } | null;
    }>({
      model: 'session',
      where: [{ field: 'token', value: `token-${user.id}` }],
      join: { user: true },
    });

    expect(row).not.toBeNull();
    expect(row?.user).not.toBeNull();
    expect(row?.user?.id).toBe(user.id);
    expect(row?.user?.email).toBe(user.email);
    // Native joining: the row arrives with the user attached; the User
    // collection is never queried separately (no fallback join).
    expect(collectionCalls['Session']).toBeGreaterThan(0);
    expect(collectionCalls['User'] ?? 0).toBe(0);
  });

  it('findMany joins session.user natively through include()', async () => {
    const user = await seedSessionWithUser();
    collectionCalls = {};

    const rows = await joinAdapter.findMany<{
      userId: string;
      user: { id: string } | null;
    }>({
      model: 'session',
      where: [{ field: 'userId', value: user.id }],
      limit: 10,
      join: { user: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.user?.id).toBe(user.id);
    expect(collectionCalls['User'] ?? 0).toBe(0);
  });

  it('reverse one-to-many joins run natively over the backrelation', async () => {
    const user = await seedSessionWithUser();
    collectionCalls = {};

    const row = await joinAdapter.findOne<{
      id: string;
      session: Array<{ userId: string }>;
    }>({
      model: 'user',
      where: [{ field: 'id', value: user.id }],
      join: { session: true },
    });

    expect(Array.isArray(row?.session)).toBe(true);
    expect(row?.session).toHaveLength(1);
    expect(row?.session[0]?.userId).toBe(user.id);
    expect(collectionCalls['Session'] ?? 0).toBe(0);
  });

  it('a join target without a contract relation fails with a typed error', () => {
    const error = (() => {
      try {
        resolveJoinRelations('user', 'User', {
          verification: { on: { from: 'id', to: 'identifier' }, relation: 'one-to-many' },
        });
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(PrismaNextAdapterError);
    expect((error as PrismaNextAdapterError).code).toBe('UNKNOWN_JOIN_RELATION');
    expect(String((error as Error).message)).toContain('user');
    expect(String((error as Error).message)).toContain('verification');
  });
});

/**
 * Behavioural coverage for `prismaNextAdapter` over a real PGlite database:
 * every BetterAuth operation reaches the database through the contract-typed
 * ORM collections of the better-auth space, so values round-trip through
 * contract codecs (Dates as `timestamptz`, booleans as `bool`) and the
 * where-operator set translates to typed filters.
 *
 * Setup executes the pack's shipped baseline DDL once (fixture setup — the
 * managed-lifecycle path itself is integration-tested separately) and hands
 * the adapter an ordinary prisma-next Postgres client — the same object an
 * app would pass.
 */
import postgres from '@prisma-next/postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import baselineOps from '../migrations/20260713T0717_create_auth_tables/ops.json' with {
  type: 'json',
};
import type { Contract } from '../src/contract/contract.d';
import contractJson from '../src/contract/contract.json' with { type: 'json' };
import { prismaNextAdapter } from '../src/exports/adapter';

type DbAdapter = ReturnType<ReturnType<typeof prismaNextAdapter>>;

let database: Awaited<ReturnType<typeof createDevDatabase>>;
let client: ReturnType<typeof postgres<Contract>>;
let adapter: DbAdapter;

async function createBaselineTables(connectionString: string): Promise<void> {
  await withClient(connectionString, async (pg) => {
    for (const op of baselineOps) {
      for (const step of op.execute) {
        await pg.query(step.sql, 'params' in step ? [...step.params] : []);
      }
    }
  });
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let seq = 0;
function userData(overrides: Partial<Omit<UserRow, 'id'>> = {}): Omit<UserRow, 'id'> {
  seq += 1;
  return {
    name: `User ${seq}`,
    email: `user${seq}@example.com`,
    emailVerified: false,
    image: null,
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    ...overrides,
  };
}

beforeAll(async () => {
  database = await createDevDatabase();
  await createBaselineTables(database.connectionString);
  client = postgres<Contract>({
    contractJson,
    url: database.connectionString,
    verifyMarker: false,
  });
  adapter = prismaNextAdapter(client)({});
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
});

describe('create + findOne', () => {
  it('round-trips Dates and booleans through contract codecs', async () => {
    const createdAt = new Date('2026-07-02T08:30:00.000Z');
    const created = await adapter.create<UserRow>({
      model: 'user',
      data: userData({ emailVerified: true, createdAt, updatedAt: createdAt }),
    });

    expect(typeof created.id).toBe('string');
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.emailVerified).toBe(true);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt.getTime()).toBe(createdAt.getTime());

    const found = await adapter.findOne<UserRow>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
    });
    expect(found).not.toBeNull();
    expect(found).toEqual(created);
    expect(found?.emailVerified).toBe(true);
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it('findOne returns null when nothing matches', async () => {
    const missing = await adapter.findOne<UserRow>({
      model: 'user',
      where: [{ field: 'email', value: 'nobody@example.com' }],
    });
    expect(missing).toBeNull();
  });

  it('create applies select projection', async () => {
    const created = await adapter.create<Partial<UserRow>>({
      model: 'user',
      data: userData(),
      select: ['id', 'email'],
    });
    expect(Object.keys(created).sort()).toEqual(['email', 'id']);
  });
});

describe('where-operator translation', () => {
  beforeEach(async () => {
    await adapter.create({
      model: 'user',
      data: userData({
        name: 'Alice Smith',
        email: 'alice@alpha.com',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    });
    await adapter.create({
      model: 'user',
      data: userData({
        name: 'Bob Jones',
        email: 'bob@beta.org',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
    });
    await adapter.create({
      model: 'user',
      data: userData({
        name: 'Carol Smith',
        email: 'carol@gamma.net',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
      }),
    });
  });

  async function names(where: Parameters<DbAdapter['findMany']>[0]['where']): Promise<string[]> {
    const rows = await adapter.findMany<UserRow>({
      model: 'user',
      where,
      limit: 10,
      sortBy: { field: 'name', direction: 'asc' },
    });
    return rows.map((row) => row.name);
  }

  it('ne excludes a value', async () => {
    expect(await names([{ field: 'email', operator: 'ne', value: 'bob@beta.org' }])).toEqual([
      'Alice Smith',
      'Carol Smith',
    ]);
  });

  it('lt / lte / gt / gte compare timestamptz values', async () => {
    const cutoff = new Date('2026-07-02T00:00:00.000Z');
    expect(await names([{ field: 'createdAt', operator: 'lt', value: cutoff }])).toEqual([
      'Alice Smith',
    ]);
    expect(await names([{ field: 'createdAt', operator: 'lte', value: cutoff }])).toEqual([
      'Alice Smith',
      'Bob Jones',
    ]);
    expect(await names([{ field: 'createdAt', operator: 'gt', value: cutoff }])).toEqual([
      'Carol Smith',
    ]);
    expect(await names([{ field: 'createdAt', operator: 'gte', value: cutoff }])).toEqual([
      'Bob Jones',
      'Carol Smith',
    ]);
  });

  it('in / not_in select by list membership', async () => {
    expect(
      await names([
        { field: 'email', operator: 'in', value: ['alice@alpha.com', 'carol@gamma.net'] },
      ]),
    ).toEqual(['Alice Smith', 'Carol Smith']);
    expect(
      await names([
        { field: 'email', operator: 'not_in', value: ['alice@alpha.com', 'carol@gamma.net'] },
      ]),
    ).toEqual(['Bob Jones']);
  });

  it('contains / starts_with / ends_with translate to escaped LIKE patterns', async () => {
    expect(await names([{ field: 'name', operator: 'contains', value: 'Smith' }])).toEqual([
      'Alice Smith',
      'Carol Smith',
    ]);
    expect(await names([{ field: 'email', operator: 'starts_with', value: 'bob@' }])).toEqual([
      'Bob Jones',
    ]);
    expect(await names([{ field: 'email', operator: 'ends_with', value: '.org' }])).toEqual([
      'Bob Jones',
    ]);
    // LIKE metacharacters in values match literally, not as wildcards.
    expect(await names([{ field: 'email', operator: 'contains', value: '%' }])).toEqual([]);
  });

  it('OR connector folds clauses like the reference adapters', async () => {
    expect(
      await names([
        { field: 'email', value: 'alice@alpha.com' },
        { field: 'email', value: 'bob@beta.org', connector: 'OR' },
      ]),
    ).toEqual(['Alice Smith', 'Bob Jones']);
  });

  it('AND is the default connector', async () => {
    expect(
      await names([
        { field: 'name', operator: 'contains', value: 'Smith' },
        { field: 'email', operator: 'starts_with', value: 'alice' },
      ]),
    ).toEqual(['Alice Smith']);
  });

  it('sortBy desc + limit + offset page through rows', async () => {
    const rows = await adapter.findMany<UserRow>({
      model: 'user',
      limit: 2,
      offset: 1,
      sortBy: { field: 'createdAt', direction: 'desc' },
    });
    expect(rows.map((row) => row.name)).toEqual(['Bob Jones', 'Alice Smith']);
  });
});

describe('update / updateMany / delete / deleteMany / count', () => {
  it('update returns the updated row; null when nothing matches', async () => {
    const created = await adapter.create<UserRow>({ model: 'user', data: userData() });

    const updated = await adapter.update<UserRow>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
      update: { name: 'Renamed' },
    });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.id).toBe(created.id);

    const missed = await adapter.update<UserRow>({
      model: 'user',
      where: [{ field: 'id', value: 'no-such-id' }],
      update: { name: 'Ghost' },
    });
    expect(missed).toBeNull();
  });

  it('updateMany returns the affected row count', async () => {
    await adapter.create({ model: 'user', data: userData({ email: 'a@multi.com' }) });
    await adapter.create({ model: 'user', data: userData({ email: 'b@multi.com' }) });
    await adapter.create({ model: 'user', data: userData({ email: 'c@other.com' }) });

    const affected = await adapter.updateMany({
      model: 'user',
      where: [{ field: 'email', operator: 'ends_with', value: '@multi.com' }],
      update: { emailVerified: true },
    });
    expect(affected).toBe(2);

    const verified = await adapter.count({
      model: 'user',
      where: [{ field: 'emailVerified', value: true }],
    });
    expect(verified).toBe(2);
  });

  it('delete removes the matching row', async () => {
    const created = await adapter.create<UserRow>({ model: 'user', data: userData() });
    await adapter.delete({ model: 'user', where: [{ field: 'id', value: created.id }] });
    const found = await adapter.findOne<UserRow>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
    });
    expect(found).toBeNull();
  });

  it('deleteMany returns the deleted row count', async () => {
    await adapter.create({ model: 'user', data: userData({ email: 'x@purge.com' }) });
    await adapter.create({ model: 'user', data: userData({ email: 'y@purge.com' }) });
    await adapter.create({ model: 'user', data: userData({ email: 'z@keep.com' }) });

    const deleted = await adapter.deleteMany({
      model: 'user',
      where: [{ field: 'email', operator: 'ends_with', value: '@purge.com' }],
    });
    expect(deleted).toBe(2);
    expect(await adapter.count({ model: 'user' })).toBe(1);
  });

  it('count with and without where', async () => {
    await adapter.create({ model: 'user', data: userData({ emailVerified: true }) });
    await adapter.create({ model: 'user', data: userData() });
    expect(await adapter.count({ model: 'user' })).toBe(2);
    expect(
      await adapter.count({ model: 'user', where: [{ field: 'emailVerified', value: true }] }),
    ).toBe(1);
  });
});

describe('all four collections are reachable', () => {
  it('creates and reads back session, account, and verification rows', async () => {
    const user = await adapter.create<UserRow>({ model: 'user', data: userData() });
    const now = new Date('2026-07-05T12:00:00.000Z');

    const session = await adapter.create<Record<string, unknown>>({
      model: 'session',
      data: {
        userId: user.id,
        token: 'session-token-1',
        expiresAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(session['userId']).toBe(user.id);

    const account = await adapter.create<Record<string, unknown>>({
      model: 'account',
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: 'hashed-password',
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(account['providerId']).toBe('credential');
    expect(account['accessToken']).toBeNull();

    const verification = await adapter.create<Record<string, unknown>>({
      model: 'verification',
      data: {
        identifier: 'sign-up:x@example.com',
        value: 'otp-123456',
        expiresAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(verification['value']).toBe('otp-123456');

    const foundSession = await adapter.findOne<Record<string, unknown>>({
      model: 'session',
      where: [{ field: 'token', value: 'session-token-1' }],
    });
    expect(foundSession?.['userId']).toBe(user.id);
  });
});

describe('empty-where no-op contract (BetterAuth ≥1.6.17)', () => {
  it('update with empty where returns null and modifies nothing', async () => {
    const created = await adapter.create<UserRow>({ model: 'user', data: userData() });

    const result = await adapter.update<UserRow>({
      model: 'user',
      where: [],
      update: { name: 'Clobbered' },
    });
    expect(result).toBeNull();

    const untouched = await adapter.findOne<UserRow>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
    });
    expect(untouched?.name).toBe(created.name);
  });

  it('delete with empty where deletes nothing', async () => {
    await adapter.create<UserRow>({ model: 'user', data: userData() });
    await adapter.create<UserRow>({ model: 'user', data: userData() });

    await adapter.delete({ model: 'user', where: [] });

    expect(await adapter.count({ model: 'user' })).toBe(2);
  });

  it('consumeOne with empty where consumes nothing and returns null', async () => {
    await adapter.create<UserRow>({ model: 'user', data: userData() });

    const consumed = await adapter.consumeOne<UserRow>({ model: 'user', where: [] });
    expect(consumed).toBeNull();

    expect(await adapter.count({ model: 'user' })).toBe(1);
  });
});

/**
 * Typed error surface of the adapter: unknown models, unknown fields,
 * unsupported operators, and unsupported where modes fail fast with a
 * `PrismaNextAdapterError` naming the offending surface — nothing
 * stringly-typed leaks toward SQL. The db handle is a stub because every
 * assertion here must reject before any collection method executes.
 *
 * `createAdapterFactory` validates model/field names against the
 * BetterAuth schema *derived from the auth options* before the adapter
 * runs, so surfaces the core schema doesn't know are rejected upstream.
 * The adapter's own typed errors are the second line: they fire exactly
 * when the factory admits a surface (plugin tables, `additionalFields`)
 * that the better-auth contract space does not define — the property
 * these tests pin.
 */
import { describe, expect, it } from 'vitest';
import type { AdapterCollection, BetterAuthDb } from '../src/exports/adapter';
import { PrismaNextAdapterError, prismaNextAdapter } from '../src/exports/adapter';

function rejectingCollection(): AdapterCollection {
  const fail = () => {
    throw new Error('collection must not be reached for invalid surfaces');
  };
  const collection: AdapterCollection = {
    where(fn) {
      // The accessor is only indexed after contract validation; expose
      // comparator-less fields so operator-support failures surface as
      // typed errors rather than TypeErrors.
      fn(
        new Proxy(
          {},
          {
            get: () => ({}),
          },
        ),
      );
      return collection;
    },
    orderBy: fail,
    include: fail,
    take: fail,
    skip: fail,
    all: fail,
    first: fail,
    aggregate: fail,
    create: fail,
    update: fail,
    updateCount: fail,
    delete: fail,
    deleteCount: fail,
  };
  return collection;
}

const stubDb: BetterAuthDb = {
  orm: {
    public: {
      User: rejectingCollection(),
      Session: rejectingCollection(),
      Account: rejectingCollection(),
      Verification: rejectingCollection(),
    },
  },
  transaction() {
    throw new Error('transaction must not be reached for invalid surfaces');
  },
};

const adapter = prismaNextAdapter(stubDb)({});

// Options that make the factory schema admit surfaces the contract space
// does not define: a plugin table (`twoFactor`) and additional fields on
// user/session. The factory then forwards them — and the adapter's typed
// errors take over.
const extendedAdapter = prismaNextAdapter(stubDb)({
  user: { additionalFields: { role: { type: 'string' } } },
  session: { additionalFields: { user: { type: 'string' } } },
  plugins: [
    {
      id: 'test-two-factor',
      schema: {
        twoFactor: {
          fields: {
            secret: { type: 'string' },
          },
        },
      },
    },
  ],
});

function expectAdapterError(
  error: unknown,
  expected: { code: string; model?: string; field?: string; operator?: string },
): void {
  expect(error).toBeInstanceOf(PrismaNextAdapterError);
  const adapterError = error as PrismaNextAdapterError;
  expect({
    code: adapterError.code,
    model: adapterError.model,
    field: adapterError.field,
    operator: adapterError.operator,
  }).toMatchObject(expected);
}

describe('unknown model', () => {
  it('rejects a factory-admitted plugin table with a typed error naming the model', async () => {
    const error = await extendedAdapter
      .count({ model: 'twoFactor' })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expectAdapterError(error, { code: 'UNKNOWN_MODEL', model: 'twoFactor' });
    expect(String((error as Error).message)).toContain('twoFactor');
    expect(String((error as Error).message)).toContain('user, session, account, verification');
  });

  it('models outside the factory schema are rejected upstream by better-auth itself', async () => {
    const error = await adapter
      .count({ model: 'unknownTable' })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toContain('unknownTable');
  });
});

describe('unknown field', () => {
  it('rejects a factory-admitted additionalField in where with a typed error', async () => {
    const error = await extendedAdapter
      .findOne({ model: 'user', where: [{ field: 'role', value: 'admin' }] })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expectAdapterError(error, { code: 'UNKNOWN_FIELD', model: 'user', field: 'role' });
  });

  it('rejects factory-admitted additionalFields in create data with a typed error', async () => {
    const error = await extendedAdapter
      .create({ model: 'user', data: { email: 'x@example.com', role: 'admin' } })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expectAdapterError(error, { code: 'UNKNOWN_FIELD', model: 'user', field: 'role' });
  });

  it('rejects a relation name used as a where field with a typed error', async () => {
    const error = await extendedAdapter
      .findOne({ model: 'session', where: [{ field: 'user', value: 'u1' }] })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expectAdapterError(error, { code: 'UNKNOWN_FIELD', model: 'session', field: 'user' });
  });
});

describe('unsupported operators and modes', () => {
  it('rejects an operator the field codec does not support', async () => {
    const error = await adapter
      .findOne({
        model: 'user',
        where: [{ field: 'emailVerified', operator: 'contains', value: 'tr' }],
      })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expectAdapterError(error, {
      code: 'UNSUPPORTED_OPERATOR',
      model: 'user',
      field: 'emailVerified',
      operator: 'contains',
    });
  });

  it('rejects case-insensitive mode with a typed error', async () => {
    const error = await adapter
      .findOne({
        model: 'user',
        where: [{ field: 'email', operator: 'contains', value: 'ALICE', mode: 'insensitive' }],
      })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expectAdapterError(error, {
      code: 'UNSUPPORTED_WHERE_MODE',
      model: 'user',
      field: 'email',
      operator: 'contains',
    });
  });

  it('list operators with non-array values are rejected upstream by better-auth itself', async () => {
    const error = await adapter
      .findMany({
        model: 'user',
        where: [{ field: 'email', operator: 'in', value: 'not-a-list' }],
        limit: 1,
      })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toContain('array');
  });
});

import type { TableSource } from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import type { Contract } from '../fixtures/generated/contract';

const int4 = { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false } as const;
const text = { codecId: 'pg/text@1', nativeType: 'text', nullable: false } as const;

function table(columns: Record<string, typeof int4 | typeof text>) {
  return {
    columns,
    foreignKeys: [],
    indexes: [],
    primaryKey: { columns: ['id'] },
    uniques: [],
  };
}

// Same bare table name (`users`) declared in two namespaces, plus a table
// that exists in only one namespace, so resolution must discriminate by
// namespace coordinate rather than fall back to a cross-namespace scan.
const twoNamespaceContract = {
  capabilities: {},
  target: 'postgres',
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        entries: { table: { users: table({ id: int4, email: text }), posts: table({ id: int4 }) } },
      },
      auth: {
        entries: {
          table: { users: table({ id: int4, token: text }), sessions: table({ id: int4 }) },
        },
      },
    },
  },
};

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  types: {},
  applyMutationDefaults: () => [],
};

const stubInferer = { inferCodec: () => 'pg/text@1' };

type TableHandle = { buildAst(): TableSource };
// The builder surface is namespace-facets only; flat by-bare-name keys are
// gone. They are modelled here as `undefined` to assert their runtime absence.
type TwoNamespaceDb = {
  public: { users: TableHandle; sessions: undefined };
  auth: { users: TableHandle; sessions: TableHandle };
  users: undefined;
  posts: undefined;
};

function db() {
  return sql({
    context: {
      ...stubBase,
      contract: twoNamespaceContract,
    } as unknown as ExecutionContext<Contract>,
    rawCodecInferer: stubInferer,
  }) as unknown as TwoNamespaceDb;
}

describe('namespaced table resolution', () => {
  it('resolves the same bare name to the distinct table in each namespace', () => {
    expect(db().public.users.buildAst().namespaceId).toBe('public');
    expect(db().auth.users.buildAst().namespaceId).toBe('auth');
  });

  it('scopes table lookup to the named namespace rather than scanning across namespaces', () => {
    // `sessions` exists only in `auth`; a cross-namespace scan would wrongly
    // resolve it under `public`.
    expect(db().public.sessions).toBeUndefined();
    expect(db().auth.sessions.buildAst().namespaceId).toBe('auth');
  });

  it('no longer exposes a flat by-bare-name surface — flat access yields undefined', () => {
    // The flat fallback branch was removed: a bare table name is not a namespace
    // key, so the proxy resolves to `undefined` (rather than resolving a unique
    // name or throwing on a shared one). This holds whether the bare name is
    // unique to one namespace (`posts`) or shared across namespaces (`users`).
    // Tables are reached only through their namespace facet.
    expect(db().posts).toBeUndefined();
    expect(db().users).toBeUndefined();
  });
});

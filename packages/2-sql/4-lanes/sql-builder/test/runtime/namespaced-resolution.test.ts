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
// gone. They are modelled here as `undefined` because they are not part of the
// typed surface; at runtime accessing them fails fast (see the FR11 tests).
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

  it('scopes table lookup to the named namespace and fails fast on a foreign table (FR11)', () => {
    // `sessions` exists only in `auth`; rather than silently resolve it under
    // `public` (a cross-namespace scan) or return undefined, the facet fails
    // fast naming the namespace.
    expect(() => db().public.sessions).toThrow(/No table 'sessions' in namespace 'public'/);
    expect(db().auth.sessions.buildAst().namespaceId).toBe('auth');
  });

  it('fails fast naming the unknown namespace on flat bare-name access (FR11)', () => {
    // The flat fallback branch was removed: a bare table name is not a namespace
    // key, so flat access is an unknown-namespace access. It fails fast naming
    // the bare name (whether unique to one namespace — `posts` — or shared
    // across namespaces — `users`) rather than returning undefined. Tables are
    // reached only through their namespace facet.
    expect(() => db().posts).toThrow(/Unknown namespace 'posts'/);
    expect(() => db().users).toThrow(/Unknown namespace 'users'/);
  });
});

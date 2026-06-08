import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, type TestContract } from './helpers';

function model(table: string) {
  return {
    fields: { id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } } },
    relations: {},
    storage: { table, fields: { id: { column: 'id' } } },
  };
}

function storageTable() {
  return {
    columns: { id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// Two namespaces that declare the same bare model name (`User`) backed by
// different tables, plus a model unique to each namespace, so resolution must
// discriminate by namespace coordinate rather than fall back to the flat scan.
const twoNamespaceContract = {
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: {},
  domain: {
    namespaces: {
      public: { models: { User: model('users'), Post: model('posts') } },
      auth: { models: { User: model('auth_users'), Session: model('sessions') } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        entries: { table: { users: storageTable(), posts: storageTable() } },
      },
      auth: {
        id: 'auth',
        entries: { table: { auth_users: storageTable(), sessions: storageTable() } },
      },
    },
  },
};

type Accessor = { readonly modelName: string; readonly tableName: string };
type TwoNamespaceOrm = {
  public: { User: Accessor; Post: Accessor; Session: undefined };
  auth: { User: Accessor; Session: Accessor };
  User: Accessor;
};

function db() {
  return orm({
    runtime: createMockRuntime(),
    context: {
      contract: twoNamespaceContract,
    } as unknown as ExecutionContext<TestContract>,
  }) as unknown as TwoNamespaceOrm;
}

describe('namespaced orm accessor', () => {
  it('resolves the same bare model name to the distinct table in each namespace', () => {
    expect(db().public.User.tableName).toBe('users');
    expect(db().public.User.modelName).toBe('User');
    expect(db().auth.User.tableName).toBe('auth_users');
    expect(db().auth.User.modelName).toBe('User');
  });

  it('scopes model lookup to the named namespace rather than the flat model set', () => {
    // `Session` exists only in `auth`; the flat set contains it, so an
    // unscoped facet would wrongly resolve `auth.Session` under `public`.
    expect(() => db().public.Session).toThrow();
    expect(db().auth.Session.tableName).toBe('sessions');
  });

  it('throws on flat bare-name access against a multi-namespace contract (bare=default deferred)', () => {
    // With a required, leading namespace the flat surface resolves the sole
    // domain namespace; a multi-namespace contract has no sole namespace, so
    // bare access throws until bare=default lands. Namespace-qualified access
    // (db().public.User) remains the supported path.
    expect(() => db().User).toThrow(/exactly one domain namespace/);
  });
});

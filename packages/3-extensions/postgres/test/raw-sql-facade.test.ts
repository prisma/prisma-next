import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import { createAggregateFunctions, createFunctions, sql } from '@prisma-next/sql-builder/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type ParamRef, RawExpr } from '@prisma-next/sql-relational-core/ast';
import type { RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql, param } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instantiateExecutionStack: vi.fn(),
  createRuntime: vi.fn(),
  createExecutionContext: vi.fn(),
  createSqlExecutionStack: vi.fn(),
  withTransaction: vi.fn(),
  driverCreate: vi.fn(),
  driverConnect: vi.fn(),
  deserializeContract: vi.fn(),
  poolCtor: vi.fn(),
}));

vi.mock('@prisma-next/framework-components/execution', () => ({
  instantiateExecutionStack: mocks.instantiateExecutionStack,
}));

vi.mock('@prisma-next/sql-runtime', () => ({
  createExecutionContext: mocks.createExecutionContext,
  createSqlExecutionStack: mocks.createSqlExecutionStack,
  createRuntime: mocks.createRuntime,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@prisma-next/sql-orm-client', () => ({
  orm: vi.fn(() => ({ lane: 'orm' })),
}));

vi.mock('@prisma-next/target-postgres/runtime', () => ({
  default: { id: 'target-postgres' },
  PostgresContractSerializer: class {
    deserializeContract(value: unknown) {
      return mocks.deserializeContract(value);
    }
  },
}));

vi.mock('@prisma-next/adapter-postgres/runtime', () => ({
  default: { id: 'adapter-postgres' },
}));

vi.mock('@prisma-next/driver-postgres/runtime', () => ({
  default: { id: 'driver-postgres' },
}));

vi.mock('pg', () => {
  class Pool {
    constructor(options: unknown) {
      mocks.poolCtor(options);
    }
  }
  class Client {}
  return { Pool, Client };
});

import postgres from '../src/runtime/postgres';

const contract = createContract<SqlStorage>();

function setupMocks() {
  mocks.createExecutionContext.mockReturnValue({
    contract,
    codecs: {},
    queryOperations: { entries: () => ({}) },
    types: {},
    applyMutationDefaults: () => [],
  });
  mocks.createSqlExecutionStack.mockReturnValue({
    target: { id: 'target-postgres' },
    adapter: { id: 'adapter-postgres' },
    driver: { create: mocks.driverCreate },
    extensionPacks: [],
  });
  mocks.instantiateExecutionStack.mockReturnValue({ adapter: {} });
  mocks.driverConnect.mockResolvedValue(undefined);
  mocks.driverCreate.mockReturnValue({ id: 'driver-instance', connect: mocks.driverConnect });
  mocks.createRuntime.mockReturnValue({ id: 'runtime-instance' });
  mocks.deserializeContract.mockReturnValue(contract);
}

describe('postgres client rawSql surface', () => {
  beforeEach(setupMocks);

  it('exposes rawSql as a function on the client', () => {
    const db = postgres({ contract });
    expect(typeof db.rawSql).toBe('function');
  });

  it('rawSql is bound once — distinct clients get distinct tags', () => {
    const db1 = postgres({ contract });
    const db2 = postgres({ contract });
    expect(db1.rawSql).not.toBe(db2.rawSql);
  });

  it('rawSql is stable across repeated accesses on the same client', () => {
    const db = postgres({ contract });
    expect(db.rawSql).toBe(db.rawSql);
  });
});

function rawSqlOf(
  fns: ReturnType<typeof createFunctions> | ReturnType<typeof createAggregateFunctions>,
): unknown {
  return (fns as unknown as { readonly rawSql: unknown }).rawSql;
}

describe('fns.rawSql reference equality with bound RawSqlTag', () => {
  it('createFunctions returns the same rawSqlTag reference for the rawSql key', () => {
    const tag: RawSqlTag = createRawSql(createPostgresAdapter());
    const fns = createFunctions({}, tag);
    expect(rawSqlOf(fns)).toBe(tag);
  });

  it('createAggregateFunctions returns the same rawSqlTag reference for the rawSql key', () => {
    const tag: RawSqlTag = createRawSql(createPostgresAdapter());
    const fns = createAggregateFunctions({}, tag);
    expect(rawSqlOf(fns)).toBe(tag);
  });

  it('separate fns Proxy instances from same tag all return the same tag reference', () => {
    const tag: RawSqlTag = createRawSql(createPostgresAdapter());
    const whereTag = rawSqlOf(createFunctions({}, tag));
    const selectTag = rawSqlOf(createAggregateFunctions({}, tag));
    const groupByTag = rawSqlOf(createFunctions({}, tag));
    const orderByTag = rawSqlOf(createFunctions({}, tag));
    const havingTag = rawSqlOf(createAggregateFunctions({}, tag));
    const joinOnTag = rawSqlOf(createFunctions({}, tag));

    expect(whereTag).toBe(tag);
    expect(selectTag).toBe(tag);
    expect(groupByTag).toBe(tag);
    expect(orderByTag).toBe(tag);
    expect(havingTag).toBe(tag);
    expect(joinOnTag).toBe(tag);
  });

  it('fns.rawSql from different dispatch sites all reference-equal the same tag', () => {
    const tag: RawSqlTag = createRawSql(createPostgresAdapter());
    const whereTag = rawSqlOf(createFunctions({}, tag));
    const selectAliasedTag = rawSqlOf(createAggregateFunctions({}, tag));
    const selectBulkTag = rawSqlOf(createAggregateFunctions({}, tag));
    const groupByCallbackTag = rawSqlOf(createFunctions({}, tag));
    const orderByCallbackTag = rawSqlOf(createFunctions({}, tag));
    const havingCallbackTag = rawSqlOf(createAggregateFunctions({}, tag));
    const joinOnCallbackTag = rawSqlOf(createFunctions({}, tag));

    expect(whereTag).toBe(selectAliasedTag);
    expect(whereTag).toBe(selectBulkTag);
    expect(whereTag).toBe(groupByCallbackTag);
    expect(whereTag).toBe(orderByCallbackTag);
    expect(whereTag).toBe(havingCallbackTag);
    expect(whereTag).toBe(joinOnCallbackTag);
  });

  it('fns.rawSql is undefined when no tag is provided (graceful degradation)', () => {
    const fns = createFunctions({});
    expect(rawSqlOf(fns)).toBeUndefined();
  });
});

describe('param() override beats adapter inferCodec through rawSql tag', () => {
  it('bare number interpolation uses adapter inferCodec (pg/int4 for safe integer)', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`SELECT ${42}`.returns('pg/int4');
    const ast = expr.buildAst();
    expect(ast).toBeInstanceOf(RawExpr);
    const rawExpr = ast as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string');
    expect(paramPart).toBeDefined();
    expect((paramPart as ParamRef).codec?.codecId).toBe('pg/int4');
  });

  it('param() with explicit codecId overrides adapter inferCodec default', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const overridden = param(42, { codecId: 'pg/int8' });
    const expr = tag`SELECT ${overridden}`.returns('pg/int8');
    const ast = expr.buildAst();
    expect(ast).toBeInstanceOf(RawExpr);
    const rawExpr = ast as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string');
    expect(paramPart).toBeDefined();
    expect((paramPart as ParamRef).codec?.codecId).toBe('pg/int8');
  });
});

type FnsSpy = { rawSql: unknown; eq: (a: unknown, b: unknown) => unknown };
type ColProxy = Record<string, unknown>;
type WherableBuilder = {
  where: (cb: (f: ColProxy, fns: FnsSpy) => unknown) => { buildAst(): unknown };
};
type SelectableBuilder = {
  select(col: string): WherableBuilder;
  select(alias: string, cb: (f: ColProxy, fns: FnsSpy) => unknown): { buildAst(): unknown };
};
type DbWithUsers = { users: SelectableBuilder };

function makeBuilderContext(rawSqlTag: RawSqlTag): DbWithUsers {
  const stubContext = {
    contract: {
      capabilities: {},
      target: 'postgres',
      storage: {
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            tables: {
              users: {
                columns: {
                  id: { codecId: 'pg/int4@1', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
        storageHash: 'sha256:test',
      },
    },
    queryOperations: { entries: () => ({}) },
    applyMutationDefaults: () => [],
  } as unknown as ExecutionContext<Contract<SqlStorage>>;
  return sql({ context: stubContext, rawSqlTag }) as unknown as DbWithUsers;
}

describe('fns.rawSql reference equality through the typed builder chain', () => {
  it('fns.rawSql in .where callback is referentially equal to the bound tag', () => {
    const tag = createRawSql(createPostgresAdapter());
    const d = makeBuilderContext(tag);
    const captured: unknown[] = [];
    d.users
      .select('id')
      .where((_f, fns) => {
        captured.push(fns.rawSql);
        return fns.eq(_f['id'], _f['id']);
      })
      .buildAst();
    expect(captured[0]).toBe(tag);
  });

  it('fns.rawSql in .select aliased callback (AggregateFunctions) is referentially equal to the bound tag', () => {
    const tag = createRawSql(createPostgresAdapter());
    const d = makeBuilderContext(tag);
    const captured: unknown[] = [];
    d.users
      .select('uid', (_f, fns) => {
        captured.push(fns.rawSql);
        return _f['id'];
      })
      .buildAst();
    expect(captured[0]).toBe(tag);
  });
});

import { createSqliteAdapter } from '@prisma-next/adapter-sqlite/adapter';
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
  driverCreate: vi.fn(),
  driverConnect: vi.fn(),
  driverClose: vi.fn(),
  deserializeContract: vi.fn(),
}));

vi.mock('@prisma-next/framework-components/execution', () => ({
  instantiateExecutionStack: mocks.instantiateExecutionStack,
}));

vi.mock('@prisma-next/sql-runtime', () => ({
  createExecutionContext: mocks.createExecutionContext,
  createSqlExecutionStack: mocks.createSqlExecutionStack,
  createRuntime: mocks.createRuntime,
}));

vi.mock('@prisma-next/sql-orm-client', () => ({
  orm: vi.fn(() => ({ lane: 'orm' })),
}));

vi.mock('@prisma-next/family-sql/ir', () => ({
  SqlContractSerializer: class {
    deserializeContract(value: unknown) {
      return mocks.deserializeContract(value);
    }
  },
}));

vi.mock('@prisma-next/adapter-sqlite/runtime', () => ({
  default: { id: 'adapter-sqlite' },
}));

vi.mock('@prisma-next/driver-sqlite/runtime', () => ({
  default: { id: 'driver-sqlite' },
}));

vi.mock('@prisma-next/target-sqlite/runtime', () => ({
  default: { id: 'target-sqlite' },
}));

import sqlite from '../src/runtime/sqlite';

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
    target: { id: 'target-sqlite' },
    adapter: { id: 'adapter-sqlite' },
    driver: { create: mocks.driverCreate },
    extensionPacks: [],
  });
  mocks.instantiateExecutionStack.mockReturnValue({ adapter: {} });
  mocks.driverConnect.mockResolvedValue(undefined);
  mocks.driverClose.mockResolvedValue(undefined);
  mocks.driverCreate.mockReturnValue({
    id: 'driver-instance',
    connect: mocks.driverConnect,
    close: mocks.driverClose,
  });
  mocks.createRuntime.mockReturnValue({ id: 'runtime-instance' });
  mocks.deserializeContract.mockReturnValue(contract);
}

describe('sqlite client rawSql surface', () => {
  beforeEach(setupMocks);

  it('exposes rawSql as a function on the client', () => {
    const db = sqlite({ contract });
    expect(typeof db.rawSql).toBe('function');
  });

  it('rawSql is bound once — distinct clients get distinct tags', () => {
    const db1 = sqlite({ contract });
    const db2 = sqlite({ contract });
    expect(db1.rawSql).not.toBe(db2.rawSql);
  });

  it('rawSql is stable across repeated accesses on the same client', () => {
    const db = sqlite({ contract });
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
    const tag: RawSqlTag = createRawSql(createSqliteAdapter());
    const fns = createFunctions({}, tag);
    expect(rawSqlOf(fns)).toBe(tag);
  });

  it('createAggregateFunctions returns the same rawSqlTag reference for the rawSql key', () => {
    const tag: RawSqlTag = createRawSql(createSqliteAdapter());
    const fns = createAggregateFunctions({}, tag);
    expect(rawSqlOf(fns)).toBe(tag);
  });

  it('separate fns Proxy instances from same tag all return the same tag reference', () => {
    const tag: RawSqlTag = createRawSql(createSqliteAdapter());
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
    const tag: RawSqlTag = createRawSql(createSqliteAdapter());
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
  it('bare number interpolation uses adapter inferCodec (sqlite/integer@1 for safe integer)', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`SELECT ${42}`.returns('sqlite/integer@1');
    const ast = expr.buildAst();
    expect(ast).toBeInstanceOf(RawExpr);
    const rawExpr = ast as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string');
    expect(paramPart).toBeDefined();
    expect((paramPart as ParamRef).codec?.codecId).toBe('sqlite/integer@1');
  });

  it('param() with explicit codecId overrides adapter inferCodec default', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const overridden = param(42, { codecId: 'sqlite/real@1' });
    const expr = tag`SELECT ${overridden}`.returns('sqlite/real@1');
    const ast = expr.buildAst();
    expect(ast).toBeInstanceOf(RawExpr);
    const rawExpr = ast as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string');
    expect(paramPart).toBeDefined();
    expect((paramPart as ParamRef).codec?.codecId).toBe('sqlite/real@1');
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
      target: 'sqlite',
      storage: {
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            tables: {
              users: {
                columns: {
                  id: { codecId: 'sqlite/integer@1', nullable: false },
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
    // stub context for builder-chain reference-equality test; no real ExecutionContext fixture exists in this package
  } as unknown as ExecutionContext<Contract<SqlStorage>>;
  return sql({ context: stubContext, rawSqlTag }) as unknown as DbWithUsers;
}

describe('fns.rawSql reference equality through the typed builder chain', () => {
  it('fns.rawSql in .where callback is referentially equal to the bound tag', () => {
    const tag = createRawSql(createSqliteAdapter());
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
    const tag = createRawSql(createSqliteAdapter());
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

describe('bare literal interpolation resolves codec via adapter inferCodec', () => {
  it('bare number interpolation resolves to sqlite/integer@1 via inferCodec (safe integer)', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${42})`.returns('sqlite/integer@1');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('sqlite/integer@1');
  });

  it('bare fractional number interpolation resolves to sqlite/real@1 via inferCodec', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${1.5})`.returns('sqlite/real@1');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('sqlite/real@1');
  });

  it('bare bigint interpolation resolves to sqlite/bigint@1 via inferCodec', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${9n ** 18n})`.returns('sqlite/bigint@1');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('sqlite/bigint@1');
  });

  it('bare string interpolation resolves to sqlite/text@1 via inferCodec', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${'hello'})`.returns('sqlite/text@1');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('sqlite/text@1');
  });

  it('bare boolean interpolation resolves to sqlite/integer@1 via inferCodec', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${true})`.returns('sqlite/integer@1');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('sqlite/integer@1');
  });

  it('bare Uint8Array interpolation resolves to sqlite/blob@1 via inferCodec', () => {
    const adapter = createSqliteAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${new Uint8Array([1, 2, 3])})`.returns('sqlite/blob@1');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('sqlite/blob@1');
  });
});

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createContract } from '@prisma-next/contract/testing';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type ParamRef, RawExpr } from '@prisma-next/sql-relational-core/ast';
import { createRawSql, param } from '@prisma-next/sql-relational-core/expression';
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
    expect(typeof db.raw).toBe('function');
  });

  it('rawSql is bound once — distinct clients get distinct tags', () => {
    const db1 = postgres({ contract });
    const db2 = postgres({ contract });
    expect(db1.raw).not.toBe(db2.raw);
  });

  it('rawSql is stable across repeated accesses on the same client', () => {
    const db = postgres({ contract });
    expect(db.raw).toBe(db.raw);
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

describe('bare literal interpolation resolves codec via adapter inferCodec', () => {
  it('bare number interpolation resolves to pg/int4 via inferCodec (safe integer)', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${42})`.returns('pg/int4');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('pg/int4');
  });

  it('bare fractional number interpolation resolves to pg/float8 via inferCodec', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${3.14})`.returns('pg/float8');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('pg/float8');
  });

  it('bare string interpolation resolves to pg/text via inferCodec', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${'hello'})`.returns('pg/text');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('pg/text');
  });

  it('bare bigint interpolation resolves to pg/int8 via inferCodec', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${9n ** 18n})`.returns('pg/int8');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('pg/int8');
  });

  it('bare boolean interpolation resolves to pg/bool via inferCodec', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${true})`.returns('pg/bool');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('pg/bool');
  });

  it('bare Uint8Array interpolation resolves to pg/bytea via inferCodec', () => {
    const adapter = createPostgresAdapter();
    const tag = createRawSql(adapter);
    const expr = tag`f(${new Uint8Array([1, 2, 3])})`.returns('pg/bytea');
    const rawExpr = expr.buildAst() as RawExpr;
    const paramPart = rawExpr.parts.find((p) => typeof p !== 'string') as ParamRef | undefined;
    expect(paramPart?.codec?.codecId).toBe('pg/bytea');
  });
});

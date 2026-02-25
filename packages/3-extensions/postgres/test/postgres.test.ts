import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instantiateExecutionStack: vi.fn(),
  createRuntime: vi.fn(),
  createExecutionContext: vi.fn(),
  createSqlExecutionStack: vi.fn(),
  driverCreate: vi.fn(),
  validateContract: vi.fn(),
  poolCtor: vi.fn(),
  dialectCtor: vi.fn(),
  kyselyCtor: vi.fn(),
}));

vi.mock('@prisma-next/core-execution-plane/stack', () => ({
  instantiateExecutionStack: mocks.instantiateExecutionStack,
}));

vi.mock('@prisma-next/sql-runtime', () => ({
  createExecutionContext: mocks.createExecutionContext,
  createSqlExecutionStack: mocks.createSqlExecutionStack,
  createRuntime: mocks.createRuntime,
}));

vi.mock('@prisma-next/sql-contract/validate', () => ({
  validateContract: mocks.validateContract,
}));

vi.mock('@prisma-next/sql-lane', () => ({
  sql: vi.fn(() => ({ lane: 'sql' })),
}));

vi.mock('@prisma-next/sql-orm-client', () => ({
  orm: vi.fn(() => ({ lane: 'orm' })),
}));

vi.mock('@prisma-next/sql-relational-core/schema', () => ({
  schema: vi.fn(() => ({ tables: { user: { columns: {} } } })),
}));

vi.mock('@prisma-next/target-postgres/runtime', () => ({
  default: { id: 'target-postgres' },
}));

vi.mock('@prisma-next/adapter-postgres/runtime', () => ({
  default: { id: 'adapter-postgres' },
}));

vi.mock('@prisma-next/driver-postgres/runtime', () => ({
  default: { id: 'driver-postgres' },
}));

vi.mock('@prisma-next/integration-kysely', () => ({
  KyselyPrismaDialect: class {
    constructor(options: unknown) {
      mocks.dialectCtor(options);
    }
  },
}));

vi.mock('kysely', () => ({
  Kysely: class {
    constructor(config: unknown) {
      mocks.kyselyCtor(config);
    }
  },
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

import { Client, Pool } from 'pg';
import postgres from '../src/runtime/postgres';

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: 'sha256:test' as never,
  models: {},
  relations: {},
  storage: { tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

describe('postgres', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.createRuntime.mockReset();
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.driverCreate.mockReset();
    mocks.validateContract.mockReset();
    mocks.poolCtor.mockReset();
    mocks.dialectCtor.mockReset();
    mocks.kyselyCtor.mockReset();

    mocks.createExecutionContext.mockReturnValue({
      contract,
      codecs: {},
      operations: {},
      types: {},
    });
    mocks.createSqlExecutionStack.mockReturnValue({
      target: { id: 'target-postgres' },
      adapter: { id: 'adapter-postgres' },
      driver: { create: mocks.driverCreate },
      extensionPacks: [],
    });
    mocks.instantiateExecutionStack.mockReturnValue({ adapter: {} });
    mocks.driverCreate.mockReturnValue({ id: 'driver-instance' });
    mocks.createRuntime.mockReturnValue({ id: 'runtime-instance' });
    mocks.validateContract.mockReturnValue(contract);
  });

  it('defers stack instantiation runtime creation and pool creation until runtime is called', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    expect(db.sql).toEqual({ lane: 'sql' });
    expect(db.orm).toEqual({ lane: 'orm' });
    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.poolCtor).not.toHaveBeenCalled();

    db.runtime();

    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.poolCtor).toHaveBeenCalledTimes(1);
  });

  it('creates kysely lane from runtime and contract', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });
    const runtime = db.runtime();

    db.kysely(runtime);

    expect(mocks.dialectCtor).toHaveBeenCalledTimes(1);
    expect(mocks.dialectCtor).toHaveBeenCalledWith({ runtime, contract });
    expect(mocks.kyselyCtor).toHaveBeenCalledTimes(1);
  });

  it('memoizes runtime instance', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    const first = db.runtime();
    const second = db.runtime();

    expect(first).toBe(second);
    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
  });

  it('throws for multiple binding inputs during client construction', () => {
    expect(() =>
      postgres({
        contract,
        url: 'postgres://localhost:5432/db',
        binding: { kind: 'url', url: 'postgres://localhost:5432/db2' },
      } as unknown as Parameters<typeof postgres<typeof contract>>[0]),
    ).toThrow('Provide one binding input');
    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.poolCtor).not.toHaveBeenCalled();
  });

  it('throws for missing binding input during client construction', () => {
    expect(() =>
      postgres({
        contract,
      } as unknown as Parameters<typeof postgres<typeof contract>>[0]),
    ).toThrow('Provide one binding input');
    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.poolCtor).not.toHaveBeenCalled();
  });

  it('validates contractJson input', () => {
    const contractJson = { models: {} };

    postgres({
      contractJson,
      url: 'postgres://localhost:5432/db',
    });

    expect(mocks.validateContract).toHaveBeenCalledTimes(1);
    expect(mocks.validateContract).toHaveBeenCalledWith(contractJson);
  });

  it('validates direct contract input', () => {
    postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    expect(mocks.validateContract).toHaveBeenCalledTimes(1);
    expect(mocks.validateContract).toHaveBeenCalledWith(contract);
  });

  it('creates pool from url with explicit defaults', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    db.runtime();

    expect(mocks.poolCtor).toHaveBeenCalledTimes(1);
    expect(mocks.poolCtor).toHaveBeenCalledWith({
      connectionString: 'postgres://localhost:5432/db',
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 30_000,
    });
  });

  it('allows overriding url pool timeout options', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
      poolOptions: {
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 45_000,
      },
    });

    db.runtime();

    expect(mocks.poolCtor).toHaveBeenCalledTimes(1);
    expect(mocks.poolCtor).toHaveBeenCalledWith({
      connectionString: 'postgres://localhost:5432/db',
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 45_000,
    });
  });

  it('accepts postgresql url scheme', () => {
    postgres({
      contract,
      url: 'postgresql://localhost:5432/db',
    }).runtime();

    expect(mocks.poolCtor).toHaveBeenCalledTimes(1);
  });

  it('throws for empty url binding', () => {
    expect(() =>
      postgres({
        contract,
        url: '   ',
      }),
    ).toThrow('Postgres URL must be a non-empty string');
  });

  it('throws for invalid url scheme', () => {
    expect(() =>
      postgres({
        contract,
        url: 'mysql://localhost:5432/db',
      }),
    ).toThrow('Postgres URL must use postgres:// or postgresql://');
  });

  it('uses pg pool binding', () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const db = postgres({
      contract,
      pg: pool,
    });

    db.runtime();

    expect(mocks.driverCreate).toHaveBeenCalledWith({
      connect: { pool },
      cursor: { disabled: true },
    });
  });

  it('uses pg client binding', () => {
    const client = new Client();
    const db = postgres({
      contract,
      pg: client,
    });

    db.runtime();

    expect(mocks.driverCreate).toHaveBeenCalledWith({
      connect: { client },
      cursor: { disabled: true },
    });
  });

  it('uses explicit binding object', () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const db = postgres({
      contract,
      binding: { kind: 'pgPool', pool },
    });

    db.runtime();

    expect(mocks.driverCreate).toHaveBeenCalledWith({
      connect: { pool },
      cursor: { disabled: true },
    });
  });

  it('throws when pg input is neither Pool nor Client', () => {
    expect(() =>
      postgres({
        contract,
        pg: { query: () => {} } as unknown as Client,
      }),
    ).toThrow('Unable to determine pg binding type from pg input');
  });
});

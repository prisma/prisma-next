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

vi.mock('@prisma-next/sql-orm-lane', () => ({
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

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  coreHash: 'sha256:test' as never,
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
});

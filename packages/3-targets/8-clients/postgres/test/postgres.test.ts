import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instantiateExecutionStack: vi.fn(),
  createRuntime: vi.fn(),
  createExecutionContext: vi.fn(),
  createSqlExecutionStack: vi.fn(),
  driverConnect: vi.fn(),
  driverClose: vi.fn(),
  driverCreate: vi.fn(),
  validateContract: vi.fn(),
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
  default: {
    id: 'driver-postgres',
    create: mocks.driverCreate,
  },
}));

vi.mock('pg', () => {
  class Pool {}

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
  mappings: {},
};

describe('postgres', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.createRuntime.mockReset();
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.driverConnect.mockReset();
    mocks.driverClose.mockReset();
    mocks.driverCreate.mockReset();
    mocks.validateContract.mockReset();

    mocks.createExecutionContext.mockReturnValue({
      contract,
      codecs: {},
      operations: {},
      types: {},
    });
    mocks.createSqlExecutionStack.mockReturnValue({
      target: { id: 'target-postgres' },
      adapter: { id: 'adapter-postgres' },
      driver: {},
      extensionPacks: [],
    });
    const mockDriver = {
      id: 'driver-instance',
      connect: mocks.driverConnect.mockResolvedValue(undefined),
      close: mocks.driverClose.mockResolvedValue(undefined),
    };
    mocks.instantiateExecutionStack.mockReturnValue({
      adapter: {},
      driver: mockDriver,
    });
    mocks.createRuntime.mockReturnValue({ id: 'runtime-instance' });
    mocks.validateContract.mockReturnValue(contract);
  });

  it('defers stack instantiation and runtime creation until runtime is called', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    expect(db.sql).toEqual({ lane: 'sql' });
    expect(db.orm).toEqual({ lane: 'orm' });
    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();

    await db.runtime();

    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
  });

  it('memoizes runtime instance', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    const first = await db.runtime();
    const second = await db.runtime();

    expect(first).toBe(second);
    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
  });

  it('shares runtime initialization across concurrent callers', async () => {
    let resolveConnect: (() => void) | undefined;
    mocks.driverConnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );

    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    const first = db.runtime();
    const second = db.runtime();
    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(0);

    resolveConnect?.();

    const [firstRuntime, secondRuntime] = await Promise.all([first, second]);
    expect(firstRuntime).toBe(secondRuntime);
    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
  });

  it('retries runtime initialization after connect failure', async () => {
    mocks.driverConnect.mockRejectedValueOnce(new Error('connect failed'));

    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    await expect(db.runtime()).rejects.toThrow('connect failed');
    await expect(db.runtime()).resolves.toEqual({ id: 'runtime-instance' });
    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(2);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(2);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
  });

  it('closes connected driver when createRuntime fails and retries cleanly', async () => {
    mocks.createRuntime.mockImplementationOnce(() => {
      throw new Error('runtime creation failed');
    });

    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    await expect(db.runtime()).rejects.toThrow('runtime creation failed');
    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.driverClose).toHaveBeenCalledTimes(1);

    await expect(db.runtime()).resolves.toEqual({ id: 'runtime-instance' });
    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(2);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(2);
    expect(mocks.driverClose).toHaveBeenCalledTimes(1);
  });

  it('throws for multiple binding inputs during client construction', () => {
    try {
      postgres({
        contract,
        url: 'postgres://localhost:5432/db',
        binding: { kind: 'url', url: 'postgres://localhost:5432/db2' },
      } as unknown as Parameters<typeof postgres<typeof contract>>[0]);
      throw new Error('Expected constructor to throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DRIVER.BINDING_INVALID',
        category: 'RUNTIME',
      });
    }
    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });

  it('throws for missing binding input during client construction', () => {
    try {
      postgres({
        contract,
      } as unknown as Parameters<typeof postgres<typeof contract>>[0]);
      throw new Error('Expected constructor to throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DRIVER.BINDING_INVALID',
        category: 'RUNTIME',
      });
    }
    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
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

  it('calls driver.connect with url binding before createRuntime', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    await db.runtime();

    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'postgres://localhost:5432/db',
    });
    expect(mocks.createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        driver: expect.objectContaining({ id: 'driver-instance' }),
      }),
    );
  });

  it('accepts postgresql url scheme', async () => {
    await postgres({
      contract,
      url: 'postgresql://localhost:5432/db',
    }).runtime();

    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'postgresql://localhost:5432/db',
    });
  });

  it('calls driver.connect before createRuntime', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    const callOrder: string[] = [];
    mocks.driverConnect.mockImplementation(async () => {
      callOrder.push('connect');
    });
    mocks.createRuntime.mockImplementation(() => {
      callOrder.push('createRuntime');
      return { id: 'runtime-instance' };
    });

    await db.runtime();

    expect(callOrder).toEqual(['connect', 'createRuntime']);
  });

  it('passes driver from stackInstance to createRuntime', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    let capturedDriver: unknown;
    mocks.createRuntime.mockImplementation((opts: { driver: unknown }) => {
      capturedDriver = opts.driver;
      return { id: 'runtime-instance' };
    });

    await db.runtime();

    expect(capturedDriver).toBe(
      (mocks.instantiateExecutionStack.mock.results[0] as { value: { driver: unknown } }).value
        .driver,
    );
  });

  it('throws clear configuration error when stack has no driver descriptor', async () => {
    mocks.instantiateExecutionStack.mockReturnValue({
      adapter: {},
      driver: undefined,
    });

    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    await expect(db.runtime()).rejects.toThrow(
      'Relational runtime requires a driver descriptor on the execution stack',
    );
  });

  it('throws for empty url binding', () => {
    try {
      postgres({
        contract,
        url: '   ',
      });
      throw new Error('Expected constructor to throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DRIVER.BINDING_INVALID',
        category: 'RUNTIME',
      });
    }
  });

  it('throws for invalid url scheme', () => {
    try {
      postgres({
        contract,
        url: 'mysql://localhost:5432/db',
      });
      throw new Error('Expected constructor to throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DRIVER.BINDING_INVALID',
        category: 'RUNTIME',
      });
    }
  });

  it('uses pg pool binding', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const db = postgres({
      contract,
      pg: pool,
    });

    await db.runtime();

    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'pgPool',
      pool,
    });
  });

  it('uses pg client binding', async () => {
    const client = new Client();
    const db = postgres({
      contract,
      pg: client,
    });

    await db.runtime();

    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'pgClient',
      client,
    });
  });

  it('uses explicit binding object', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const db = postgres({
      contract,
      binding: { kind: 'pgPool', pool },
    });

    await db.runtime();

    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'pgPool',
      pool,
    });
  });

  it('throws when pg input is neither Pool nor Client', () => {
    try {
      postgres({
        contract,
        pg: { query: () => {} } as unknown as Client,
      });
      throw new Error('Expected constructor to throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DRIVER.BINDING_INVALID',
        category: 'RUNTIME',
      });
    }
  });

  it('passes cursor options into driver descriptor create', () => {
    const cursor = { batchSize: 111 } as const;

    postgres({
      contract,
      url: 'postgres://localhost:5432/db',
      cursor,
    });

    const createStackCall = mocks.createSqlExecutionStack.mock.calls[0]?.[0] as {
      driver: { create: () => unknown };
    };
    expect(createStackCall).toBeDefined();

    createStackCall.driver.create();
    expect(mocks.driverCreate).toHaveBeenCalledWith({ cursor });
  });
});

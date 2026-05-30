import { createContract } from '@prisma-next/contract/testing';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instantiateExecutionStack: vi.fn(),
  createRuntime: vi.fn(),
  createExecutionContext: vi.fn(),
  createSqlExecutionStack: vi.fn(),
  withTransaction: vi.fn(),
  sqlBuilder: vi.fn(),
  driverCreate: vi.fn(),
  driverConnect: vi.fn(),
  deserializeContract: vi.fn(),
  poolCtor: vi.fn(),
  poolEnd: vi.fn(),
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

vi.mock('@prisma-next/sql-builder/runtime', () => ({
  sql: mocks.sqlBuilder,
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
    end: ReturnType<typeof vi.fn>;
    constructor(options: unknown) {
      mocks.poolCtor(options);
      this.end = mocks.poolEnd;
    }
  }

  class Client {}

  return { Pool, Client };
});

import { Client, Pool } from 'pg';
import postgres from '../src/runtime/postgres';

const contract = createContract<SqlStorage>();

describe('postgres close()', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.createRuntime.mockReset();
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.withTransaction.mockReset();
    mocks.driverCreate.mockReset();
    mocks.driverConnect.mockReset();
    mocks.deserializeContract.mockReset();
    mocks.poolCtor.mockReset();
    mocks.sqlBuilder.mockReset();
    mocks.poolEnd.mockReset();

    mocks.createExecutionContext.mockReturnValue({
      contract,
      codecs: {},
      queryOperations: { entries: () => ({}) },
      types: {},
    });
    mocks.createSqlExecutionStack.mockReturnValue({
      target: { id: 'target-postgres' },
      adapter: {
        id: 'adapter-postgres',
        rawCodecInferer: { inferCodec: () => 'pg/text' },
        create: () => ({}),
      },
      driver: { create: mocks.driverCreate },
      extensionPacks: [],
    });
    mocks.instantiateExecutionStack.mockReturnValue({ adapter: {} });
    mocks.driverConnect.mockResolvedValue(undefined);
    mocks.driverCreate.mockReturnValue({ id: 'driver-instance', connect: mocks.driverConnect });
    mocks.createRuntime.mockReturnValue({ id: 'runtime-instance' });
    mocks.deserializeContract.mockReturnValue(contract);
    mocks.sqlBuilder.mockReturnValue({ lane: 'sql' });
    mocks.poolEnd.mockResolvedValue(undefined);
  });

  it('releases the facade-owned Pool when constructed from { url }', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();
    await Promise.resolve();

    await db.close();

    expect(mocks.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('does NOT close a caller-supplied pg.Pool', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    mocks.poolEnd.mockReset();

    const db = postgres({ contract, pg: pool });
    db.runtime();
    await db.close();

    expect(mocks.poolEnd).not.toHaveBeenCalled();
  });

  it('does NOT close a caller-supplied pg.Client', async () => {
    const client = new Client();
    mocks.poolEnd.mockReset();

    const db = postgres({ contract, pg: client });
    db.runtime();
    await db.close();

    expect(mocks.poolEnd).not.toHaveBeenCalled();
  });

  it('is idempotent: calling twice does not throw and does not double-dispose the owned pool', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();
    await Promise.resolve();

    await db.close();
    await db.close();

    expect(mocks.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('while a lazy connect is in flight resolves cleanly', async () => {
    let rejectConnect!: (err: Error) => void;
    mocks.driverConnect.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectConnect = reject;
        }),
    );

    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();

    const closePromise = db.close();
    rejectConnect(new Error('connect failed'));

    await expect(closePromise).resolves.toBeUndefined();
  });

  it('before any connect is a no-op', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    expect(mocks.poolEnd).not.toHaveBeenCalled();
  });

  it('db.runtime() rejects with "Postgres client is closed" after close()', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    expect(() => db.runtime()).toThrow('Postgres client is closed');
  });

  it('db.connect() rejects with "Postgres client is closed" after close()', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    await expect(db.connect()).rejects.toThrow('Postgres client is closed');
  });

  it('await using db executes [Symbol.asyncDispose] on scope exit (pool.end called)', async () => {
    async function run() {
      await using db = postgres({ contract, url: 'postgres://localhost:5432/db' });
      db.runtime();
      await Promise.resolve();
    }

    await run();
    expect(mocks.poolEnd).toHaveBeenCalledTimes(1);
  });
});

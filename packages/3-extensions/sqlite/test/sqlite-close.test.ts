import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { createContract } from '@prisma-next/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instantiateExecutionStack: vi.fn(),
  createRuntime: vi.fn(),
  createExecutionContext: vi.fn(),
  createSqlExecutionStack: vi.fn(),
  sqlBuilder: vi.fn(),
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
  withTransaction: vi.fn(),
}));

vi.mock('@prisma-next/sql-builder/runtime', () => ({
  sql: mocks.sqlBuilder,
}));

vi.mock('@prisma-next/sql-orm-client', async (importActual) => {
  const actual = await importActual<typeof import('@prisma-next/sql-orm-client')>();
  return {
    orm: vi.fn(() => ({ lane: 'orm' })),
    buildNamespacedEnums: actual.buildNamespacedEnums,
  };
});

vi.mock('@prisma-next/family-sql/ir', () => ({
  SqlContractSerializer: class {
    deserializeContract(value: unknown) {
      return mocks.deserializeContract(value);
    }
  },
}));

vi.mock('@prisma-next/target-sqlite/runtime', () => ({
  default: { id: 'target-sqlite' },
}));

vi.mock('@prisma-next/adapter-sqlite/runtime', () => ({
  default: { id: 'adapter-sqlite' },
}));

vi.mock('@prisma-next/driver-sqlite/runtime', () => ({
  default: { id: 'driver-sqlite' },
}));

import sqlite from '../src/runtime/sqlite';

const contract = createContract<SqlStorage>();

describe('sqlite close()', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.createRuntime.mockReset();
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.driverCreate.mockReset();
    mocks.driverConnect.mockReset();
    mocks.driverClose.mockReset();
    mocks.deserializeContract.mockReset();
    mocks.sqlBuilder.mockReset();

    mocks.createExecutionContext.mockReturnValue({
      contract,
      codecs: {},
      queryOperations: { entries: () => ({}) },
      types: {},
    });
    mocks.createSqlExecutionStack.mockReturnValue({
      target: { id: 'target-sqlite' },
      adapter: {
        id: 'adapter-sqlite',
        rawCodecInferer: { inferCodec: () => 'sqlite/text@1' },
        create: () => ({}),
      },
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
    mocks.sqlBuilder.mockReturnValue({ lane: 'sql' });
  });

  it('releases the facade-owned SQLite driver when constructed from { path }', async () => {
    const db = sqlite({ contract, path: '/tmp/test.db' });
    db.runtime();
    await Promise.resolve();

    await db.close();

    expect(mocks.driverClose).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: calling twice does not throw and does not double-dispose', async () => {
    const db = sqlite({ contract, path: '/tmp/test.db' });
    db.runtime();
    await Promise.resolve();

    await db.close();
    await db.close();

    expect(mocks.driverClose).toHaveBeenCalledTimes(1);
  });

  it('while a lazy connect is in flight resolves cleanly', async () => {
    let rejectConnect!: (err: Error) => void;
    mocks.driverConnect.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectConnect = reject;
        }),
    );

    const db = sqlite({ contract, path: '/tmp/test.db' });
    db.runtime();

    const closePromise = db.close();
    rejectConnect(new Error('connect failed'));

    await expect(closePromise).resolves.toBeUndefined();
  });

  it('before any connect is a no-op', async () => {
    const db = sqlite({ contract, path: '/tmp/test.db' });
    await db.close();
    expect(mocks.driverClose).not.toHaveBeenCalled();
  });

  it('db.runtime() rejects with "SQLite client is closed" after close()', async () => {
    const db = sqlite({ contract, path: '/tmp/test.db' });
    await db.close();
    expect(() => db.runtime()).toThrow('SQLite client is closed');
  });

  it('db.connect() rejects with "SQLite client is closed" after close()', async () => {
    const db = sqlite({ contract, path: '/tmp/test.db' });
    await db.close();
    await expect(db.connect({ path: '/tmp/test.db' })).rejects.toThrow('SQLite client is closed');
  });

  it('await using db executes [Symbol.asyncDispose] on scope exit (driver.close called)', async () => {
    async function run() {
      await using db = sqlite({ contract, path: '/tmp/test.db' });
      db.runtime();
      await Promise.resolve();
    }

    await run();
    expect(mocks.driverClose).toHaveBeenCalledTimes(1);
  });
});

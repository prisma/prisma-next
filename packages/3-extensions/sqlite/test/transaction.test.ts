import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { createContract } from '@prisma-next/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instantiateExecutionStack: vi.fn(),
  SqliteRuntime: vi.fn(),
  runtimeInstances: [] as unknown[],
  createExecutionContext: vi.fn(),
  createSqlExecutionStack: vi.fn(),
  withTransaction: vi.fn(),
  sqlBuilder: vi.fn(),
  orm: vi.fn(),
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
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/runtime/sqlite-runtime', () => ({
  // Delegating mock: the spy is invoked as a plain function (so per-test
  // mockReturnValue/mockImplementation work), its return value becomes the
  // instance shape, and every constructed instance is registered for
  // identity assertions.
  SqliteRuntime: class {
    constructor(options: unknown) {
      Object.assign(this, mocks.SqliteRuntime(options));
      mocks.runtimeInstances.push(this);
    }
  },
}));

vi.mock('@prisma-next/sql-builder/runtime', () => ({
  sql: mocks.sqlBuilder,
}));

vi.mock('@prisma-next/sql-orm-client', () => ({
  orm: mocks.orm,
}));

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

describe('sqlite transaction()', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.SqliteRuntime.mockReset();
    mocks.runtimeInstances.length = 0;
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.withTransaction.mockReset();
    mocks.driverCreate.mockReset();
    mocks.driverConnect.mockReset();
    mocks.driverClose.mockReset();
    mocks.deserializeContract.mockReset();
    mocks.sqlBuilder.mockReset();
    mocks.orm.mockReset();

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
    mocks.SqliteRuntime.mockReturnValue({ id: 'runtime-instance' });
    mocks.deserializeContract.mockReturnValue(contract);
    mocks.sqlBuilder.mockReturnValue({ lane: 'sql' });
    mocks.orm.mockReturnValue({ lane: 'orm' });
    mocks.withTransaction.mockImplementation(
      async (_runtime: unknown, fn: (ctx: unknown) => unknown) => {
        const mockTxCtx = {
          invalidated: false,
          execute: vi.fn(),
        };
        return fn(mockTxCtx);
      },
    );
  });

  it('transaction() delegates to withTransaction with the lazy runtime', async () => {
    const db = sqlite({
      contract,
      path: '/tmp/test.db',
    });

    const result = await db.transaction(async () => 'tx-value');

    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.withTransaction).toHaveBeenCalledWith(
      mocks.runtimeInstances[0],
      expect.any(Function),
    );
    expect(result).toBe('tx-value');
  });

  it('transaction() provides sql on the transaction context', async () => {
    const txSqlProxy = { lane: 'tx-sql' };
    let callCount = 0;
    mocks.sqlBuilder.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { [UNBOUND_NAMESPACE_ID]: { lane: 'sql' } };
      return { [UNBOUND_NAMESPACE_ID]: txSqlProxy };
    });

    const db = sqlite({
      contract,
      path: '/tmp/test.db',
    });

    let receivedTx: { sql?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.sql).toBe(txSqlProxy);
    expect(mocks.sqlBuilder).toHaveBeenCalledTimes(2);
  });

  it('transaction() provides orm on the transaction context', async () => {
    const txOrmProxy = { lane: 'tx-orm' };
    let ormCallCount = 0;
    mocks.orm.mockImplementation(() => {
      ormCallCount++;
      if (ormCallCount === 1) return { [UNBOUND_NAMESPACE_ID]: { lane: 'orm' } };
      return { [UNBOUND_NAMESPACE_ID]: txOrmProxy };
    });

    const db = sqlite({
      contract,
      path: '/tmp/test.db',
    });

    let receivedTx: { orm?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.orm).toBe(txOrmProxy);
    expect(ormCallCount).toBe(2);
  });

  it('transaction() lazily creates runtime before connect()', async () => {
    const db = sqlite({
      contract,
      path: '/tmp/test.db',
    });

    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.SqliteRuntime).not.toHaveBeenCalled();

    await db.transaction(async () => 'value');

    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.SqliteRuntime).toHaveBeenCalledTimes(1);
  });

  it('transaction() rejects with "SQLite client is closed" after close()', async () => {
    const db = sqlite({
      contract,
      path: '/tmp/test.db',
    });

    await db.close();

    await expect(db.transaction(async () => 'value')).rejects.toThrow('SQLite client is closed');
  });
});

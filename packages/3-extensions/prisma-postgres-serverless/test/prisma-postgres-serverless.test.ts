import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { createContract } from '@prisma-next/test-utils';
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

vi.mock('@prisma-next/driver-ppg-serverless/runtime', () => ({
  default: { id: 'driver-ppg-serverless' },
}));

import prismaPostgresServerless from '../src/runtime/prisma-postgres-serverless';

const contract = createContract<SqlStorage>();

describe('prisma-postgres-serverless', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.createRuntime.mockReset();
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.withTransaction.mockReset();
    mocks.driverCreate.mockReset();
    mocks.driverConnect.mockReset();
    mocks.deserializeContract.mockReset();
    mocks.sqlBuilder.mockReset();

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
        rawCodecInferer: { inferCodec: () => 'ppg/text' },
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

  describe('construction', () => {
    it('accepts { contract } and constructs synchronously', () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      const thenable = db as unknown as { then?: unknown };
      expect(typeof thenable.then).toBe('undefined');
      expect(db.sql).toBeDefined();
      expect(mocks.deserializeContract).toHaveBeenCalledWith(contract);
    });

    it('accepts { contractJson } and routes it through the contract serializer', () => {
      const contractJson = { models: {} };

      prismaPostgresServerless({
        contractJson,
        url: 'postgres://localhost:5432/db',
      });

      expect(mocks.deserializeContract).toHaveBeenCalledTimes(1);
      expect(mocks.deserializeContract).toHaveBeenCalledWith(contractJson);
    });
  });

  describe('static surface', () => {
    it('exposes sql / orm / raw / context / stack / connect / runtime / transaction / prepare / close / [Symbol.asyncDispose]', () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      expect(db).toMatchObject({
        sql: expect.anything(),
        orm: expect.anything(),
        raw: expect.any(Function),
        context: expect.anything(),
        stack: expect.anything(),
        connect: expect.any(Function),
        runtime: expect.any(Function),
        transaction: expect.any(Function),
        prepare: expect.any(Function),
        close: expect.any(Function),
      });
      expect(typeof db[Symbol.asyncDispose]).toBe('function');
    });

    it('builds sql eagerly without instantiating the driver / runtime', () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      expect(mocks.sqlBuilder).toHaveBeenCalledTimes(1);
      expect(db.sql).toEqual({ lane: 'sql' });
      expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
      expect(mocks.createRuntime).not.toHaveBeenCalled();
      expect(mocks.driverCreate).not.toHaveBeenCalled();
    });
  });

  describe('runtime lifecycle', () => {
    it('lazily instantiates driver and runtime on first runtime() call, memoised thereafter', () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      const first = db.runtime();
      const second = db.runtime();

      expect(first).toBe(second);
      expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
      expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
      expect(mocks.driverCreate).toHaveBeenCalledTimes(1);
    });

    it('driver.create() is called with no argument (no PPG cursor mode)', () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });
      db.runtime();
      expect(mocks.driverCreate).toHaveBeenCalledTimes(1);
      expect(mocks.driverCreate).toHaveBeenCalledWith();
    });
  });

  describe('binding resolution', () => {
    it('routes a { url } input to the driver as { kind: "url", url } (no Pool wrapping)', async () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      await db.connect();
      expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
      expect(mocks.driverConnect).toHaveBeenCalledWith({
        kind: 'url',
        url: 'postgres://localhost:5432/db',
      });
    });

    it('routes a { ppgClient } input to the driver as { kind: "ppgClient", client }', async () => {
      // The facade-level type asks for a real PpgClient; the wiring test
      // doesn't care about the client's shape, only that it's forwarded.
      const fakeClient = { __brand: 'ppg' };

      const db = prismaPostgresServerless({
        contract,
        ppgClient: fakeClient,
      } as unknown as Parameters<typeof prismaPostgresServerless<typeof contract>>[0]);
      await db.connect();

      expect(mocks.driverConnect).toHaveBeenCalledWith({
        kind: 'ppgClient',
        client: fakeClient,
      });
    });

    it('rejects an empty url', () => {
      expect(() =>
        prismaPostgresServerless({
          contract,
          url: '   ',
        }),
      ).toThrow('Postgres URL must be a non-empty string');
    });

    it('rejects a non-postgres URL scheme', () => {
      expect(() =>
        prismaPostgresServerless({
          contract,
          url: 'mysql://localhost:5432/db',
        }),
      ).toThrow('Postgres URL must use postgres:// or postgresql://');
    });

    it('throws when multiple binding inputs are provided', () => {
      expect(() =>
        prismaPostgresServerless({
          contract,
          url: 'postgres://localhost:5432/db',
          binding: { kind: 'url', url: 'postgres://localhost:5432/db2' },
        } as unknown as Parameters<typeof prismaPostgresServerless<typeof contract>>[0]),
      ).toThrow('Provide one binding input');
    });
  });

  describe('connect()', () => {
    it('rejects a second connect with "already connected"', async () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      await db.connect();
      await expect(db.connect({ url: 'postgres://localhost:5432/db2' })).rejects.toThrow(
        'Prisma Postgres serverless client already connected',
      );

      expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    });

    it('rejects when called with no configured binding', async () => {
      const db = prismaPostgresServerless({
        contract,
      } as Parameters<typeof prismaPostgresServerless<typeof contract>>[0]);

      await expect(db.connect()).rejects.toThrow(
        'Prisma Postgres serverless binding not configured',
      );
    });
  });

  describe('transaction()', () => {
    it('delegates to withTransaction with the lazy runtime', async () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      const result = await db.transaction(async () => 'tx-value');

      expect(mocks.withTransaction).toHaveBeenCalledOnce();
      expect(mocks.withTransaction).toHaveBeenCalledWith(
        mocks.createRuntime.mock.results[0]?.value,
        expect.any(Function),
      );
      expect(result).toBe('tx-value');
    });

    it('provides sql + orm on the transaction context', async () => {
      const txSqlProxy = { lane: 'tx-sql' };
      let callCount = 0;
      mocks.sqlBuilder.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return { lane: 'sql' };
        return txSqlProxy;
      });

      const { orm: ormMock } = await import('@prisma-next/sql-orm-client');
      const txOrmProxy = { lane: 'tx-orm' };
      let ormCallCount = 0;
      vi.mocked(ormMock).mockImplementation((() => {
        ormCallCount++;
        if (ormCallCount === 1) return { lane: 'orm' };
        return txOrmProxy;
      }) as typeof ormMock);

      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });

      let receivedTx: { sql?: unknown; orm?: unknown } | undefined;
      await db.transaction(async (tx) => {
        receivedTx = tx;
      });

      expect(receivedTx).toBeDefined();
      expect(receivedTx!.sql).toBe(txSqlProxy);
      expect(receivedTx!.orm).toBe(txOrmProxy);
    });
  });

  describe('close() and [Symbol.asyncDispose]', () => {
    it('close() is idempotent (no-op on second call)', async () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });
      db.runtime();
      await Promise.resolve();

      await db.close();
      await db.close();
      // No facade-owned resource to dispose; the test asserts no throw and
      // that subsequent runtime() / connect() reject as closed.
      expect(() => db.runtime()).toThrow('Prisma Postgres serverless client is closed');
      await expect(db.connect()).rejects.toThrow('Prisma Postgres serverless client is closed');
    });

    it('[Symbol.asyncDispose] delegates to close()', async () => {
      async function run() {
        await using db = prismaPostgresServerless({
          contract,
          url: 'postgres://localhost:5432/db',
        });
        db.runtime();
        await Promise.resolve();
        // exiting scope triggers Symbol.asyncDispose -> close()
      }

      await run();
      // No throw means asyncDispose ran cleanly.
      expect(true).toBe(true);
    });

    it('close() before any connect is a clean no-op', async () => {
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });
      await db.close();
      // No throw; no driver work attempted.
      expect(mocks.driverConnect).not.toHaveBeenCalled();
    });

    it('close() resolves cleanly while a lazy connect is in flight (rejection)', async () => {
      let rejectConnect!: (err: Error) => void;
      mocks.driverConnect.mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectConnect = reject;
          }),
      );
      const db = prismaPostgresServerless({
        contract,
        url: 'postgres://localhost:5432/db',
      });
      db.runtime();

      const closePromise = db.close();
      rejectConnect(new Error('connect failed'));

      await expect(closePromise).resolves.toBeUndefined();
    });
  });
});

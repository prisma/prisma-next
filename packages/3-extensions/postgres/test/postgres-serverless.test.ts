import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlMiddleware, SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
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
  poolCtor: vi.fn(),
  clientCtor: vi.fn(),
  runtimeClose: vi.fn(),
}));

vi.mock('@prisma-next/framework-components/execution', () => ({
  instantiateExecutionStack: mocks.instantiateExecutionStack,
}));

vi.mock('@prisma-next/sql-runtime', () => ({
  createExecutionContext: mocks.createExecutionContext,
  createSqlExecutionStack: mocks.createSqlExecutionStack,
  createRuntime: mocks.createRuntime,
}));

vi.mock('@prisma-next/sql-builder/runtime', () => ({
  sql: mocks.sqlBuilder,
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

  class Client {
    constructor(options: unknown) {
      mocks.clientCtor(options);
    }
  }

  return { Pool, Client };
});

import { Client } from 'pg';
import postgresServerless from '../src/runtime/postgres-serverless';

const contract = createContract<SqlStorage>();

describe('postgresServerless', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.createRuntime.mockReset();
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.driverCreate.mockReset();
    mocks.driverConnect.mockReset();
    mocks.driverClose.mockReset();
    mocks.deserializeContract.mockReset();
    mocks.poolCtor.mockReset();
    mocks.clientCtor.mockReset();
    mocks.sqlBuilder.mockReset();
    mocks.runtimeClose.mockReset();

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
    mocks.driverClose.mockResolvedValue(undefined);
    mocks.driverCreate.mockReturnValue({
      id: 'driver-instance',
      connect: mocks.driverConnect,
      close: mocks.driverClose,
    });
    mocks.runtimeClose.mockResolvedValue(undefined);
    mocks.createRuntime.mockImplementation(() => ({
      id: 'runtime-instance',
      close: mocks.runtimeClose,
    }));
    mocks.deserializeContract.mockReturnValue(contract);
    mocks.sqlBuilder.mockReturnValue({ lane: 'sql' });
  });

  it('exposes only the static authoring surface synchronously', () => {
    const db = postgresServerless({ contract });

    expect(mocks.sqlBuilder).toHaveBeenCalledTimes(1);
    expect(db.sql).toEqual({ lane: 'sql' });
    expect(db.context).toBeDefined();
    expect(db.stack).toBeDefined();
    expect(db.contract).toBe(contract);
    expect(typeof db.connect).toBe('function');
  });

  it('does not expose orm/runtime/transaction at runtime', () => {
    const db = postgresServerless({ contract });
    // Probe runtime keys the typed surface intentionally hides so the negative
    // assertion can index them by string without tripping the type checker.
    const indexable = db as unknown as Record<string, unknown>;
    expect(indexable['orm']).toBeUndefined();
    expect(indexable['runtime']).toBeUndefined();
    expect(indexable['transaction']).toBeUndefined();
  });

  it('does not allocate runtime resources at construction time', () => {
    postgresServerless({ contract });

    expect(mocks.instantiateExecutionStack).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.driverCreate).not.toHaveBeenCalled();
    expect(mocks.clientCtor).not.toHaveBeenCalled();
    expect(mocks.poolCtor).not.toHaveBeenCalled();
  });

  it('connect() constructs pg.Client exactly once with the given URL and routes through pgClient binding', async () => {
    const db = postgresServerless({ contract });
    const url = 'postgres://localhost:5432/db';

    const runtime = await db.connect({ url });

    expect(mocks.clientCtor).toHaveBeenCalledTimes(1);
    expect(mocks.clientCtor).toHaveBeenCalledWith({ connectionString: url });
    expect(mocks.poolCtor).not.toHaveBeenCalled();
    expect(mocks.instantiateExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.driverCreate).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'pgClient',
      client: expect.any(Client),
    });
    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
    expect(runtime).toBeDefined();
  });

  it('connect() defaults cursor option to enabled (no cursor: { disabled: true })', async () => {
    const db = postgresServerless({ contract });

    await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(mocks.driverCreate).toHaveBeenCalledTimes(1);
    expect(mocks.driverCreate).toHaveBeenCalledWith({});
  });

  it('connect() forwards cursor option when provided', async () => {
    const db = postgresServerless({
      contract,
      cursor: { disabled: true, batchSize: 25 },
    });

    await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(mocks.driverCreate).toHaveBeenCalledTimes(1);
    expect(mocks.driverCreate).toHaveBeenCalledWith({
      cursor: { disabled: true, batchSize: 25 },
    });
  });

  it('returns distinct Runtime instances for each connect() call (no closure cache)', async () => {
    const runtimes = [
      { id: 'runtime-1', close: mocks.runtimeClose },
      { id: 'runtime-2', close: mocks.runtimeClose },
    ];
    let call = 0;
    mocks.createRuntime.mockImplementation(() => {
      const r = runtimes[call];
      call++;
      if (!r) throw new Error('unexpected createRuntime call');
      return r;
    });

    const db = postgresServerless({ contract });
    const first = await db.connect({ url: 'postgres://localhost:5432/db' });
    const second = await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(first).not.toBe(second);
    expect(mocks.clientCtor).toHaveBeenCalledTimes(2);
    expect(mocks.driverCreate).toHaveBeenCalledTimes(2);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(2);
    expect(mocks.createRuntime).toHaveBeenCalledTimes(2);
  });

  it('closes the driver if createRuntime throws after connect() resolved', async () => {
    const failure = new Error('createRuntime boom');
    mocks.createRuntime.mockImplementation(() => {
      throw failure;
    });

    const db = postgresServerless({ contract });

    await expect(db.connect({ url: 'postgres://localhost:5432/db' })).rejects.toBe(failure);

    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.driverClose).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error even when driver.close itself fails during cleanup', async () => {
    const failure = new Error('createRuntime boom');
    mocks.createRuntime.mockImplementation(() => {
      throw failure;
    });
    mocks.driverClose.mockRejectedValue(new Error('close boom'));

    const db = postgresServerless({ contract });

    await expect(db.connect({ url: 'postgres://localhost:5432/db' })).rejects.toBe(failure);
    expect(mocks.driverClose).toHaveBeenCalledTimes(1);
  });

  it('returned runtime is AsyncDisposable and disposes via close()', async () => {
    const db = postgresServerless({ contract });

    {
      await using runtime = await db.connect({ url: 'postgres://localhost:5432/db' });
      expect(runtime).toBeDefined();
      expect(mocks.runtimeClose).not.toHaveBeenCalled();
    }

    expect(mocks.runtimeClose).toHaveBeenCalledTimes(1);
  });

  it('explicit Symbol.asyncDispose invocation calls runtime.close exactly once', async () => {
    const db = postgresServerless({ contract });
    const runtime = await db.connect({ url: 'postgres://localhost:5432/db' });

    await runtime[Symbol.asyncDispose]();

    expect(mocks.runtimeClose).toHaveBeenCalledTimes(1);
  });

  it('does not construct pg.Pool over a full connect+dispose lifecycle', async () => {
    const db = postgresServerless({ contract });

    {
      await using _runtime = await db.connect({ url: 'postgres://localhost:5432/db' });
    }

    expect(mocks.poolCtor).not.toHaveBeenCalled();
  });

  it('forwards extensions and middleware to the execution stack and runtime', async () => {
    // The mocked stack/runtime never invokes these descriptors, so opaque marker
    // objects are sufficient to assert pass-through. Cast keeps the test focused
    // on wiring without manufacturing a full descriptor/middleware shape.
    const extension = { id: 'ext-pack' } as unknown as SqlRuntimeExtensionDescriptor<'postgres'>;
    const middleware = [{ id: 'mw-1' } as unknown as SqlMiddleware];
    const db = postgresServerless({
      contract,
      extensions: [extension],
      middleware,
    });

    await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(mocks.createSqlExecutionStack).toHaveBeenCalledWith(
      expect.objectContaining({ extensionPacks: [extension] }),
    );
    expect(mocks.createRuntime).toHaveBeenCalledWith(expect.objectContaining({ middleware }));
  });

  it('forwards verifyMarker option to createRuntime', async () => {
    const db = postgresServerless({ contract, verifyMarker: false });

    await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(mocks.createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ verifyMarker: false }),
    );
  });

  it('omits verifyMarker from createRuntime when not provided (runtime default applies)', async () => {
    const db = postgresServerless({ contract });

    await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
    const callArg = mocks.createRuntime.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('verifyMarker');
  });

  it('validates contractJson input', () => {
    const contractJson = { models: {} };
    postgresServerless({ contractJson });

    expect(mocks.deserializeContract).toHaveBeenCalledTimes(1);
    expect(mocks.deserializeContract).toHaveBeenCalledWith(contractJson);
  });

  it('validates direct contract input', () => {
    postgresServerless({ contract });

    expect(mocks.deserializeContract).toHaveBeenCalledTimes(1);
    expect(mocks.deserializeContract).toHaveBeenCalledWith(contract);
  });
});

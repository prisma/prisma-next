import type { Contract, ExecutionPlan } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Codec,
  CodecRegistry,
  CodecRuntimeBehavior,
  CodecTrait,
  SelectAst,
  SqlDriver,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { createRuntime, withTransaction } from '../src/sql-runtime';
import { createAsyncSecretCodec, decryptSecret } from './seeded-secret-codec';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('sha256:test'),
  models: {},
  roots: {},
  storage: { storageHash: coreHash('sha256:test'), tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
};

const runtimeSecretSeed = 'sql-runtime-secret';

interface DriverMockSpies {
  rootExecute: ReturnType<typeof vi.fn>;
  connectionExecute: ReturnType<typeof vi.fn>;
  transactionExecute: ReturnType<typeof vi.fn>;
  connectionRelease: ReturnType<typeof vi.fn>;
  connectionDestroy: ReturnType<typeof vi.fn>;
  transactionCommit: ReturnType<typeof vi.fn>;
  transactionRollback: ReturnType<typeof vi.fn>;
  driverClose: ReturnType<typeof vi.fn>;
}

type MockSqlDriver = SqlDriver & { __spies: DriverMockSpies };

type AnyCodec = Codec<
  string,
  readonly CodecTrait[],
  unknown,
  unknown,
  Record<string, unknown>,
  unknown,
  unknown,
  CodecRuntimeBehavior | undefined
>;

function createStubCodecs(extraCodecs: readonly AnyCodec[] = []): CodecRegistry {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  );
  for (const extraCodec of extraCodecs) {
    registry.register(extraCodec);
  }
  return registry;
}

function createStubAdapter(extraCodecs: readonly AnyCodec[] = []) {
  const codecs = createStubCodecs(extraCodecs);
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return codecs;
      },
      readMarkerStatement() {
        return {
          sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta from prisma_contract.marker where id = $1',
          params: [1],
        };
      },
    },
    lower(ast: SelectAst) {
      return {
        profileId: 'test-profile',
        body: Object.freeze({ sql: JSON.stringify(ast), params: [] }),
      };
    },
  };
}

function createMockDriver(): MockSqlDriver {
  const rootExecute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    yield { id: 1 };
  });
  const connectionExecute = vi.fn().mockImplementation(async function* (
    _request: SqlExecuteRequest,
  ) {
    yield { id: 2 };
  });
  const transactionExecute = vi.fn().mockImplementation(async function* (
    _request: SqlExecuteRequest,
  ) {
    yield { id: 3 };
  });

  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

  const transaction = {
    execute: transactionExecute,
    query,
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };

  const connection = {
    execute: connectionExecute,
    query,
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn().mockResolvedValue(transaction),
  };

  const driverClose = vi.fn().mockResolvedValue(undefined);

  const driver: SqlDriver = {
    execute: rootExecute,
    query,
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
    close: driverClose,
  };

  return Object.assign(driver, {
    __spies: {
      rootExecute,
      connectionExecute,
      transactionExecute,
      connectionRelease: connection.release,
      connectionDestroy: connection.destroy,
      transactionCommit: transaction.commit,
      transactionRollback: transaction.rollback,
      driverClose,
    },
  });
}

function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => createCodecRegistry(),
    parameterizedCodecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createTestAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const codecRegistry = adapter.profile.codecs();
  return {
    kind: 'adapter',
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => codecRegistry,
    parameterizedCodecs: () => [],
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

function createTestSetup(options?: { extraCodecs?: readonly AnyCodec[] }) {
  const adapter = createStubAdapter(options?.extraCodecs);
  const driver = createMockDriver();

  const targetDescriptor = createTestTargetDescriptor();
  const adapterDescriptor = createTestAdapterDescriptor(adapter);

  const stack = createSqlExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensionPacks: [],
  });
  type SqlTestStackInstance = ExecutionStackInstance<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>,
    RuntimeDriverInstance<'sql', 'postgres'>,
    RuntimeExtensionInstance<'sql', 'postgres'>
  >;
  const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;

  const context = createExecutionContext({
    contract: testContract,
    stack: { target: targetDescriptor, adapter: adapterDescriptor, extensionPacks: [] },
  });

  return { stackInstance, context, driver };
}

function createRawExecutionPlan<Row = Record<string, unknown>>(
  overrides?: Partial<ExecutionPlan<Row>>,
): ExecutionPlan<Row> {
  const metaOverrides = overrides?.meta;
  return {
    sql: 'select 1',
    params: [],
    ...overrides,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
      paramDescriptors: [],
      ...metaOverrides,
    },
  };
}

describe('createRuntime', () => {
  it('creates runtime with context and driver', () => {
    const { stackInstance, context, driver } = createTestSetup();

    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    expect(runtime).toBeDefined();
    expect(runtime.execute).toBeDefined();
    expect(runtime.telemetry).toBeDefined();
    expect(runtime.close).toBeDefined();
  });

  it('returns null telemetry when no events', () => {
    const { stackInstance, context, driver } = createTestSetup();

    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    expect(runtime.telemetry()).toBeNull();
  });

  it('closes runtime and driver', async () => {
    const { stackInstance, context, driver } = createTestSetup();

    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await runtime.close();
    expect(driver.close).toHaveBeenCalled();
  });

  it('validates codec registry at startup when verify mode is startup', () => {
    const { stackInstance, context, driver } = createTestSetup();

    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'startup', requireMarker: false },
    });

    expect(runtime).toBeDefined();
  });

  it('uses acquired connection queryable for connection.execute', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const connection = await runtime.connection();
    await connection.execute(createRawExecutionPlan()).toArray();

    expect(driver.__spies.connectionExecute).toHaveBeenCalledTimes(1);
    expect(driver.__spies.transactionExecute).not.toHaveBeenCalled();
    expect(driver.__spies.rootExecute).not.toHaveBeenCalled();

    await connection.release();
  });

  it('delegates connection.destroy() to the driver connection', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const connection = await runtime.connection();
    const reason = new Error('bad state');
    await connection.destroy(reason);

    expect(driver.__spies.connectionDestroy).toHaveBeenCalledOnce();
    expect(driver.__spies.connectionDestroy).toHaveBeenCalledWith(reason);
    expect(driver.__spies.connectionRelease).not.toHaveBeenCalled();
  });

  it('uses transaction queryable for transaction.execute', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const connection = await runtime.connection();
    const transaction = await connection.transaction();
    await transaction.execute(createRawExecutionPlan()).toArray();

    expect(driver.__spies.transactionExecute).toHaveBeenCalledTimes(1);
    expect(driver.__spies.connectionExecute).not.toHaveBeenCalled();
    expect(driver.__spies.rootExecute).not.toHaveBeenCalled();

    await transaction.rollback();
    await connection.release();
  });

  it('keeps root execute on driver queryable for runtime.execute', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await runtime.execute(createRawExecutionPlan()).toArray();

    expect(driver.__spies.rootExecute).toHaveBeenCalledTimes(1);
    expect(driver.__spies.connectionExecute).not.toHaveBeenCalled();
    expect(driver.__spies.transactionExecute).not.toHaveBeenCalled();
  });

  it('awaits async parameter encoding before driver execution', async () => {
    const asyncSecretCodec = createAsyncSecretCodec({
      typeId: 'test/async-secret@1',
      seed: runtimeSecretSeed,
    });
    const { stackInstance, context, driver } = createTestSetup({
      extraCodecs: [asyncSecretCodec],
    });
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const plan = createRawExecutionPlan({
      params: ['Alice'],
      meta: {
        target: testContract.target,
        targetFamily: testContract.targetFamily,
        storageHash: testContract.storage.storageHash,
        lane: 'raw',
        paramDescriptors: [
          {
            name: 'secret',
            codecId: 'test/async-secret@1',
            source: 'dsl' as const,
          },
        ],
      },
    });

    await runtime.execute(plan).toArray();

    expect(driver.__spies.rootExecute).toHaveBeenCalledOnce();
    // IV is random per encryption, so verify the driver received ciphertext
    // (not plaintext) and that it round-trips to the original value.
    const sentRequest = driver.__spies.rootExecute.mock.calls[0]?.[0] as
      | { params?: readonly unknown[] }
      | undefined;
    const sentSecret = sentRequest?.params?.[0];
    expect(typeof sentSecret).toBe('string');
    expect(sentSecret).not.toBe('Alice');
    await expect(decryptSecret(sentSecret as string, runtimeSecretSeed)).resolves.toBe('Alice');
  });

  it('wraps async parameter encoding failures before the driver runs', async () => {
    const failingCodec = codec({
      typeId: 'test/failing-secret@1',
      targetTypes: ['text'],
      runtime: { encode: 'async' } as const,
      encode: async (_value: string) => {
        throw new Error('encrypt failed');
      },
      decode: (wire: string) => wire,
    });
    const { stackInstance, context, driver } = createTestSetup({
      extraCodecs: [failingCodec],
    });
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const plan = createRawExecutionPlan({
      params: ['Alice'],
      meta: {
        target: testContract.target,
        targetFamily: testContract.targetFamily,
        storageHash: testContract.storage.storageHash,
        lane: 'raw',
        paramDescriptors: [
          {
            name: 'secret',
            codecId: 'test/failing-secret@1',
            source: 'dsl' as const,
          },
        ],
      },
    });

    await expect(runtime.execute(plan).toArray()).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      details: expect.objectContaining({
        label: 'secret',
        codec: 'test/failing-secret@1',
      }),
    });
    expect(driver.__spies.rootExecute).not.toHaveBeenCalled();
  });

  it('accepts a generic middleware (no familyId)', () => {
    const { stackInstance, context, driver } = createTestSetup();
    expect(() =>
      createRuntime({
        stackInstance,
        context,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        middleware: [{ name: 'generic' }],
      }),
    ).not.toThrow();
  });

  it('accepts an SQL middleware', () => {
    const { stackInstance, context, driver } = createTestSetup();
    expect(() =>
      createRuntime({
        stackInstance,
        context,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        middleware: [{ name: 'sql-lints', familyId: 'sql' }],
      }),
    ).not.toThrow();
  });

  it('rejects a Mongo middleware with a clear error', () => {
    const { stackInstance, context, driver } = createTestSetup();
    expect(() =>
      createRuntime({
        stackInstance,
        context,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        middleware: [{ name: 'mongo-mw', familyId: 'mongo' }],
      }),
    ).toThrow(
      "Middleware 'mongo-mw' requires family 'mongo' but the runtime is configured for family 'sql'",
    );
  });
});

describe('withTransaction', () => {
  function createRuntimeForTransaction() {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });
    return { runtime, driver };
  }

  it('commits on successful callback and returns the result', async () => {
    const { runtime, driver } = createRuntimeForTransaction();

    const result = await withTransaction(runtime, async (tx) => {
      await tx.execute(createRawExecutionPlan()).toArray();
      return 42;
    });

    expect(result).toBe(42);
    expect(driver.__spies.transactionCommit).toHaveBeenCalledOnce();
    expect(driver.__spies.transactionRollback).not.toHaveBeenCalled();
    expect(driver.__spies.connectionRelease).toHaveBeenCalledOnce();
  });

  it('rolls back on callback error and re-throws', async () => {
    const { runtime, driver } = createRuntimeForTransaction();
    const error = new Error('test error');

    await expect(
      withTransaction(runtime, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(driver.__spies.transactionRollback).toHaveBeenCalledOnce();
    expect(driver.__spies.transactionCommit).not.toHaveBeenCalled();
    expect(driver.__spies.connectionRelease).toHaveBeenCalledOnce();
  });

  it('releases connection after commit', async () => {
    const { runtime, driver } = createRuntimeForTransaction();

    await withTransaction(runtime, async () => 'ok');

    expect(driver.__spies.connectionRelease).toHaveBeenCalledOnce();
  });

  it('releases connection after rollback', async () => {
    const { runtime, driver } = createRuntimeForTransaction();

    await withTransaction(runtime, async () => {
      throw new Error('fail');
    }).catch(() => {});

    expect(driver.__spies.connectionRelease).toHaveBeenCalledOnce();
  });

  it('wraps commit failure and exposes the original error as cause', async () => {
    const { runtime, driver } = createRuntimeForTransaction();
    const commitError = new Error('commit failed');
    driver.__spies.transactionCommit.mockRejectedValueOnce(commitError);

    const result = withTransaction(runtime, async () => 'value');

    await expect(result).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_COMMIT_FAILED',
      cause: commitError,
    });
  });

  it('attempts best-effort rollback after commit fails and releases when it succeeds', async () => {
    const { runtime, driver } = createRuntimeForTransaction();
    const commitError = new Error('commit failed');
    driver.__spies.transactionCommit.mockRejectedValueOnce(commitError);

    await withTransaction(runtime, async () => 'value').catch(() => {});

    expect(driver.__spies.transactionCommit).toHaveBeenCalledOnce();
    expect(driver.__spies.transactionRollback).toHaveBeenCalledOnce();
    // A successful rollback after a failed commit means the server is no
    // longer in a transaction and the connection round-tripped cleanly, so
    // it is safe to return to the pool rather than evict it.
    expect(driver.__spies.connectionRelease).toHaveBeenCalledOnce();
    expect(driver.__spies.connectionDestroy).not.toHaveBeenCalled();
  });

  it('forwards the callback return value', async () => {
    const { runtime } = createRuntimeForTransaction();

    const result = await withTransaction(runtime, async () => ({
      name: 'test',
      count: 3,
    }));

    expect(result).toEqual({ name: 'test', count: 3 });
  });

  it('executes queries against the transaction', async () => {
    const { runtime, driver } = createRuntimeForTransaction();

    await withTransaction(runtime, async (tx) => {
      await tx.execute(createRawExecutionPlan()).toArray();
    });

    expect(driver.__spies.transactionExecute).toHaveBeenCalledOnce();
    expect(driver.__spies.rootExecute).not.toHaveBeenCalled();
    expect(driver.__spies.connectionExecute).not.toHaveBeenCalled();
  });

  it('throws on execute after commit (invalidation)', async () => {
    const { runtime } = createRuntimeForTransaction();
    let savedTx: { execute: (plan: ExecutionPlan) => unknown } | undefined;

    await withTransaction(runtime, async (tx) => {
      savedTx = tx;
    });

    expect(() => savedTx!.execute(createRawExecutionPlan())).toThrow(
      'Cannot read from a query result after the transaction has ended',
    );
  });

  it('throws on iteration of escaped AsyncIterableResult after commit', async () => {
    const { runtime } = createRuntimeForTransaction();

    const escaped = await withTransaction(runtime, async (tx) => {
      return { result: tx.execute(createRawExecutionPlan()) };
    });

    await expect(escaped.result.toArray()).rejects.toThrow(
      'Cannot read from a query result after the transaction has ended',
    );
  });

  it('sets invalidated flag after commit', async () => {
    const { runtime } = createRuntimeForTransaction();
    let txRef: { invalidated: boolean } | undefined;

    await withTransaction(runtime, async (tx) => {
      expect(tx.invalidated).toBe(false);
      txRef = tx;
    });

    expect(txRef!.invalidated).toBe(true);
  });

  it('wraps original error when rollback fails', async () => {
    const { runtime, driver } = createRuntimeForTransaction();
    const callbackError = new Error('callback failed');
    const rollbackError = new Error('rollback failed');
    driver.__spies.transactionRollback.mockRejectedValueOnce(rollbackError);

    const rejection = withTransaction(runtime, async () => {
      throw callbackError;
    });

    await expect(rejection).rejects.toThrow('Transaction rollback failed after callback error');
    await expect(rejection).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
      cause: callbackError,
      details: { rollbackError },
    });
    expect(driver.__spies.connectionDestroy).toHaveBeenCalledOnce();
    expect(driver.__spies.connectionRelease).not.toHaveBeenCalled();
  });

  it('destroys connection when rollback fails even if destroy also fails', async () => {
    const { runtime, driver } = createRuntimeForTransaction();
    const callbackError = new Error('callback failed');
    const rollbackError = new Error('rollback failed');
    const destroyError = new Error('destroy failed');
    driver.__spies.transactionRollback.mockRejectedValueOnce(rollbackError);
    driver.__spies.connectionDestroy.mockRejectedValueOnce(destroyError);

    const rejection = withTransaction(runtime, async () => {
      throw callbackError;
    });

    await expect(rejection).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
      cause: callbackError,
      details: { rollbackError },
    });
    expect(driver.__spies.connectionDestroy).toHaveBeenCalledOnce();
    expect(driver.__spies.connectionRelease).not.toHaveBeenCalled();
  });

  it('destroys connection when commit fails and best-effort rollback also fails', async () => {
    const { runtime, driver } = createRuntimeForTransaction();
    const commitError = new Error('commit failed');
    const rollbackError = new Error('rollback also failed');
    driver.__spies.transactionCommit.mockRejectedValueOnce(commitError);
    driver.__spies.transactionRollback.mockRejectedValueOnce(rollbackError);

    const rejection = withTransaction(runtime, async () => 'value');

    await expect(rejection).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_COMMIT_FAILED',
      cause: commitError,
    });
    expect(driver.__spies.connectionDestroy).toHaveBeenCalledOnce();
    expect(driver.__spies.connectionRelease).not.toHaveBeenCalled();
  });

  it('sets invalidated flag after rollback', async () => {
    const { runtime } = createRuntimeForTransaction();
    let txRef: { invalidated: boolean } | undefined;

    await withTransaction(runtime, async (tx) => {
      txRef = tx;
      throw new Error('fail');
    }).catch(() => {});

    expect(txRef!.invalidated).toBe(true);
  });

  it('releases connection independently across sequential transactions', async () => {
    const { runtime, driver } = createRuntimeForTransaction();

    await withTransaction(runtime, async (tx) => {
      await tx.execute(createRawExecutionPlan()).toArray();
    });

    await withTransaction(runtime, async (tx) => {
      await tx.execute(createRawExecutionPlan()).toArray();
    });

    await withTransaction(runtime, async () => {
      throw new Error('fail');
    }).catch(() => {});

    expect(driver.__spies.connectionRelease).toHaveBeenCalledTimes(3);
    expect(driver.__spies.transactionCommit).toHaveBeenCalledTimes(2);
    expect(driver.__spies.transactionRollback).toHaveBeenCalledTimes(1);
  });
});

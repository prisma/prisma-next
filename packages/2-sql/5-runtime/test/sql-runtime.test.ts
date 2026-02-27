import { coreHash, type ExecutionPlan } from '@prisma-next/contract/types';
import type { ExecutionStackInstance } from '@prisma-next/core-execution-plane/stack';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import type {
  RuntimeDriverInstance,
  RuntimeExtensionInstance,
} from '@prisma-next/core-execution-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  CodecRegistry,
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
import { createRuntime } from '../src/sql-runtime';

const testContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: coreHash('sha256:test'),
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

interface DriverExecuteSpies {
  rootExecute: ReturnType<typeof vi.fn>;
  connectionExecute: ReturnType<typeof vi.fn>;
  transactionExecute: ReturnType<typeof vi.fn>;
}

type MockSqlDriver = SqlDriver & { __spies: DriverExecuteSpies };

function createStubCodecs(): CodecRegistry {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  );
  return registry;
}

function createStubAdapter() {
  const codecs = createStubCodecs();
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
    beginTransaction: vi.fn().mockResolvedValue(transaction),
  };

  const driver: SqlDriver = {
    execute: rootExecute,
    query,
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return Object.assign(driver, {
    __spies: {
      rootExecute,
      connectionExecute,
      transactionExecute,
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
    operationSignatures: () => [],
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
    operationSignatures: () => [],
    parameterizedCodecs: () => [],
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

function createTestSetup() {
  const adapter = createStubAdapter();
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

function createRawExecutionPlan<Row = Record<string, unknown>>(): ExecutionPlan<Row> {
  return {
    sql: 'select 1',
    params: [],
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storageHash,
      lane: 'raw',
      paramDescriptors: [],
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
    expect(runtime.operations).toBeDefined();
    expect(runtime.close).toBeDefined();
  });

  it('returns operations registry', () => {
    const { stackInstance, context, driver } = createTestSetup();

    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const ops = runtime.operations();
    expect(ops).toBeDefined();
    expect(ops.byType).toBeDefined();
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
});

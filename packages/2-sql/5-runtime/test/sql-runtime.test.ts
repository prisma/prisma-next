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

function createMockDriver(): SqlDriver {
  const queryable = {
    execute: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield { id: 1 };
    }),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };

  return {
    ...queryable,
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue({
      ...queryable,
      release: vi.fn().mockResolvedValue(undefined),
      beginTransaction: vi.fn().mockResolvedValue({
        ...queryable,
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
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
});

import {
  createExecutionStack,
  instantiateExecutionStack,
} from '@prisma-next/core-execution-plane/stack';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeTargetDescriptor,
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
import type { SqlRuntimeAdapterInstance, SqlRuntimeDriverInstance } from '../src/sql-context';
import { createExecutionContext } from '../src/sql-context';
import { createRuntime } from '../src/sql-runtime';

// Minimal test contract
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

// Create a stub codec registry
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

// Create a stub adapter
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

// Create a mock driver that implements SqlDriver interface
function createMockDriver(): SqlDriver {
  const execute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    yield { id: 1 };
  });

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    execute,
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestStackInstance() {
  const adapter = createStubAdapter();

  const targetDescriptor: RuntimeTargetDescriptor<'sql', 'postgres'> = {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };

  const adapterDescriptor: RuntimeAdapterDescriptor<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>
  > = {
    kind: 'adapter',
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return Object.assign(
        {
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
        },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };

  const driver = createMockDriver();
  const driverDescriptor: RuntimeDriverDescriptor<
    'sql',
    'postgres',
    SqlRuntimeDriverInstance<'postgres'>
  > = {
    kind: 'driver',
    id: 'test-driver',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return Object.assign(
        {
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
        },
        driver,
      ) as SqlRuntimeDriverInstance<'postgres'>;
    },
  };

  const stack = createExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    driver: driverDescriptor,
    extensionPacks: [],
  });

  const stackInstance = instantiateExecutionStack(stack);
  return { stackInstance, driver };
}

describe('createRuntime', () => {
  it('creates runtime with valid options', () => {
    const { stackInstance } = createTestStackInstance();
    const context = createExecutionContext({
      contract: testContract,
      stack: stackInstance,
    });

    const runtime = createRuntime({
      stack: stackInstance,
      contract: testContract,
      context,
      driverOptions: {},
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    expect(runtime).toBeDefined();
    expect(runtime.execute).toBeDefined();
    expect(runtime.telemetry).toBeDefined();
    expect(runtime.operations).toBeDefined();
    expect(runtime.close).toBeDefined();
  });

  it('returns operations registry', () => {
    const { stackInstance } = createTestStackInstance();

    const runtime = createRuntime({
      stack: stackInstance,
      contract: testContract,
      driverOptions: {},
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const ops = runtime.operations();
    expect(ops).toBeDefined();
    expect(ops.byType).toBeDefined();
  });

  it('returns null telemetry when no events', () => {
    const { stackInstance } = createTestStackInstance();

    const runtime = createRuntime({
      stack: stackInstance,
      contract: testContract,
      driverOptions: {},
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    // Before any execution, telemetry should be null
    expect(runtime.telemetry()).toBeNull();
  });

  it('closes runtime', async () => {
    const { stackInstance, driver } = createTestStackInstance();

    const runtime = createRuntime({
      stack: stackInstance,
      contract: testContract,
      driverOptions: {},
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    await runtime.close();
    expect(driver.close).toHaveBeenCalled();
  });
});

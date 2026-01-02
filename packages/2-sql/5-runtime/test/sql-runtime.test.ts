import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry, SelectAst, SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { createRuntime, type RuntimeContext } from '../src/exports';

// Minimal test contract
const testContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  coreHash: 'sha256:test',
  models: {},
  relations: {},
  storage: { tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {},
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

// Create a mock driver
function createMockDriver(): SqlDriver {
  const execute = vi.fn().mockImplementation(async function* () {
    yield { id: 1 };
  });

  return {
    execute,
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Create a test runtime context
function createTestContext(contract: SqlContract<SqlStorage>): RuntimeContext<typeof contract> {
  const adapter = createStubAdapter();
  return {
    contract,
    adapter,
    codecs: adapter.profile.codecs(),
    operations: {
      register: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      byType: vi.fn().mockReturnValue([]),
      byMethod: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
    },
  };
}

describe('createRuntime', () => {
  it('creates runtime with valid options', () => {
    const context = createTestContext(testContract);
    const driver = createMockDriver();

    const runtime = createRuntime({
      context,
      driver,
      verify: { mode: 'never' },
    });

    expect(runtime).toBeDefined();
    expect(runtime.execute).toBeDefined();
    expect(runtime.telemetry).toBeDefined();
    expect(runtime.operations).toBeDefined();
    expect(runtime.close).toBeDefined();
  });

  it('returns operations registry', () => {
    const context = createTestContext(testContract);
    const driver = createMockDriver();

    const runtime = createRuntime({
      context,
      driver,
      verify: { mode: 'never' },
    });

    const ops = runtime.operations();
    expect(ops).toBeDefined();
    expect(ops.all).toBeDefined();
  });

  it('returns null telemetry when no events', () => {
    const context = createTestContext(testContract);
    const driver = createMockDriver();

    const runtime = createRuntime({
      context,
      driver,
      verify: { mode: 'never' },
    });

    // Before any execution, telemetry should be null
    expect(runtime.telemetry()).toBeNull();
  });

  it('closes runtime', async () => {
    const context = createTestContext(testContract);
    const driver = createMockDriver();

    const runtime = createRuntime({
      context,
      driver,
      verify: { mode: 'never' },
    });

    await runtime.close();
    expect(driver.close).toHaveBeenCalled();
  });
});

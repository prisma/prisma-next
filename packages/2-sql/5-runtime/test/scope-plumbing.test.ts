import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  CodecRegistry,
  SqlDriver,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry, type SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { createRuntime } from '../src/sql-runtime';

/**
 * Verifies the SQL runtime populates `RuntimeMiddlewareContext.scope`
 * differently for the three queryable surfaces: top-level `runtime.execute`,
 * `connection.execute` (after `runtime.connection()`), and
 * `transaction.execute` (after `connection.transaction()` or
 * `withTransaction`).
 *
 * The cache middleware (TML-2143 M3) reads `ctx.scope` to bypass caching on
 * connection / transaction scopes; this test pins the contract so a
 * regression in scope plumbing surfaces here rather than via a confusing
 * cache-coherence bug.
 */

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
      readMarkerStatement() {
        return {
          sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta from prisma_contract.marker where id = $1',
          params: [1],
        };
      },
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createMockDriver(): SqlDriver {
  const transaction = {
    execute: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield { id: 3 } as Record<string, unknown>;
    }),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  const connection = {
    execute: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield { id: 2 } as Record<string, unknown>;
    }),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn().mockResolvedValue(transaction),
  };
  return {
    execute: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield { id: 1 } as Record<string, unknown>;
    }),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
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

function createTestSetup(middleware: readonly SqlMiddleware[]) {
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

  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
    middleware,
  });

  return { runtime };
}

function createRawExecutionPlan(): SqlExecutionPlan {
  return {
    sql: 'select 1',
    params: [],
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
      paramDescriptors: [],
    },
  };
}

describe('SQL runtime scope plumbing', () => {
  it('populates ctx.scope = "runtime" on top-level runtime.execute', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeExecute(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    await runtime.execute(createRawExecutionPlan()).toArray();

    expect(seen).toEqual(['runtime']);
  });

  it('populates ctx.scope = "connection" on connection.execute', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeExecute(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const connection = await runtime.connection();
    try {
      await connection.execute(createRawExecutionPlan()).toArray();
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['connection']);
  });

  it('populates ctx.scope = "transaction" on transaction.execute', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeExecute(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const connection = await runtime.connection();
    const transaction = await connection.transaction();
    try {
      await transaction.execute(createRawExecutionPlan()).toArray();
      await transaction.commit();
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['transaction']);
  });

  it('routes a sequence of executes to the right scope each time', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeExecute(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);

    // Top-level.
    await runtime.execute(createRawExecutionPlan()).toArray();

    // Connection-scoped.
    const connection = await runtime.connection();
    await connection.execute(createRawExecutionPlan()).toArray();

    // Transaction-scoped.
    const transaction = await connection.transaction();
    await transaction.execute(createRawExecutionPlan()).toArray();
    await transaction.commit();
    await connection.release();

    // And another top-level after returning the connection to the pool.
    await runtime.execute(createRawExecutionPlan()).toArray();

    expect(seen).toEqual(['runtime', 'connection', 'transaction', 'runtime']);
  });
});

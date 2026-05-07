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
import {
  codec,
  createCodecRegistry,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { parseContractMarkerRow } from '../src/marker';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { createRuntime } from '../src/sql-runtime';

/**
 * Pins the ordering invariant from spec AC L239: marker verification runs
 * upstream of `runWithMiddleware`, so a hash-mismatched query throws
 * `CONTRACT.MARKER_MISMATCH` before any `intercept` hook can answer it.
 *
 * If a future refactor moves marker verification into the orchestrator,
 * this test fails — surfacing the regression that would otherwise let a
 * cache hit serve stale-schema results.
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

function createCodecs(): CodecRegistry {
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

function createStubAdapter(codecs: CodecRegistry) {
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
          sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from prisma_contract.marker where space = $1',
          params: ['app'],
        };
      },
      parseMarkerRow: parseContractMarkerRow,
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createStaleMarkerDriver(): SqlDriver {
  // Driver returns a marker row with a `core_hash` that does not match the
  // contract's `storage.storageHash`, simulating a database whose schema is
  // out of date relative to the running runtime.
  const query = vi.fn().mockResolvedValue({
    rows: [
      {
        core_hash: 'sha256:stale',
        profile_hash: 'sha256:test',
        contract_json: null,
        canonical_version: 1,
        updated_at: new Date('2026-01-01T00:00:00Z'),
        app_tag: null,
        meta: null,
        invariants: [],
      },
    ],
    rowCount: 1,
  });

  const execute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    yield {} as Record<string, unknown>;
  });

  return {
    execute,
    query,
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockRejectedValue(new Error('not used in this test')),
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
  const codecs = createCodecs();
  const adapter = createStubAdapter(codecs);
  const driver = createStaleMarkerDriver();

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
    verify: { mode: 'always', requireMarker: true },
    middleware,
  });

  return { runtime, driver };
}

function createPlan(): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('users'));
  return {
    sql: 'select * from users',
    params: [],
    ast,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

describe('marker verification runs before intercept', () => {
  it('throws CONTRACT.MARKER_MISMATCH and never invokes the interceptor when the marker is stale', async () => {
    const intercept = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    const interceptor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      intercept,
    };

    const { runtime, driver } = createTestSetup([interceptor]);

    await expect(runtime.execute(createPlan()).toArray()).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_MISMATCH',
      category: 'CONTRACT',
    });

    expect(intercept).not.toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();
  });
});

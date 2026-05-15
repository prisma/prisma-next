import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Codec,
  MarkerReadResult,
  SqlDriver,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import { SelectAst, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { createRuntime } from '../src/sql-runtime';
import { defineTestCodec } from './test-codec';
import { descriptorsFromCodecs } from './utils';

/**
 * Pins the per-result-kind branches of `verifyMarker` in `sql-runtime.ts`: missing marker (with `requireMarker: true`), missing marker tolerated (with `requireMarker: false`), and profile-hash mismatch. Storage-hash mismatch is covered by `marker-vs-intercept-ordering.test.ts`.
 */

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('sha256:test-profile'),
  models: {},
  roots: {},
  storage: new SqlStorage({ storageHash: coreHash('sha256:test'), tables: {} }),
  extensionPacks: {},
  capabilities: {},
  meta: {},
};

function createCodecs(): ReadonlyArray<Codec<string>> {
  return [
    defineTestCodec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  ];
}

function markerRecord(overrides: Partial<ContractMarkerRecord> = {}): ContractMarkerRecord {
  return {
    storageHash: 'sha256:test',
    profileHash: 'sha256:test-profile',
    contractJson: null,
    canonicalVersion: 1,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    appTag: null,
    meta: {},
    invariants: [],
    ...overrides,
  };
}

function createStubAdapter(codecs: ReadonlyArray<Codec<string>>, markerResult: MarkerReadResult) {
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
      readMarker: async () => markerResult,
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createDriver(): SqlDriver {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const execute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    yield {} as Record<string, unknown>;
  });
  const executePrepared = vi.fn().mockImplementation(async function* () {
    yield {} as Record<string, unknown>;
  });
  return {
    execute,
    executePrepared,
    query,
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockRejectedValue(new Error('not used in this test')),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.profile.codecs());
  return {
    kind: 'adapter',
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

type SqlTestStackInstance = ExecutionStackInstance<
  'sql',
  'postgres',
  SqlRuntimeAdapterInstance<'postgres'>,
  RuntimeDriverInstance<'sql', 'postgres'>,
  RuntimeExtensionInstance<'sql', 'postgres'>
>;

interface RuntimeOptions {
  readonly markerResult: MarkerReadResult;
  readonly verifyMode: 'always' | 'startup' | 'onFirstUse';
  readonly requireMarker: boolean;
  readonly driver?: SqlDriver;
}

function buildRuntime({ markerResult, verifyMode, requireMarker, driver }: RuntimeOptions) {
  const codecs = createCodecs();
  const adapter = createStubAdapter(codecs, markerResult);
  const target = createTargetDescriptor();
  const adapterDesc = createAdapterDescriptor(adapter);
  const stack = createSqlExecutionStack({
    target,
    adapter: adapterDesc,
    extensionPacks: [],
  });
  const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;
  const context = createExecutionContext({
    contract: testContract,
    stack: { target, adapter: adapterDesc, extensionPacks: [] },
  });
  return createRuntime({
    stackInstance,
    context,
    driver: driver ?? createDriver(),
    verify: { mode: verifyMode, requireMarker },
  });
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

describe('verifyMarker', () => {
  it('throws CONTRACT.MARKER_MISSING when the marker is absent and requireMarker is true', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'absent' },
      verifyMode: 'always',
      requireMarker: true,
    });

    await expect(runtime.execute(createPlan()).toArray()).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_MISSING',
      category: 'CONTRACT',
    });
  });

  it('throws CONTRACT.MARKER_MISSING when the marker table is missing and requireMarker is true', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'no-table' },
      verifyMode: 'always',
      requireMarker: true,
    });

    await expect(runtime.execute(createPlan()).toArray()).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_MISSING',
    });
  });

  it('caches verification past the first execute when mode is "startup"', async () => {
    const readMarker = vi.fn(async () => ({ kind: 'present', record: markerRecord() }) as const);
    const codecs = createCodecs();
    const target = createTargetDescriptor();
    const adapter = {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      profile: {
        id: 'test-profile',
        target: 'postgres',
        capabilities: {},
        codecs: () => codecs,
        readMarker,
      },
      lower(ast: SelectAst) {
        return Object.freeze({ sql: JSON.stringify(ast), params: [] });
      },
    };
    const adapterDesc = createAdapterDescriptor(adapter);
    const stack = createSqlExecutionStack({
      target,
      adapter: adapterDesc,
      extensionPacks: [],
    });
    const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;
    const context = createExecutionContext({
      contract: testContract,
      stack: { target, adapter: adapterDesc, extensionPacks: [] },
    });
    const runtime = createRuntime({
      stackInstance,
      context,
      driver: createDriver(),
      verify: { mode: 'startup', requireMarker: false },
    });

    await runtime.execute(createPlan()).toArray();
    await runtime.execute(createPlan()).toArray();

    expect(readMarker).toHaveBeenCalledTimes(1);
  });

  it('skips verification when the marker is absent and requireMarker is false', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'absent' },
      verifyMode: 'always',
      requireMarker: false,
    });

    const rows = await runtime.execute(createPlan()).toArray();
    expect(rows).toBeDefined();
  });

  it('skips verification when the marker table is missing and requireMarker is false', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'no-table' },
      verifyMode: 'always',
      requireMarker: false,
    });

    const rows = await runtime.execute(createPlan()).toArray();
    expect(rows).toBeDefined();
  });

  it('passes verification when the marker record matches contract storage and profile hash', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'present', record: markerRecord() },
      verifyMode: 'always',
      requireMarker: true,
    });

    const rows = await runtime.execute(createPlan()).toArray();
    expect(rows).toBeDefined();
  });

  it('throws CONTRACT.MARKER_MISMATCH when the database profile hash differs from the contract', async () => {
    const runtime = buildRuntime({
      markerResult: {
        kind: 'present',
        record: markerRecord({ profileHash: 'sha256:other-profile' }),
      },
      verifyMode: 'always',
      requireMarker: true,
    });

    await expect(runtime.execute(createPlan()).toArray()).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_MISMATCH',
      details: expect.objectContaining({
        expectedProfile: 'sha256:test-profile',
        actualProfile: 'sha256:other-profile',
      }),
    });
  });
});

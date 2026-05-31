import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import type { RuntimeLog } from '@prisma-next/framework-components/runtime';
import { SqlStorage, SqlUnboundNamespace } from '@prisma-next/sql-contract/types';
import type {
  Codec,
  MarkerReadResult,
  SqlDriver,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import { SelectAst, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { applicationDomainOf } from '@prisma-next/test-utils';
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
 * Pins the per-result-kind branches of `verifyMarker` in `sql-runtime.ts`: absent marker
 * (warns CONTRACT.MARKER_MISSING), missing table (warns CONTRACT.MARKER_MISSING), storage-hash
 * mismatch (warns CONTRACT.MARKER_MISMATCH), profile-hash mismatch (warns CONTRACT.MARKER_MISMATCH),
 * matching marker (silent), verifyMarker: false (reader never called), and one-shot semantics
 * (at most one log per runtime lifetime).
 *
 * Storage-hash mismatch ordering against middleware intercepts is covered by
 * `marker-vs-intercept-ordering.test.ts`.
 */

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('sha256:test-profile'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('sha256:test'),
    namespaces: { __unbound__: SqlUnboundNamespace.instance },
  }),
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

function createStubAdapter(
  codecs: ReadonlyArray<Codec<string>>,
  markerResult: MarkerReadResult,
  readMarkerSpy?: ReturnType<typeof vi.fn>,
) {
  const readMarkerImpl = async () => markerResult;
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
      readMarker: readMarkerSpy ?? readMarkerImpl,
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
    rawCodecInferer: { inferCodec: () => 'pg/text' },
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

interface BuildRuntimeOptions {
  readonly markerResult: MarkerReadResult;
  readonly verifyMarker?: 'onFirstUse' | false;
  readonly log?: RuntimeLog;
  readonly driver?: SqlDriver;
  readonly readMarkerSpy?: ReturnType<typeof vi.fn>;
}

function buildRuntime({
  markerResult,
  verifyMarker,
  log,
  driver,
  readMarkerSpy,
}: BuildRuntimeOptions) {
  const codecs = createCodecs();
  const adapter = createStubAdapter(codecs, markerResult, readMarkerSpy);
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
    ...(verifyMarker !== undefined ? { verifyMarker } : {}),
    ...(log ? { log } : {}),
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
  it('warns with CONTRACT.MARKER_MISSING when the marker is absent', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({ markerResult: { kind: 'absent' }, log });

    await runtime.execute(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISSING',
        scope: 'marker-verification',
        expected: {
          storageHash: 'sha256:test',
          profileHash: 'sha256:test-profile',
        },
        actual: null,
      }),
    );
  });

  it('warns with CONTRACT.MARKER_MISSING when the marker table is missing', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({ markerResult: { kind: 'no-table' }, log });

    await runtime.execute(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISSING',
        scope: 'marker-verification',
        actual: null,
      }),
    );
  });

  it('emits no log when the marker record matches the contract', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'present', record: markerRecord() },
      log,
    });

    await runtime.execute(createPlan()).toArray();

    expect(log.warn).not.toHaveBeenCalled();
  });

  it('warns with CONTRACT.MARKER_MISMATCH when the storage hash differs', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: {
        kind: 'present',
        record: markerRecord({ storageHash: 'sha256:stale' }),
      },
      log,
    });

    await runtime.execute(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISMATCH',
        scope: 'marker-verification',
        expected: {
          storageHash: 'sha256:test',
          profileHash: 'sha256:test-profile',
        },
        actual: expect.objectContaining({ storageHash: 'sha256:stale' }),
      }),
    );
  });

  it('warns with CONTRACT.MARKER_MISMATCH when the profile hash differs', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: {
        kind: 'present',
        record: markerRecord({ profileHash: 'sha256:other-profile' }),
      },
      log,
    });

    await runtime.execute(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISMATCH',
        scope: 'marker-verification',
        expected: expect.objectContaining({ profileHash: 'sha256:test-profile' }),
        actual: expect.objectContaining({ profileHash: 'sha256:other-profile' }),
      }),
    );
  });

  it('skips the marker reader entirely when verifyMarker is false', async () => {
    const readMarkerSpy = vi.fn().mockResolvedValue({ kind: 'present', record: markerRecord() });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'present', record: markerRecord() },
      verifyMarker: false,
      log,
      readMarkerSpy,
    });

    await runtime.execute(createPlan()).toArray();
    await runtime.execute(createPlan()).toArray();

    expect(readMarkerSpy).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('emits at most one warning per runtime lifetime regardless of query count', async () => {
    const readMarkerSpy = vi.fn().mockResolvedValue({ kind: 'absent' });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'absent' },
      log,
      readMarkerSpy,
    });

    await runtime.execute(createPlan()).toArray();
    await runtime.execute(createPlan()).toArray();
    await runtime.execute(createPlan()).toArray();

    expect(readMarkerSpy).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('single-flights the marker read under concurrent first queries', async () => {
    // Hold the marker read open until we have N concurrent execute() calls
    // sitting at the verifyMarker gate. Without single-flight, each one would
    // call readMarker() and emit a log line independently.
    let releaseMarker: (result: MarkerReadResult) => void = () => {};
    const markerPromise = new Promise<MarkerReadResult>((resolve) => {
      releaseMarker = resolve;
    });
    const readMarkerSpy = vi.fn().mockImplementation(() => markerPromise);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'absent' },
      log,
      readMarkerSpy,
    });

    const inflight = [
      runtime.execute(createPlan()).toArray(),
      runtime.execute(createPlan()).toArray(),
      runtime.execute(createPlan()).toArray(),
      runtime.execute(createPlan()).toArray(),
    ];

    releaseMarker({ kind: 'absent' });
    await Promise.all(inflight);

    expect(readMarkerSpy).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

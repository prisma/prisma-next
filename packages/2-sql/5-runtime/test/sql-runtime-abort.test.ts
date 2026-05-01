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
  Codec,
  CodecRegistry,
  SqlCodecCallContext,
  SqlDriver,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import {
  ColumnRef,
  codec,
  createCodecRegistry,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { parseContractMarkerRow } from '../src/marker';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { createRuntime } from '../src/sql-runtime';

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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createStubCodecs(extras: readonly Codec<string>[] = []): CodecRegistry {
  const registry = createCodecRegistry();
  for (const c of extras) registry.register(c);
  return registry;
}

interface DriverOptions {
  rows?: readonly Record<string, unknown>[];
  rowGate?: () => Promise<void>;
}

function createControlledDriver(options?: DriverOptions): SqlDriver & {
  __executeMock: ReturnType<typeof vi.fn>;
} {
  const rows = options?.rows ?? [{ id: 1 }];
  const rowGate = options?.rowGate;

  const execute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    for (const row of rows) {
      if (rowGate) await rowGate();
      yield row;
    }
  });

  const driver: SqlDriver = {
    execute,
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue({
      execute,
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      beginTransaction: vi.fn(),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return Object.assign(driver, { __executeMock: execute });
}

function createStubAdapter(extraCodecs: readonly Codec<string>[] = []) {
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
        return { sql: 'select 1', params: [] };
      },
      parseMarkerRow: parseContractMarkerRow,
    },
    lower(ast: unknown) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createTestSetup(extras: readonly Codec<string>[] = [], driverOptions?: DriverOptions) {
  const adapter = createStubAdapter(extras);
  const driver = createControlledDriver(driverOptions);

  const targetDescriptor: SqlRuntimeTargetDescriptor<'postgres'> = {
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

  const codecRegistry = adapter.profile.codecs();
  const adapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres'> = {
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

function rawExecutionPlan(overrides?: Partial<SqlExecutionPlan>): SqlExecutionPlan {
  return {
    sql: 'select 1',
    params: [],
    ...overrides,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
      ...overrides?.meta,
    },
  };
}

function projectingExecutionPlan(
  alias: string,
  table: string,
  column: string,
  codecId: string,
): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named(table)).withProjection([
    ProjectionItem.of(alias, ColumnRef.of(table, column), codecId),
  ]);
  return {
    sql: 'select 1',
    params: [],
    ast,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'dsl',
    },
  };
}

describe('SqlRuntimeImpl.execute({ signal }) — abort semantics', () => {
  it('regression — omitting options is bit-for-bit identical to today (no signal supplied)', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });
    const rows = await runtime.execute(rawExecutionPlan()).toArray();
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('already-aborted signal at entry rejects on first next() with RUNTIME.ABORTED { phase: stream }', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const controller = new AbortController();
    const reason = new Error('caller aborted before execute');
    controller.abort(reason);

    await expect(
      runtime.execute(rawExecutionPlan(), { signal: controller.signal }).toArray(),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });

    expect(driver.__executeMock).not.toHaveBeenCalled();
  });

  it('between-rows abort exits the stream loop with RUNTIME.ABORTED { phase: stream } before pulling the next row', async () => {
    const yieldGate = deferred<void>();
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    let yielded = 0;
    const driverOptions: DriverOptions = {
      rows,
      rowGate: async () => {
        if (yielded === 1) {
          // After the first row, hold the next yield until released.
          await yieldGate.promise;
        }
        yielded += 1;
      },
    };

    const { stackInstance, context, driver } = createTestSetup([], driverOptions);
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const controller = new AbortController();
    const reason = new Error('mid-stream abort');

    const result = runtime.execute(rawExecutionPlan(), {
      signal: controller.signal,
    });
    const collected: unknown[] = [];
    const collector = (async () => {
      for await (const row of result) {
        collected.push(row);
        if (collected.length === 1) {
          // Simulate user cancellation between rows.
          controller.abort(reason);
          // Release the driver's next yield so the gate doesn't deadlock.
          yieldGate.resolve();
        }
      }
    })();

    await expect(collector).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });
    expect(collected).toEqual([{ id: 1 }]);
  });

  it('codec forwarding ctx.signal observes downstream abort (HTTPS-style cancellation)', async () => {
    let abortObservedByCodec = false;
    const blockingDecodeStarted = deferred<void>();
    const codecAbortObserved = deferred<void>();

    const observingCodec = codec({
      typeId: 'test/observe-signal@1',
      targetTypes: ['text'],
      encode: (v: string) => v,
      decode: async (w: string, ctx?: SqlCodecCallContext) => {
        // Mimic an SDK that registers an abort listener on the supplied
        // signal. The runtime threads the same AbortSignal into every codec
        // call; codec authors who forward it observe true cancellation.
        await new Promise<string>((_resolve, reject) => {
          if (ctx?.signal) {
            ctx.signal.addEventListener('abort', () => {
              abortObservedByCodec = true;
              codecAbortObserved.resolve();
              reject(ctx.signal?.reason);
            });
          }
          // Hold the decode open so the abort fires while we're inside it.
          blockingDecodeStarted.resolve();
          // Never resolves; the abort listener will reject this promise.
        });
        return w;
      },
    });

    const { stackInstance, context, driver } = createTestSetup([observingCodec]);
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const plan = projectingExecutionPlan('name', 'users', 'name', 'test/observe-signal@1');
    driver.__executeMock.mockImplementationOnce(async function* () {
      yield { name: 'alice' };
    });

    const controller = new AbortController();
    const collector = runtime.execute(plan, { signal: controller.signal }).toArray();

    await blockingDecodeStarted.promise;
    controller.abort(new Error('forwarded'));
    await codecAbortObserved.promise;

    await expect(collector).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'decode' },
    });
    expect(abortObservedByCodec).toBe(true);
  });

  it('codec ignoring ctx.signal does not block runtime — RUNTIME.ABORTED still surfaces (cooperative cancellation)', async () => {
    const decodeStarted = deferred<void>();
    const release = deferred<string>();
    const ignoringCodec = codec({
      typeId: 'test/ignore-signal@1',
      targetTypes: ['text'],
      encode: (v: string) => v,
      decode: async (w: string) => {
        // Signal we're inside the decode body and deliberately ignore ctx.signal.
        decodeStarted.resolve();
        const suffix = await release.promise;
        return `${w}:${suffix}`;
      },
    });

    const { stackInstance, context, driver } = createTestSetup([ignoringCodec]);
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const plan = projectingExecutionPlan('name', 'users', 'name', 'test/ignore-signal@1');
    driver.__executeMock.mockImplementationOnce(async function* () {
      yield { name: 'alice' };
    });

    const controller = new AbortController();
    const reason = new Error('runtime aborted while codec body still running');
    const collector = runtime.execute(plan, { signal: controller.signal }).toArray();

    // Wait until the decode body has actually started (we're now mid-decode);
    // then abort. The race in raceAgainstAbort surfaces RUNTIME.ABORTED with
    // phase: 'decode', even though the codec body is still running and does
    // not honour the signal.
    await decodeStarted.promise;
    controller.abort(reason);

    await expect(collector).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'decode' },
      cause: reason,
    });

    // The codec body completes in the background; cleanup so the test exits.
    release.resolve('done');
  });
});

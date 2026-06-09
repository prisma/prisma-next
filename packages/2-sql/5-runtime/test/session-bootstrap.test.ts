import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import type { RuntimeExecuteOptions } from '@prisma-next/framework-components/runtime';
import { SqlStorage, SqlUnboundNamespace } from '@prisma-next/sql-contract/types';
import type {
  Codec,
  SelectAst,
  SqlDriver,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import type { RawSessionConnection, RuntimeOptions } from '../src/sql-runtime';
import { SqlRuntime } from '../src/sql-runtime';
import { defineTestCodec } from './test-codec';
import { descriptorsFromCodecs, stubAst } from './utils';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('sha256:session-bootstrap-test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('sha256:session-bootstrap-test'),
    namespaces: { __unbound__: SqlUnboundNamespace.instance },
  }),
  extensionPacks: {},
  capabilities: {},
  meta: {},
};

function createStubAdapter() {
  const codecs: ReadonlyArray<Codec<string>> = [
    defineTestCodec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  ];

  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    __codecs: codecs,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst) {
      const params = [...new Set(ast.collectParamRefs())].map((ref) =>
        ref.kind === 'prepared-param-ref'
          ? { kind: 'bind' as const, name: ref.name }
          : { kind: 'literal' as const, value: ref.value },
      );
      return Object.freeze({ sql: JSON.stringify(ast), params });
    },
  };
}

interface RecordingTransaction {
  readonly id: symbol;
  readonly queryCalls: Array<{ sql: string; params: readonly unknown[] | undefined }>;
  execute: ReturnType<typeof vi.fn>;
  executePrepared: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
}

interface RecordingConnection {
  readonly id: symbol;
  readonly beginTransactionSpy: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  executePrepared: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  beginTransaction(): Promise<RecordingTransaction>;
  readonly transaction: RecordingTransaction;
}

interface RecordingDriver {
  readonly acquireConnectionSpy: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  executePrepared: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  acquireConnection(): Promise<RecordingConnection>;
  readonly connection: RecordingConnection;
}

function createRecordingDriver(
  txExecuteRows: readonly Record<string, unknown>[] = [{ id: 42 }],
): RecordingDriver {
  const txId = Symbol('transaction');
  const connId = Symbol('connection');

  const txQueryCalls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

  const transaction: RecordingTransaction = {
    id: txId,
    get queryCalls() {
      return txQueryCalls;
    },
    execute: vi.fn().mockImplementation(async function* (_req: SqlExecuteRequest) {
      for (const row of txExecuteRows) yield row;
    }),
    executePrepared: vi.fn().mockImplementation(async function* () {}),
    query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
      txQueryCalls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };

  const beginTransactionSpy = vi.fn().mockResolvedValue(transaction);
  const connection: RecordingConnection = {
    id: connId,
    beginTransactionSpy,
    get transaction() {
      return transaction;
    },
    execute: vi.fn().mockImplementation(async function* () {}),
    executePrepared: vi.fn().mockImplementation(async function* () {}),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: () => beginTransactionSpy(),
  };

  const acquireConnectionSpy = vi.fn().mockResolvedValue(connection);

  const driver: RecordingDriver = {
    acquireConnectionSpy,
    get connection() {
      return connection;
    },
    execute: vi.fn().mockImplementation(async function* () {}),
    executePrepared: vi.fn().mockImplementation(async function* () {}),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    acquireConnection: () => acquireConnectionSpy(),
  };

  return driver;
}

function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
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

function createTestAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  return {
    kind: 'adapter',
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptorsFromCodecs(adapter.__codecs),
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

class TestableRuntime extends SqlRuntime {
  runSessionBootstrap<Row>(
    plan: SqlExecutionPlan<Row>,
    bootstrap: (conn: RawSessionConnection) => Promise<void>,
    options?: RuntimeExecuteOptions,
  ) {
    return this.executeWithSessionBootstrap(plan, bootstrap, options);
  }
}

function createTestSetup(options?: {
  driver?: RecordingDriver;
  middleware?: readonly SqlMiddleware[];
  txExecuteRows?: readonly Record<string, unknown>[];
}) {
  const adapter = createStubAdapter();
  const driver = options?.driver ?? createRecordingDriver(options?.txExecuteRows);

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
  const stackInstance = instantiateExecutionStack(stack) as unknown as SqlTestStackInstance;

  const context = createExecutionContext({
    contract: testContract,
    stack: { target: targetDescriptor, adapter: adapterDescriptor, extensionPacks: [] },
  });

  const runtimeOptions: RuntimeOptions = {
    context,
    adapter: stackInstance.adapter,
    driver: driver as unknown as SqlDriver,
    verifyMarker: false,
    middleware: options?.middleware ?? [],
  };

  const runtime = new TestableRuntime(runtimeOptions);

  return { runtime, driver };
}

function createRawExecutionPlan<Row = Record<string, unknown>>(
  overrides?: Partial<SqlExecutionPlan<Row>>,
): SqlExecutionPlan<Row> {
  return {
    sql: 'select 1',
    params: [],
    ast: stubAst(),
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

describe('executeWithSessionBootstrap', () => {
  describe('stickiness', () => {
    it('bootstrap and typed query run on the same transaction instance', async () => {
      const { runtime, driver } = createTestSetup();
      const seenInBootstrap: symbol[] = [];
      const seenInTypedQuery: symbol[] = [];

      driver.connection.transaction.query = vi
        .fn()
        .mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          seenInBootstrap.push(driver.connection.transaction.id);
          driver.connection.transaction.queryCalls.push({ sql, params });
          return { rows: [], rowCount: 0 };
        }) as ReturnType<typeof vi.fn>;

      driver.connection.transaction.execute = vi.fn().mockImplementation(async function* (
        this: unknown,
      ) {
        seenInTypedQuery.push(driver.connection.transaction.id);
        yield { id: 42 };
      }) as ReturnType<typeof vi.fn>;

      await runtime
        .runSessionBootstrap(createRawExecutionPlan(), async (conn) => {
          await conn.query('SET LOCAL role = $1', ['app_user']);
        })
        .toArray();

      expect(seenInBootstrap).toHaveLength(1);
      expect(seenInTypedQuery).toHaveLength(1);
      expect(seenInBootstrap[0]).toBe(seenInTypedQuery[0]);
    });

    it('bootstrap queries are issued against the transaction, not the connection directly', async () => {
      const { runtime, driver } = createTestSetup();
      const bootstrapSqls: string[] = [];

      driver.connection.transaction.query = vi
        .fn()
        .mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          bootstrapSqls.push(sql);
          driver.connection.transaction.queryCalls.push({ sql, params });
          return { rows: [], rowCount: 0 };
        }) as ReturnType<typeof vi.fn>;

      await runtime
        .runSessionBootstrap(createRawExecutionPlan(), async (conn) => {
          await conn.query('SET LOCAL role = $1', ['viewer']);
        })
        .toArray();

      expect(bootstrapSqls).toEqual(['SET LOCAL role = $1']);
      expect(driver.connection.query).not.toHaveBeenCalledWith(
        'SET LOCAL role = $1',
        expect.anything(),
      );
    });
  });

  describe('below-middleware', () => {
    it('middleware observes the typed execute but not the bootstrap query', async () => {
      const observedSqls: string[] = [];
      const observer: SqlMiddleware = {
        name: 'sql-observer',
        familyId: 'sql',
        beforeExecute(exec) {
          observedSqls.push(exec.sql);
        },
      };

      const { runtime } = createTestSetup({ middleware: [observer] });

      await runtime
        .runSessionBootstrap(
          createRawExecutionPlan({ sql: 'select 1 from users' }),
          async (conn) => {
            await conn.query('SET LOCAL role = $1', ['app_user']);
          },
        )
        .toArray();

      expect(observedSqls).toEqual(['select 1 from users']);
    });

    it('middleware beforeExecute fires once for the typed query, never for bootstrap', async () => {
      const beforeExecuteCalls: string[] = [];
      const observer: SqlMiddleware = {
        name: 'before-execute-observer',
        familyId: 'sql',
        async beforeExecute(plan, _ctx) {
          beforeExecuteCalls.push(plan.sql);
        },
      };

      const { runtime } = createTestSetup({ middleware: [observer] });

      await runtime
        .runSessionBootstrap(
          createRawExecutionPlan({ sql: 'select name from users' }),
          async (conn) => {
            await conn.query('SET LOCAL role = $1', ['app_user']);
            await conn.query('SET LOCAL app.tenant_id = $1', ['tenant-1']);
          },
        )
        .toArray();

      expect(beforeExecuteCalls).toEqual(['select name from users']);
    });
  });

  describe('lifecycle', () => {
    it('commits and releases after successful stream drain', async () => {
      const { runtime, driver } = createTestSetup();

      await runtime.runSessionBootstrap(createRawExecutionPlan(), async () => {}).toArray();

      expect(driver.connection.transaction.commit).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.rollback).not.toHaveBeenCalled();
      expect(driver.connection.release).toHaveBeenCalledOnce();
      expect(driver.connection.destroy).not.toHaveBeenCalled();
    });

    it('rolls back and releases when bootstrap throws, no typed query runs', async () => {
      const { runtime, driver } = createTestSetup();
      const bootstrapError = new Error('bootstrap failed');

      await expect(
        runtime
          .runSessionBootstrap(createRawExecutionPlan(), async () => {
            throw bootstrapError;
          })
          .toArray(),
      ).rejects.toBe(bootstrapError);

      expect(driver.connection.transaction.commit).not.toHaveBeenCalled();
      expect(driver.connection.transaction.rollback).toHaveBeenCalledOnce();
      expect(driver.connection.release).toHaveBeenCalledOnce();
      expect(driver.connection.destroy).not.toHaveBeenCalled();
      expect(driver.connection.transaction.execute).not.toHaveBeenCalled();
    });

    it('rolls back and releases when typed query throws mid-stream', async () => {
      const streamError = new Error('stream error');
      const driver = createRecordingDriver();
      driver.connection.transaction.execute = vi.fn().mockImplementation(async function* () {
        yield { id: 1 };
        throw streamError;
      });

      const { runtime } = createTestSetup({ driver });

      await expect(
        runtime.runSessionBootstrap(createRawExecutionPlan(), async () => {}).toArray(),
      ).rejects.toBe(streamError);

      expect(driver.connection.transaction.commit).not.toHaveBeenCalled();
      expect(driver.connection.transaction.rollback).toHaveBeenCalledOnce();
      expect(driver.connection.release).toHaveBeenCalledOnce();
      expect(driver.connection.destroy).not.toHaveBeenCalled();
    });

    it('wraps commit failure, performs best-effort rollback, and releases on rollback success', async () => {
      const commitError = new Error('commit failed');
      const { runtime, driver } = createTestSetup();
      driver.connection.transaction.commit.mockRejectedValueOnce(commitError);

      await expect(
        runtime.runSessionBootstrap(createRawExecutionPlan(), async () => {}).toArray(),
      ).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_COMMIT_FAILED',
        cause: commitError,
      });

      expect(driver.connection.transaction.rollback).toHaveBeenCalledOnce();
      expect(driver.connection.release).toHaveBeenCalledOnce();
      expect(driver.connection.destroy).not.toHaveBeenCalled();
    });

    it('destroys connection when commit fails and best-effort rollback also fails', async () => {
      const commitError = new Error('commit failed');
      const rollbackError = new Error('rollback also failed');
      const { runtime, driver } = createTestSetup();
      driver.connection.transaction.commit.mockRejectedValueOnce(commitError);
      driver.connection.transaction.rollback.mockRejectedValueOnce(rollbackError);

      await expect(
        runtime.runSessionBootstrap(createRawExecutionPlan(), async () => {}).toArray(),
      ).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_COMMIT_FAILED',
        cause: commitError,
      });

      expect(driver.connection.destroy).toHaveBeenCalledOnce();
      expect(driver.connection.release).not.toHaveBeenCalled();
    });

    it('wraps original error when rollback fails after bootstrap throws', async () => {
      const bootstrapError = new Error('bootstrap failed');
      const rollbackError = new Error('rollback failed');
      const { runtime, driver } = createTestSetup();
      driver.connection.transaction.rollback.mockRejectedValueOnce(rollbackError);

      await expect(
        runtime
          .runSessionBootstrap(createRawExecutionPlan(), async () => {
            throw bootstrapError;
          })
          .toArray(),
      ).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
        cause: bootstrapError,
        details: { rollbackError },
      });

      expect(driver.connection.destroy).toHaveBeenCalledOnce();
      expect(driver.connection.release).not.toHaveBeenCalled();
    });

    it('destroys connection when rollback fails even if destroy also fails', async () => {
      const bootstrapError = new Error('bootstrap failed');
      const rollbackError = new Error('rollback failed');
      const destroyError = new Error('destroy also failed');
      const { runtime, driver } = createTestSetup();
      driver.connection.transaction.rollback.mockRejectedValueOnce(rollbackError);
      driver.connection.destroy.mockRejectedValueOnce(destroyError);

      await expect(
        runtime
          .runSessionBootstrap(createRawExecutionPlan(), async () => {
            throw bootstrapError;
          })
          .toArray(),
      ).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
        cause: bootstrapError,
      });

      expect(driver.connection.destroy).toHaveBeenCalledOnce();
      expect(driver.connection.release).not.toHaveBeenCalled();
    });

    it('no connection is leaked when both bootstrap and rollback succeed without error', async () => {
      const { runtime, driver } = createTestSetup();

      await runtime
        .runSessionBootstrap(createRawExecutionPlan(), async (conn) => {
          await conn.query('SELECT 1');
        })
        .toArray();

      expect(driver.acquireConnectionSpy).toHaveBeenCalledOnce();
      expect(driver.connection.release).toHaveBeenCalledOnce();
      expect(driver.connection.destroy).not.toHaveBeenCalled();
    });
  });

  describe('RawSessionConnection interface', () => {
    it('exposes query() to the bootstrap closure', async () => {
      const { runtime } = createTestSetup();
      let capturedConn: RawSessionConnection | undefined;

      await runtime
        .runSessionBootstrap(createRawExecutionPlan(), async (conn) => {
          capturedConn = conn;
          await conn.query('SELECT 1');
        })
        .toArray();

      expect(capturedConn).toBeDefined();
      expect(typeof capturedConn!.query).toBe('function');
    });

    it('does not expose lifecycle methods (release, destroy, beginTransaction)', async () => {
      const { runtime } = createTestSetup();
      let capturedConn: RawSessionConnection | undefined;

      await runtime
        .runSessionBootstrap(createRawExecutionPlan(), async (conn) => {
          capturedConn = conn;
        })
        .toArray();

      expect(capturedConn).toBeDefined();
      expect('release' in capturedConn!).toBe(false);
      expect('destroy' in capturedConn!).toBe(false);
      expect('beginTransaction' in capturedConn!).toBe(false);
    });
  });
});

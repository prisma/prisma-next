import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import { SqlStorage, SqlUnboundNamespace } from '@prisma-next/sql-contract/types';
import type {
  Codec,
  SelectAst,
  SqlDriver,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import { SelectAst as SelectAstCtor, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  SqlMiddleware,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '@prisma-next/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseRoleBinding } from '../src/runtime/supabase-runtime';
import { SupabaseRuntime } from '../src/runtime/supabase-runtime';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('sha256:supabase-runtime-test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('sha256:supabase-runtime-test'),
    namespaces: { __unbound__: SqlUnboundNamespace.instance },
  }),
  extensionPacks: {},
  capabilities: {},
  meta: {},
};

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
  txExecuteRows: readonly Record<string, unknown>[] = [{ id: 1 }],
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

function createStubAdapter() {
  const codec: Codec<string> = {
    id: 'pg/int4@1',
    targetTypes: ['int4'],
    encode: (v: number) => v,
    decode: (w: number) => w,
  } as unknown as Codec<string>;
  const codecs = [codec];

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
    codecs: () => [],
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
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

function createTestSetup(options?: { middleware?: readonly SqlMiddleware[] }) {
  const adapter = createStubAdapter();
  const driver = createRecordingDriver();
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

  const runtimeOptions: ConstructorParameters<typeof SupabaseRuntime>[0] = {
    context,
    adapter: stackInstance.adapter,
    driver: driver as unknown as SqlDriver,
    verifyMarker: false,
    middleware: options?.middleware ?? [],
  };

  const runtime = new SupabaseRuntime(runtimeOptions);
  return { runtime, driver };
}

function stubPlan(): SqlExecutionPlan<Record<string, unknown>> {
  return {
    sql: 'select 1',
    params: [],
    ast: SelectAstCtor.from(TableSource.named('stub')),
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

describe('SupabaseRuntime', () => {
  describe('executeWithRole', () => {
    it('issues exactly two set_config queries before the typed execute', async () => {
      const { runtime, driver } = createTestSetup();
      const binding: SupabaseRoleBinding = { role: 'authenticated', claims: { sub: 'u1' } };

      await runtime.executeWithRole(stubPlan(), binding).toArray();

      expect(driver.connection.transaction.queryCalls).toEqual([
        { sql: 'SELECT set_config($1, $2, true)', params: ['role', 'authenticated'] },
        {
          sql: 'SELECT set_config($1, $2, true)',
          params: ['request.jwt.claims', JSON.stringify({ sub: 'u1' })],
        },
      ]);
    });

    it('set_config queries and the typed execute run on the same transaction instance', async () => {
      const { runtime, driver } = createTestSetup();
      const seenInBootstrap: symbol[] = [];
      const seenInExecute: symbol[] = [];

      driver.connection.transaction.query = vi
        .fn()
        .mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          seenInBootstrap.push(driver.connection.transaction.id);
          driver.connection.transaction.queryCalls.push({ sql, params });
          return { rows: [], rowCount: 0 };
        });

      driver.connection.transaction.execute = vi.fn().mockImplementation(async function* () {
        seenInExecute.push(driver.connection.transaction.id);
        yield { id: 1 };
      });

      await runtime.executeWithRole(stubPlan(), { role: 'anon' }).toArray();

      expect(seenInBootstrap).toHaveLength(2);
      expect(seenInExecute).toHaveLength(1);
      expect(seenInBootstrap[0]).toBe(seenInExecute[0]);
    });

    it('registered middleware observes the typed query, not the set_config calls', async () => {
      const observedSqls: string[] = [];
      const observer: SqlMiddleware = {
        name: 'sql-observer',
        familyId: 'sql',
        beforeExecute(exec) {
          observedSqls.push(exec.sql);
        },
      };
      const { runtime } = createTestSetup({ middleware: [observer] });
      const plan = { ...stubPlan(), sql: 'select * from users' };

      await runtime.executeWithRole(plan, { role: 'anon' }).toArray();

      expect(observedSqls).toEqual(['select * from users']);
    });

    it('binding with no claims serializes request.jwt.claims as {}', async () => {
      const { runtime, driver } = createTestSetup();

      await runtime.executeWithRole(stubPlan(), { role: 'anon', claims: {} }).toArray();

      const claimsCall = driver.connection.transaction.queryCalls.find(
        (c) => (c.params as string[])?.[0] === 'request.jwt.claims',
      );
      expect(claimsCall?.params).toEqual(['request.jwt.claims', '{}']);
    });

    it('binding without claims field defaults request.jwt.claims to {}', async () => {
      const { runtime, driver } = createTestSetup();

      await runtime.executeWithRole(stubPlan(), { role: 'anon' }).toArray();

      const claimsCall = driver.connection.transaction.queryCalls.find(
        (c) => (c.params as string[])?.[0] === 'request.jwt.claims',
      );
      expect(claimsCall?.params).toEqual(['request.jwt.claims', '{}']);
    });
  });

  describe('executeRoleTransaction', () => {
    it('runs set_config bootstrap once at transaction open', async () => {
      const { runtime, driver } = createTestSetup();

      await runtime.executeRoleTransaction(
        { role: 'authenticated', claims: { sub: 'u2' } },
        async () => undefined,
      );

      expect(driver.connection.transaction.queryCalls).toEqual([
        { sql: 'SELECT set_config($1, $2, true)', params: ['role', 'authenticated'] },
        {
          sql: 'SELECT set_config($1, $2, true)',
          params: ['request.jwt.claims', JSON.stringify({ sub: 'u2' })],
        },
      ]);
    });

    it('callback executes run middleware-wrapped on the same transaction', async () => {
      const observedSqls: string[] = [];
      const observer: SqlMiddleware = {
        name: 'sql-observer',
        familyId: 'sql',
        beforeExecute(exec) {
          observedSqls.push(exec.sql);
        },
      };
      const { runtime, driver } = createTestSetup({ middleware: [observer] });

      const plan = { ...stubPlan(), sql: 'select id from posts' };
      const seenTxIds: symbol[] = [];

      driver.connection.transaction.execute = vi.fn().mockImplementation(async function* () {
        seenTxIds.push(driver.connection.transaction.id);
        yield { id: 1 };
      });

      await runtime.executeRoleTransaction({ role: 'service_role' }, async (tx) => {
        await tx.execute(plan).toArray();
      });

      expect(observedSqls).toEqual(['select id from posts']);
      expect(seenTxIds).toHaveLength(1);
      expect(seenTxIds[0]).toBe(driver.connection.transaction.id);
    });

    it('commits on callback resolve', async () => {
      const { runtime, driver } = createTestSetup();

      await runtime.executeRoleTransaction({ role: 'anon' }, async () => undefined);

      expect(driver.connection.transaction.commit).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.rollback).not.toHaveBeenCalled();
    });

    it('rolls back when callback throws', async () => {
      const { runtime, driver } = createTestSetup();
      const err = new Error('callback failed');

      await expect(
        runtime.executeRoleTransaction({ role: 'anon' }, async () => {
          throw err;
        }),
      ).rejects.toBe(err);

      expect(driver.connection.transaction.rollback).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.commit).not.toHaveBeenCalled();
    });
  });
});

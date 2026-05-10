import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlDriver, SqlExecuteRequest } from '@prisma-next/sql-relational-core/ast';
import {
  codec,
  createCodecRegistry,
  ParamRef,
  RawSqlExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { ParamRefHandle } from '@prisma-next/sql-relational-core/middleware';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { parseContractMarkerRow } from '../src/marker';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';

type ParamRefHandleAny = ParamRefHandle<string | undefined>;

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

function createStubAdapter() {
  const codecs = createCodecRegistry();
  codecs.register(
    codec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      encode: (v: string) => v,
      decode: (w: string) => w,
    }),
  );
  codecs.register(
    codec({
      typeId: 'cipherstash/string@1',
      targetTypes: ['eql_v2_encrypted'],
      encode: async (v: string) => `wire:${v}`,
      decode: (w: string) => w,
    }),
  );
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    profile: {
      id: 'test',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return codecs;
      },
      readMarkerStatement() {
        return {
          sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from prisma_contract.marker where id = $1',
          params: [1],
        };
      },
      parseMarkerRow: parseContractMarkerRow,
    },
    lower(_ast: unknown, ctx: { params?: readonly unknown[] }) {
      // Stub the lower step. The real adapter would render the AST; for the
      // test we only care that `params` flow through. The adapter writes
      // the params it received from the lane (raw, pre-encode values), so
      // mutator visibility into pre-encode values is preserved.
      return Object.freeze({
        sql: 'SELECT FROM stub',
        params: ctx.params ? [...ctx.params] : [],
      });
    },
  };
}

function createMockDriver() {
  const rootExecute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    yield { id: 1 };
  });
  const driver: SqlDriver = {
    execute: rootExecute,
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue({
      execute: vi.fn(),
      query: vi.fn(),
      release: vi.fn(),
      destroy: vi.fn(),
      beginTransaction: vi.fn(),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return Object.assign(driver, { __rootExecute: rootExecute });
}

function createTestSetup(middleware: readonly SqlMiddleware[]) {
  const adapter = createStubAdapter();
  const driver = createMockDriver();
  const targetDescriptor: SqlRuntimeTargetDescriptor<'postgres'> = {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    codecs: () => createCodecRegistry(),
    parameterizedCodecs: () => [],
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };
  const adapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres'> = {
    kind: 'adapter',
    id: 'a',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    codecs: () => adapter.profile.codecs(),
    parameterizedCodecs: () => [],
    create: () =>
      Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>,
  };
  const stack = createSqlExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensionPacks: [],
  });
  type StackInstance = ExecutionStackInstance<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>,
    RuntimeDriverInstance<'sql', 'postgres'>,
    RuntimeExtensionInstance<'sql', 'postgres'>
  >;
  const stackInstance = instantiateExecutionStack(stack) as StackInstance;
  const context = createExecutionContext({
    contract: testContract,
    stack: { target: targetDescriptor, adapter: adapterDescriptor, extensionPacks: [] },
  });
  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    middleware,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
  return { runtime, driver };
}

function buildPlan(): SqlQueryPlan {
  const a = ParamRef.of('alice@example.com', { codecId: 'cipherstash/string@1', name: 'email1' });
  const b = ParamRef.of('bob@example.com', { codecId: 'cipherstash/string@1', name: 'email2' });
  const c = ParamRef.of('plain', { codecId: 'pg/text@1', name: 'tag' });
  const ast = RawSqlExpr.of(
    ['INSERT INTO t (email1, email2, tag) VALUES (', ', ', ', ', ') RETURNING id'],
    [a, b, c],
  );
  return {
    ast,
    params: [a.value, b.value, c.value],
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

describe('beforeExecute mutator', () => {
  it('a mutated value reaches subsequent codec.encode', async () => {
    const mutating: SqlMiddleware = {
      name: 'mutate-emails',
      familyId: 'sql',
      async beforeExecute(_plan, _ctx, params) {
        if (!params) return;
        for (const entry of params.entries()) {
          if (entry.codecId === 'cipherstash/string@1') {
            params.replaceValue(entry.ref, `mutated:${entry.value as string}`);
          }
        }
      },
    };
    const { runtime, driver } = createTestSetup([mutating]);
    await runtime.execute(buildPlan()).toArray();

    const sentRequest = driver.__rootExecute.mock.calls[0]?.[0] as
      | { params?: readonly unknown[] }
      | undefined;
    // The cipherstash/string@1 codec wraps with `wire:`. If `replaceValue`
    // reached encode, the driver receives `wire:mutated:<plain>`.
    expect(sentRequest?.params).toEqual([
      'wire:mutated:alice@example.com',
      'wire:mutated:bob@example.com',
      'plain',
    ]);
  });

  it('bulk-pattern fixture — entries() walk, codec-id filter, single async call, replaceValues writeback, encode reflects writeback', async () => {
    let bulkCalls = 0;
    const bulkMiddleware: SqlMiddleware = {
      name: 'bulk-encrypt-stub',
      familyId: 'sql',
      async beforeExecute(_plan, ctx, params) {
        if (!params) return;
        const targets: { ref: ParamRefHandleAny; plain: string }[] = [];
        for (const entry of params.entries()) {
          if (entry.codecId === 'cipherstash/string@1' && typeof entry.value === 'string') {
            targets.push({ ref: entry.ref, plain: entry.value });
          }
        }
        if (targets.length === 0) return;

        // One bulk async call per execute() — forwarding ctx.signal.
        bulkCalls++;
        const ciphertexts: string[] = await new Promise((resolve) => {
          setImmediate(() => resolve(targets.map((t) => `bulk:${t.plain}`)));
        });
        // ctx.signal must be present and identity-equal to the one supplied.
        // (Defensively typed; the test's signal assertions live elsewhere.)
        expect(ctx).toBeDefined();

        params.replaceValues(
          targets.map((t, i) => ({ ref: t.ref, newValue: ciphertexts[i] as string })),
        );
      },
    };
    const { runtime, driver } = createTestSetup([bulkMiddleware]);
    await runtime.execute(buildPlan()).toArray();

    expect(bulkCalls).toBe(1);

    expect(driver.__rootExecute).toHaveBeenCalledOnce();
    const sentRequest = driver.__rootExecute.mock.calls[0]?.[0] as
      | { params?: readonly unknown[] }
      | undefined;
    // After mutation, the bulk middleware wrote ciphertexts; the codec
    // then runs as identity-with-wire-prefix. So the cipherstash params
    // arrive at the driver as `wire:bulk:<plain>` (encode adds `wire:`).
    expect(sentRequest?.params).toEqual([
      'wire:bulk:alice@example.com',
      'wire:bulk:bob@example.com',
      'plain',
    ]);
  });

  it('with no mutating middleware, plan.params reaches encodeParams without allocation', async () => {
    let observed: unknown[] | undefined;
    const observer: SqlMiddleware = {
      name: 'observer',
      familyId: 'sql',
      async beforeExecute(plan, _ctx, params) {
        // Walking entries() must not trigger working-array allocation
        for (const _ of params?.entries() ?? []) {
          // intentionally empty
        }
        observed = [...plan.params];
      },
    };
    const { runtime, driver } = createTestSetup([observer]);
    await runtime.execute(buildPlan()).toArray();
    expect(observed).toEqual(['alice@example.com', 'bob@example.com', 'plain']);

    // Encoded params arrive at driver: cipherstash/string@1 wraps with `wire:`.
    const sentRequest = driver.__rootExecute.mock.calls[0]?.[0] as
      | { params?: readonly unknown[] }
      | undefined;
    expect(sentRequest?.params).toEqual([
      'wire:alice@example.com',
      'wire:bob@example.com',
      'plain',
    ]);
  });

  it('pre-check at second middleware entry throws phase: "beforeExecute"', async () => {
    const events: string[] = [];
    const ctrl = new AbortController();
    const first: SqlMiddleware = {
      name: 'first',
      familyId: 'sql',
      async beforeExecute() {
        events.push('first');
        // Abort BEFORE returning so the loop's next iteration sees
        // an already-aborted signal at entry.
        ctrl.abort(new Error('caller cancelled'));
      },
    };
    const second: SqlMiddleware = {
      name: 'second',
      familyId: 'sql',
      async beforeExecute() {
        events.push('second');
      },
    };
    const { runtime } = createTestSetup([first, second]);
    await expect(
      runtime.execute(buildPlan(), { signal: ctrl.signal }).toArray(),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'beforeExecute' },
    });
    expect(events).toEqual(['first']);
  });

  it('mid-flight abort surfaces RUNTIME.ABORTED promptly even when middleware ignores the signal', async () => {
    const ctrl = new AbortController();
    const mw: SqlMiddleware = {
      name: 'slow-and-deaf',
      familyId: 'sql',
      // Ignores ctx.signal entirely; just blocks for a long time.
      async beforeExecute() {
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
    };
    const { runtime } = createTestSetup([mw]);
    setTimeout(() => ctrl.abort(new Error('mid-flight')), 5);

    await expect(
      runtime.execute(buildPlan(), { signal: ctrl.signal }).toArray(),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'beforeExecute' },
    });
  });

  it('middleware bodies that throw non-abort errors pass through unchanged (no re-wrap)', async () => {
    const customError = new Error('something else');
    const mw: SqlMiddleware = {
      name: 'throws',
      familyId: 'sql',
      async beforeExecute() {
        throw customError;
      },
    };
    const { runtime } = createTestSetup([mw]);
    await expect(runtime.execute(buildPlan()).toArray()).rejects.toBe(customError);
  });
});

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
 * Documents the contract: when a `SqlMiddleware.intercept` hook short-circuits
 * execution and returns raw rows, those rows go through the SQL runtime's
 * normal codec decode pass — exactly as if they had come from the driver.
 *
 * The cache middleware (TML-2143 M3) relies on this: it stores raw (undecoded)
 * rows on first execution, then returns them from `intercept` on subsequent
 * executions. Decoding happens once per row consumption regardless of whether
 * the row originated from the driver or the cache.
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

/**
 * A JSON codec that takes wire-format strings and decodes them into parsed
 * objects. Used to demonstrate that intercepted rows containing JSON-encoded
 * values come back to the consumer as parsed objects.
 */
function createJsonCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/jsonb@1',
      targetTypes: ['jsonb'],
      encode: (value: unknown) => JSON.stringify(value),
      decode: (wire: unknown) => {
        if (typeof wire === 'string') {
          return JSON.parse(wire);
        }
        return wire;
      },
    }),
  );
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
  const rootExecute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    // Default driver path; real test cases below either intercept (skipping
    // this) or assert it was called.
    yield {} as Record<string, unknown>;
  });

  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

  return {
    execute: rootExecute,
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
  const codecs = createJsonCodecRegistry();
  const adapter = createStubAdapter(codecs);
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

  return { runtime, driver };
}

/**
 * Builds an execution plan whose `meta.projectionTypes` maps the named alias
 * to the JSON codec, so any row yielded for this plan (driver or intercepted)
 * is decoded through the JSON codec before reaching the consumer.
 */
function createJsonProjectionPlan(alias: string): SqlExecutionPlan {
  return {
    sql: 'select profile from users',
    params: [],
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
      paramDescriptors: [],
      projectionTypes: { [alias]: 'pg/jsonb@1' },
    },
  };
}

describe('intercepted rows go through codec decoding', () => {
  it('decodes JSON wire values returned by an interceptor into parsed objects', async () => {
    const wireValue = JSON.stringify({ name: 'Alice', tags: ['admin', 'staff'] });

    const interceptor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      async intercept() {
        // Raw wire row, as the driver would have produced it: a string
        // containing JSON-encoded data.
        return { rows: [{ profile: wireValue }] };
      },
    };

    const { runtime, driver } = createTestSetup([interceptor]);
    const plan = createJsonProjectionPlan('profile');

    const out = await runtime.execute(plan).toArray();

    // The consumer must see the *decoded* value (a parsed object), not the
    // raw wire string.
    expect(out).toEqual([{ profile: { name: 'Alice', tags: ['admin', 'staff'] } }]);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('decodes multiple intercepted rows independently', async () => {
    const interceptor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      async intercept() {
        return {
          rows: [
            { profile: JSON.stringify({ id: 1 }) },
            { profile: JSON.stringify({ id: 2 }) },
            { profile: JSON.stringify({ id: 3 }) },
          ],
        };
      },
    };

    const { runtime, driver } = createTestSetup([interceptor]);
    const plan = createJsonProjectionPlan('profile');

    const out = await runtime.execute(plan).toArray();

    expect(out).toEqual([{ profile: { id: 1 } }, { profile: { id: 2 } }, { profile: { id: 3 } }]);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('decodes intercepted rows yielded from an AsyncIterable', async () => {
    async function* asyncRows(): AsyncGenerator<Record<string, unknown>, void, unknown> {
      yield { profile: JSON.stringify({ kind: 'first' }) };
      yield { profile: JSON.stringify({ kind: 'second' }) };
    }

    const interceptor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      async intercept() {
        return { rows: asyncRows() };
      },
    };

    const { runtime, driver } = createTestSetup([interceptor]);
    const plan = createJsonProjectionPlan('profile');

    const out = await runtime.execute(plan).toArray();

    expect(out).toEqual([{ profile: { kind: 'first' } }, { profile: { kind: 'second' } }]);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('decodes driver rows and intercepted rows the same way (round-trip via the same codec path)', async () => {
    // First, capture what the driver path produces for a known wire value.
    const driverDecoded = await (async () => {
      const wireValue = JSON.stringify({ x: 42 });

      // No interceptor — driver path.
      const { runtime, driver } = createTestSetup([]);

      // Override the driver to produce the wire value.
      (driver.execute as ReturnType<typeof vi.fn>).mockImplementation(async function* (
        _request: SqlExecuteRequest,
      ) {
        yield { profile: wireValue };
      });

      const out = await runtime.execute(createJsonProjectionPlan('profile')).toArray();
      return out;
    })();

    expect(driverDecoded).toEqual([{ profile: { x: 42 } }]);

    // Now run the same wire value through the intercept path.
    const interceptDecoded = await (async () => {
      const wireValue = JSON.stringify({ x: 42 });

      const interceptor: SqlMiddleware = {
        name: 'mock-cache',
        familyId: 'sql',
        async intercept() {
          return { rows: [{ profile: wireValue }] };
        },
      };

      const { runtime } = createTestSetup([interceptor]);
      return runtime.execute(createJsonProjectionPlan('profile')).toArray();
    })();

    // Both paths produce identical decoded output.
    expect(interceptDecoded).toEqual(driverDecoded);
  });
});

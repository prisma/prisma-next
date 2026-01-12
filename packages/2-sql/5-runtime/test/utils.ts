import type { ExecutionPlan, ResultType } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { collectAsync, drainAsyncIterable } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import type { SqlStatement } from '../src/exports';
import {
  type createRuntime,
  createRuntimeContext,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '../src/exports';
import type {
  RuntimeContext,
  SqlRuntimeAdapterInstance,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';

/**
 * Executes a plan and collects all results into an array.
 * This helper DRYs up the common pattern of executing plans in tests.
 * The return type is inferred from the plan's type parameter.
 */
export async function executePlanAndCollect<
  P extends ExecutionPlan<ResultType<P>> | SqlQueryPlan<ResultType<P>>,
>(runtime: ReturnType<typeof createRuntime>, plan: P): Promise<ResultType<P>[]> {
  type Row = ResultType<P>;
  return collectAsync<Row>(runtime.execute<Row>(plan));
}

/**
 * Drains a plan execution, consuming all results without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainPlanExecution(
  runtime: ReturnType<typeof createRuntime>,
  plan: ExecutionPlan | SqlQueryPlan<unknown>,
): Promise<void> {
  return drainAsyncIterable(runtime.execute(plan));
}

/**
 * Executes a SQL statement on a database client.
 */
export async function executeStatement(client: Client, statement: SqlStatement): Promise<void> {
  if (statement.params.length > 0) {
    await client.query(statement.sql, [...statement.params]);
    return;
  }

  await client.query(statement.sql);
}

/**
 * Sets up database schema and data, then writes the contract marker.
 * This helper DRYs up the common pattern of database setup in tests.
 */
export async function setupTestDatabase(
  client: Client,
  contract: SqlContract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await client.query('drop schema if exists prisma_contract cascade');
  await client.query('create schema if not exists public');

  await setupFn(client);

  await executeStatement(client, ensureSchemaStatement);
  await executeStatement(client, ensureTableStatement);
  const write = writeContractMarker({
    coreHash: contract.coreHash,
    profileHash: contract.profileHash ?? contract.coreHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
  await executeStatement(client, write.insert);
}

/**
 * Writes a contract marker to the database.
 * This helper DRYs up the common pattern of writing contract markers in tests.
 */
export async function writeTestContractMarker(
  client: Client,
  contract: SqlContract<SqlStorage>,
): Promise<void> {
  const write = writeContractMarker({
    coreHash: contract.coreHash,
    profileHash: contract.profileHash ?? contract.coreHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
  await executeStatement(client, write.insert);
}

/**
 * Creates a test adapter descriptor from a raw adapter.
 * This wraps the adapter in a descriptor for descriptor-first context creation in tests.
 * The adapter instance IS an Adapter (via intersection), with identity properties added.
 */
function createTestAdapterDescriptor(
  adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
): {
  readonly kind: 'adapter';
  readonly id: string;
  readonly version: string;
  readonly familyId: 'sql';
  readonly targetId: 'postgres';
  create(): SqlRuntimeAdapterInstance<'postgres'>;
} {
  return {
    kind: 'adapter' as const,
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create(): SqlRuntimeAdapterInstance<'postgres'> {
      // Return an object that combines identity properties with the adapter's methods
      return Object.assign(
        {
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
        },
        adapter,
      );
    },
  };
}

/**
 * Creates a test target descriptor.
 * This is a minimal descriptor for descriptor-first context creation in tests.
 */
function createTestTargetDescriptor(): {
  readonly kind: 'target';
  readonly id: string;
  readonly version: string;
  readonly familyId: 'sql';
  readonly targetId: 'postgres';
  create(): { readonly familyId: 'sql'; readonly targetId: 'postgres' };
} {
  return {
    kind: 'target' as const,
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

/**
 * Creates a runtime context with standard test configuration.
 * This helper DRYs up the common pattern of context creation in tests.
 *
 * Accepts a raw adapter and optional extension descriptors, wrapping the
 * adapter in a descriptor internally for descriptor-first context creation.
 */
export function createTestContext<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
  adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
  options?: {
    extensionPacks?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
  },
): RuntimeContext<TContract> {
  return createRuntimeContext<TContract, 'postgres'>({
    contract,
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(adapter),
    extensionPacks: options?.extensionPacks ?? [],
  });
}

/**
 * Creates a stub adapter for testing.
 * This helper DRYs up the common pattern of adapter creation in tests.
 *
 * The stub adapter includes simple codecs for common test types (pg/int4@1, pg/text@1, pg/timestamptz@1)
 * to enable type inference in tests without requiring the postgres adapter package.
 */
export function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  const codecRegistry = createCodecRegistry();

  // Register stub codecs for common test types
  // These match the codec IDs used in test contracts (pg/int4@1, pg/text@1, pg/timestamptz@1)
  // but don't require importing from the postgres adapter package
  codecRegistry.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    }),
  );

  codecRegistry.register(
    codec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
  );

  codecRegistry.register(
    codec({
      typeId: 'pg/timestamptz@1',
      targetTypes: ['timestamptz'],
      encode: (value: string | Date) => (value instanceof Date ? value.toISOString() : value),
      decode: (wire: string | Date) =>
        typeof wire === 'string' ? wire : wire instanceof Date ? wire.toISOString() : String(wire),
    }),
  );

  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return codecRegistry;
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

/**
 * Creates a valid test contract without using validateContract.
 * Ensures all required fields are present (mappings, capabilities, extensionPacks, meta, sources)
 * and returns the contract with proper typing.
 * This helper allows tests to create contracts without depending on sql-query.
 */
export function createTestContract<T extends SqlContract<SqlStorage>>(
  contract: Partial<Omit<T, 'coreHash' | 'profileHash'>> & {
    coreHash?: string | undefined;
    profileHash?: string | undefined;
  },
): T {
  return {
    ...contract,
    schemaVersion: contract.schemaVersion ?? '1',
    target: contract.target ?? 'postgres',
    targetFamily: contract.targetFamily ?? 'sql',
    storage: contract.storage ?? { tables: {} },
    models: contract.models ?? {},
    relations: contract.relations ?? {},
    mappings: contract.mappings ?? { codecTypes: {}, operationTypes: {} },
    capabilities: contract.capabilities ?? {},
    extensionPacks: contract.extensionPacks ?? {},
    meta: contract.meta ?? {},
    sources: contract.sources ?? {},
    coreHash: (contract.coreHash ?? 'sha256:testcore') satisfies string as never,
    profileHash: (contract.profileHash ?? 'sha256:testprofile') satisfies string as never,
  } satisfies SqlContract as never;
}

// Re-export generic utilities from test-utils
export {
  collectAsync,
  createDevDatabase,
  type DevDatabase,
  teardownTestDatabase,
  withClient,
} from '@prisma-next/test-utils';

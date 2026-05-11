import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  CodecDescriptor,
  CodecMeta,
  CodecTrait,
} from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import {
  instantiateExecutionStack,
  type RuntimeDriverDescriptor,
} from '@prisma-next/framework-components/execution';
import type { ResultType } from '@prisma-next/framework-components/runtime';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  Codec,
  ContractCodecRegistry,
  LoweredStatement,
  SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { collectAsync, drainAsyncIterable } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import type { SqlStatement } from '../src/exports';
import {
  APP_SPACE_ID,
  createExecutionContext,
  type createRuntime,
  createSqlExecutionStack,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '../src/exports';
import type {
  ExecutionContext,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeDriverInstance,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { defineTestCodec } from './test-codec';

function createTestMutationDefaultGenerators() {
  return builtinGeneratorIds.map((id) => ({
    id,
    generate: (params?: Record<string, unknown>) => generateId(params ? { id, params } : { id }),
    stability: 'field' as const,
  }));
}

/**
 * Executes a plan and collects all results into an array. This helper DRYs up the common pattern of executing plans in tests. The return type is inferred from the plan's type parameter.
 */
export async function executePlanAndCollect<
  P extends SqlExecutionPlan<ResultType<P>> | SqlQueryPlan<ResultType<P>>,
>(runtime: ReturnType<typeof createRuntime>, plan: P): Promise<ResultType<P>[]> {
  type Row = ResultType<P>;
  return collectAsync<Row>(runtime.execute<Row>(plan));
}

/**
 * Drains a plan execution, consuming all results without collecting them. Useful for testing side effects without memory overhead.
 */
export async function drainPlanExecution(
  runtime: ReturnType<typeof createRuntime>,
  plan: SqlExecutionPlan | SqlQueryPlan<unknown>,
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
 * Sets up database schema and data, then writes the contract marker. This helper DRYs up the common pattern of database setup in tests.
 */
export async function setupTestDatabase(
  client: Client,
  contract: Contract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await client.query('drop schema if exists prisma_contract cascade');
  await client.query('create schema if not exists public');

  await setupFn(client);

  await executeStatement(client, ensureSchemaStatement);
  await executeStatement(client, ensureTableStatement);
  const write = writeContractMarker({
    space: APP_SPACE_ID,
    storageHash: contract.storage.storageHash,
    profileHash: contract.profileHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
  await executeStatement(client, write.insert);
}

/**
 * Writes a contract marker to the database. This helper DRYs up the common pattern of writing contract markers in tests.
 */
export async function writeTestContractMarker(
  client: Client,
  contract: Contract<SqlStorage>,
): Promise<void> {
  const write = writeContractMarker({
    space: APP_SPACE_ID,
    storageHash: contract.storage.storageHash,
    profileHash: contract.profileHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
  await executeStatement(client, write.insert);
}

/**
 * Creates a test adapter descriptor from a raw adapter. Wraps the adapter in an SqlRuntimeAdapterDescriptor with static contributions derived from the adapter's codec registry.
 */
/**
 * Build a {@link ContractCodecRegistry} from a codec array for tests that exercise `encodeParam(s)` / `decodeRow` in isolation. The production runtime builds `ContractCodecRegistry` from contract walk + descriptor list and never goes through this helper; tests use it to wire a hand-built codec set into the surface those functions consume in production.
 */
export function buildTestContractCodecs(
  codecs: ReadonlyArray<Codec<string>>,
): ContractCodecRegistry {
  const byId = new Map<string, Codec<string>>();
  for (const codec of codecs) {
    byId.set(codec.id, codec);
  }
  return {
    forColumn: () => undefined,
    forCodecRef: (ref) => {
      const codec = byId.get(ref.codecId);
      if (!codec) {
        throw runtimeError(
          'RUNTIME.CODEC_DESCRIPTOR_MISSING',
          `Test ContractCodecRegistry has no codec for codecId '${ref.codecId}'.`,
          { codecId: ref.codecId },
        );
      }
      return codec;
    },
  };
}

/**
 * Synthesize `CodecDescriptor`s from a codec array of non-parameterized codec instances. Test-only: the production synthesis bridge was retired under TML-2357. Lets the existing `createTestAdapterDescriptor` pattern keep wrapping a stub `Adapter` (whose `__codecs` slot still exposes the codec set) into the descriptor-list shape that `SqlStaticContributions.codecs:` now expects. The `Codec` instances carry
 * `traits`/`targetTypes`/`meta` via the SQL family extension; the structural narrow reads those fields directly.
 */
export function descriptorsFromCodecs(
  codecs: ReadonlyArray<Codec<string>>,
): ReadonlyArray<CodecDescriptor> {
  const descriptors: CodecDescriptor[] = [];
  for (const instance of codecs) {
    const legacy = instance as {
      readonly traits?: readonly CodecTrait[];
      readonly targetTypes?: readonly string[];
      readonly meta?: CodecMeta;
    };
    descriptors.push({
      codecId: instance.id,
      traits: legacy.traits ?? [],
      targetTypes: legacy.targetTypes ?? [],
      paramsSchema: voidParamsSchema,
      isParameterized: false,
      factory: () => () => instance,
      ...(legacy.meta !== undefined ? { meta: legacy.meta } : {}),
    });
  }
  return descriptors;
}

export function createTestAdapterDescriptor(
  adapter: StubAdapter,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.__codecs);
  return {
    kind: 'adapter' as const,
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    mutationDefaultGenerators: createTestMutationDefaultGenerators,
    create(_stack): SqlRuntimeAdapterInstance<'postgres'> {
      return Object.assign({ familyId: 'sql' as const, targetId: 'postgres' as const }, adapter);
    },
  };
}

/**
 * Creates a test target descriptor with empty static contributions.
 */
export function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target' as const,
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

/**
 * Creates an ExecutionContext for testing. This helper DRYs up the common pattern of context creation in tests.
 *
 * Accepts a raw adapter and optional extension descriptors, wrapping the adapter in a descriptor internally for descriptor-first context creation.
 */
export function createTestContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  adapter: StubAdapter,
  options?: {
    extensionPacks?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
  },
): ExecutionContext<TContract> {
  return createExecutionContext({
    contract,
    stack: {
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(adapter),
      extensionPacks: options?.extensionPacks ?? [],
    },
  });
}

export function createTestStackInstance(options?: {
  extensionPacks?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
  driver?: RuntimeDriverDescriptor<
    'sql',
    'postgres',
    unknown,
    SqlRuntimeDriverInstance<'postgres'>
  >;
}) {
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(createStubAdapter()),
    driver: options?.driver,
    extensionPacks: options?.extensionPacks ?? [],
  });

  return instantiateExecutionStack(stack);
}

/**
 * Stub-adapter type augments the public {@link Adapter} surface with a `__codecs` slot that exposes the test stub's runtime codec set to descriptor-shaping helpers (`createTestAdapterDescriptor`). Production adapters do not declare this slot — runtime codecs flow through the descriptor list from `SqlRuntimeAdapterDescriptor.codecs()` — so the augmentation is intentionally test-only.
 */
export type StubAdapter = Adapter<SelectAst, Contract<SqlStorage>, LoweredStatement> & {
  readonly __codecs: ReadonlyArray<Codec<string>>;
};

/**
 * Creates a stub adapter for testing. This helper DRYs up the common pattern of adapter creation in tests.
 *
 * The stub adapter includes simple codecs for common test types (pg/int4@1, pg/text@1, pg/timestamptz@1) to enable type inference in tests without requiring the postgres adapter package.
 */
export function createStubAdapter(): StubAdapter {
  // Stub codecs for common test types — match the codec IDs used in test contracts (pg/int4@1, pg/text@1, pg/timestamptz@1) without importing from the postgres adapter package.
  const codecs: ReadonlyArray<Codec<string>> = [
    defineTestCodec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    }),
    defineTestCodec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
    defineTestCodec({
      typeId: 'pg/timestamptz@1',
      targetTypes: ['timestamptz'],
      encode: (value: Date) => value,
      decode: (wire: Date) => wire,
      // Date is not assignable to JsonValue, so the JSON round-trip pair must be supplied explicitly.
      encodeJson: (value: Date) => value.toISOString(),
      decodeJson: (json) => {
        if (typeof json !== 'string') throw new Error('expected ISO date string');
        return new Date(json);
      },
    }),
  ];

  return {
    __codecs: codecs,
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst, ctx: { contract: Contract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] });
    },
  };
}

export function createTestContract(
  contract: Partial<Omit<Contract<SqlStorage>, 'profileHash' | 'storage'>> & {
    storageHash?: string;
    profileHash?: string;
    storage?: Omit<SqlStorage, 'storageHash'>;
  },
): Contract<SqlStorage> {
  const { execution, ...rest } = contract;
  const storageHashValue = coreHash(rest['storageHash'] ?? 'sha256:testcore');

  return {
    target: rest['target'] ?? 'postgres',
    targetFamily: rest['targetFamily'] ?? 'sql',
    storage: rest['storage']
      ? { ...rest['storage'], storageHash: storageHashValue }
      : { storageHash: storageHashValue, tables: {} },
    models: rest['models'] ?? {},
    roots: rest['roots'] ?? {},
    capabilities: rest['capabilities'] ?? {},
    extensionPacks: rest['extensionPacks'] ?? {},
    meta: rest['meta'] ?? {},
    ...(execution ? { execution } : {}),
    profileHash: profileHash(rest['profileHash'] ?? 'sha256:testprofile'),
  };
}

// Re-export generic utilities from test-utils
export {
  collectAsync,
  createDevDatabase,
  type DevDatabase,
  teardownTestDatabase,
  withClient,
} from '@prisma-next/test-utils';

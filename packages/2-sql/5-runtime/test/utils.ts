import {
  type Contract,
  type ContractModelBase,
  coreHash,
  profileHash,
} from '@prisma-next/contract/types';
import type {
  CodecDescriptor,
  CodecMeta,
  CodecTrait,
} from '@prisma-next/framework-components/codec';
import {
  instantiateExecutionStack,
  type RuntimeDriverDescriptor,
} from '@prisma-next/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { ResultType } from '@prisma-next/framework-components/runtime';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import { canonicalizeJson } from '@prisma-next/framework-components/utils';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import {
  buildSqlNamespace,
  SqlStorage,
  type SqlStorageInput,
  SqlUnboundNamespace,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  AnyQueryAst,
  Codec,
  ContractCodecRegistry,
  LoweredStatement,
  SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import { SelectAst as SelectAstCtor, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { applicationDomainOf, collectAsync, drainAsyncIterable } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import type { SqlStatement } from '../src/exports';
import {
  APP_SPACE_ID,
  createExecutionContext,
  type createRuntime,
  createSqlExecutionStack,
  ensureSchemaStatement,
  ensureTableStatement,
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
  await writeTestContractMarker(client, contract);
}

export interface SeedMarkerInput {
  /** Logical space for the marker row; defaults to {@link APP_SPACE_ID}. */
  readonly space?: string;
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
  readonly invariants?: readonly string[];
}

/**
 * Seeds a contract marker row directly via raw SQL. Test-only: the production
 * write path goes through the control adapter SPI (`initMarker`/`updateMarker`),
 * which needs a `ControlDriverInstance`; these fixtures hold a raw `pg.Client`,
 * so they perform a minimal `INSERT` over the columns the runtime reads back.
 */
export async function seedTestMarker(client: Client, input: SeedMarkerInput): Promise<void> {
  await client.query(
    `insert into prisma_contract.marker
       (space, core_hash, profile_hash, contract_json, canonical_version, invariants, updated_at)
     values ($1, $2, $3, $4::jsonb, $5, $6::text[], now())`,
    [
      input.space ?? APP_SPACE_ID,
      input.storageHash,
      input.profileHash,
      input.contractJson === undefined ? null : JSON.stringify(input.contractJson),
      input.canonicalVersion ?? null,
      input.invariants ?? [],
    ],
  );
}

/**
 * Seeds the app-space marker for a contract. Thin wrapper over
 * {@link seedTestMarker} for the common "write the marker for this contract" case.
 */
export async function writeTestContractMarker(
  client: Client,
  contract: Contract<SqlStorage>,
): Promise<void> {
  await seedTestMarker(client, {
    storageHash: contract.storage.storageHash,
    profileHash: contract.profileHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
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
  // Canonical-key cache: production `forCodecRef` memoizes per `(codecId, canonicalize(typeParams))`. Tests resolve by codecId, but key the cache on the canonical pair so callers passing distinct typeParams get distinct (still codec-id-templated) entries — and so this helper cannot silently coalesce them.
  const byCanonicalKey = new Map<string, Codec<string>>();
  return {
    forColumn: () => undefined,
    forCodecRef: (ref) => {
      const canonicalKey = canonicalizeJson({
        codecId: ref.codecId,
        ...(ref.typeParams !== undefined ? { typeParams: ref.typeParams } : {}),
      });
      const cached = byCanonicalKey.get(canonicalKey);
      if (cached) return cached;
      const template = byId.get(ref.codecId);
      if (!template) {
        throw runtimeError(
          'RUNTIME.CODEC_DESCRIPTOR_MISSING',
          `Test ContractCodecRegistry has no codec for codecId '${ref.codecId}'.`,
          {
            codecId: ref.codecId,
            ...(ref.typeParams !== undefined ? { typeParams: ref.typeParams } : {}),
          },
        );
      }
      byCanonicalKey.set(canonicalKey, template);
      return template;
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
  // Permissive paramsSchema for synthesized test descriptors: accepts any
  // shape (incl. undefined) and passes it through. Stubs do not encode
  // parameterization, so marking them `isParameterized: true` with this
  // schema lets the runtime integrity check tolerate columns that legitimately
  // carry typeParams (e.g. `sql/char@1` length=36) without re-introducing
  // the legacy "non-parameterized + typeParams" silent skip.
  // Permissive schema for synthesized test descriptors. `validate()` always
  // succeeds and discards input, narrowed to `void` to match the
  // `paramsSchema: StandardSchemaV1<void, void>` slot on the descriptor.
  // The factory ignores typeParams, so typing the validated output as `void`
  // is honest about what the stub does with the value.
  const acceptAnyParamsSchema = {
    '~standard': {
      version: 1 as const,
      vendor: 'sql-runtime/test-utils',
      validate: (_value: unknown) => ({ value: undefined }),
    },
  };
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
      paramsSchema: acceptAnyParamsSchema,
      isParameterized: true,
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
    rawCodecInferer: { inferCodec: () => 'pg/text' },
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
  // Stub codecs for codec IDs that test contracts may reference. The set must
  // be complete enough to satisfy `assertColumnCodecIntegrity` against any
  // emitted test contract; the encode/decode bodies are passthrough since
  // the stub adapter never executes against a real driver.
  // The encode/decode bodies pass through; widen TInput to a JSON-safe type
  // so `defineTestCodec` does not require explicit JSON round-trip helpers.
  const passthroughCodec = (typeId: string, targetType: string): Codec<string> =>
    defineTestCodec({
      typeId,
      targetTypes: [targetType],
      encode: (value: string | number | boolean | null) => value,
      decode: (wire: string | number | boolean | null) => wire,
    });
  const codecs: ReadonlyArray<Codec<string>> = [
    passthroughCodec('pg/bit@1', 'bit'),
    passthroughCodec('pg/bool@1', 'bool'),
    passthroughCodec('pg/bytea@1', 'bytea'),
    passthroughCodec('pg/float4@1', 'float4'),
    passthroughCodec('pg/float8@1', 'float8'),
    passthroughCodec('pg/int2@1', 'int2'),
    defineTestCodec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    }),
    passthroughCodec('pg/int8@1', 'int8'),
    passthroughCodec('pg/interval@1', 'interval'),
    passthroughCodec('pg/json@1', 'json'),
    passthroughCodec('pg/jsonb@1', 'jsonb'),
    passthroughCodec('pg/numeric@1', 'numeric'),
    defineTestCodec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
    passthroughCodec('pg/time@1', 'time'),
    defineTestCodec({
      typeId: 'pg/timestamp@1',
      targetTypes: ['timestamp'],
      encode: (value: Date) => value,
      decode: (wire: Date) => wire,
      encodeJson: (value: Date) => value.toISOString(),
      decodeJson: (json) => {
        if (typeof json !== 'string') throw new Error('expected ISO date string');
        return new Date(json);
      },
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
    passthroughCodec('pg/timetz@1', 'timetz'),
    passthroughCodec('pg/varbit@1', 'varbit'),
    passthroughCodec('pg/uuid@1', 'uuid'),
    passthroughCodec('sql/char@1', 'char'),
    passthroughCodec('sql/varchar@1', 'varchar'),
  ];

  return {
    __codecs: codecs,
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst, _ctx: { contract: Contract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      const refs = ast.collectParamRefs();
      const params = refs.map((ref) =>
        ref.kind === 'prepared-param-ref'
          ? ({ kind: 'bind' as const, name: ref.name } as const)
          : ({ kind: 'literal' as const, value: ref.value } as const),
      );
      return Object.freeze({ sql: sqlText, params });
    },
  };
}

export function unboundNamespaceWithTables(
  tables: Record<string, StorageTableInput>,
): ReturnType<typeof buildSqlNamespace> {
  return buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, tables });
}

export function emptySqlTestDomain() {
  return applicationDomainOf({ models: {} });
}

export function createTestContract(
  contract: Partial<Omit<Contract<SqlStorage>, 'profileHash' | 'storage' | 'domain'>> & {
    storageHash?: string;
    profileHash?: string;
    models?: Record<string, ContractModelBase>;
    domain?: Contract<SqlStorage>['domain'];
    storage?: Partial<Omit<SqlStorageInput, 'storageHash'>>;
  },
): Contract<SqlStorage> {
  const { execution, ...rest } = contract;
  const storageHashValue = coreHash(rest['storageHash'] ?? 'sha256:testcore');

  return {
    target: rest['target'] ?? 'postgres',
    targetFamily: rest['targetFamily'] ?? 'sql',
    storage: rest['storage']
      ? new SqlStorage({
          ...rest['storage'],
          storageHash: storageHashValue,
          namespaces: rest['storage'].namespaces ?? { __unbound__: SqlUnboundNamespace.instance },
        })
      : new SqlStorage({
          storageHash: storageHashValue,
          namespaces: { __unbound__: SqlUnboundNamespace.instance },
        }),
    domain: rest['domain'] ?? applicationDomainOf({ models: rest['models'] ?? {} }),
    roots: rest['roots'] ?? {},
    capabilities: rest['capabilities'] ?? {},
    extensionPacks: rest['extensionPacks'] ?? {},
    meta: rest['meta'] ?? {},
    ...(execution ? { execution } : {}),
    profileHash: profileHash(rest['profileHash'] ?? 'sha256:testprofile'),
  };
}

export function stubAst(): AnyQueryAst {
  return SelectAstCtor.from(TableSource.named('stub'));
}

// Re-export generic utilities from test-utils
export {
  collectAsync,
  createDevDatabase,
  type DevDatabase,
  teardownTestDatabase,
  withClient,
} from '@prisma-next/test-utils';

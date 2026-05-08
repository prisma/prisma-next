import type { Contract, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { AnyCodecDescriptor, CodecDescriptor } from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import type { ComponentDescriptor } from '@prisma-next/framework-components/components';
import { checkContractComponentRequirements } from '@prisma-next/framework-components/components';
import {
  createExecutionStack,
  type ExecutionStack,
  type RuntimeAdapterDescriptor,
  type RuntimeAdapterInstance,
  type RuntimeDriverDescriptor,
  type RuntimeDriverInstance,
  type RuntimeExtensionDescriptor,
  type RuntimeExtensionInstance,
  type RuntimeTargetDescriptor,
  type RuntimeTargetInstance,
} from '@prisma-next/framework-components/execution';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  createSqlOperationRegistry,
  type SqlOperationDescriptor,
} from '@prisma-next/sql-operations';
import type {
  Adapter,
  AnyQueryAst,
  Codec,
  CodecRegistry,
  ContractCodecRegistry,
  LoweredStatement,
  SqlCodecInstanceContext,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import { buildCodecDescriptorRegistry } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import type {
  AppliedMutationDefault,
  CodecDescriptorRegistry,
  ExecutionContext,
  MutationDefaultsOptions,
  TypeHelperRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';

/**
 * Runtime parameterized codec descriptor.
 *
 * The unified `CodecDescriptor<P>` shape applied to parameterized codecs
 * — `paramsSchema: StandardSchemaV1<P>` for JSON-boundary validation,
 * `factory: (P) => (CodecInstanceContext) => Codec` for the curried higher-order codec.
 * The factory is called once per `storage.types` instance (or once per
 * inline-`typeParams` column); per-instance state lives in the closure.
 *
 * Codec-registry-unification spec § Decision.
 */
export type RuntimeParameterizedCodecDescriptor<P = Record<string, unknown>> = CodecDescriptor<P>;

/**
 * Contributor protocol for SQL components (target, adapter, extension
 * pack). The unified `codecs:` slot returns the full
 * {@link CodecDescriptor} list — non-parameterized and parameterized
 * descriptors live side-by-side in the same array. The framework
 * dispatches every codec id through the unified descriptor map without
 * branching on parameterization.
 */
export interface SqlStaticContributions {
  readonly codecs: () => ReadonlyArray<AnyCodecDescriptor>;
  readonly queryOperations?: () => ReadonlyArray<SqlOperationDescriptor>;
  readonly mutationDefaultGenerators?: () => ReadonlyArray<RuntimeMutationDefaultGenerator>;
}

/**
 * Scope across which a generator's value is constant.
 *
 * - `'field'` — one value per defaulting site (one column, one row).
 *   Cache strategy: no cache; call per defaulting site. Right for
 *   per-row identifiers (UUIDs, CUIDs, ULIDs, nanoid, ksuid).
 * - `'row'` — one value across all defaulting sites of one row of one
 *   operation. Cache strategy: per-call cache keyed by `generatorId`.
 *   Right for correlation ids stamped into multiple columns of one row.
 * - `'query'` — one value across all rows and columns of one ORM
 *   operation. Cache strategy: caller-provided cache keyed by
 *   `generatorId`. Right for `timestampNow` (a single timestamp per
 *   bulk insert/update).
 */
export type GeneratorStability = 'field' | 'row' | 'query';

export interface RuntimeMutationDefaultGenerator {
  readonly id: string;
  readonly generate: (params?: Record<string, unknown>) => unknown;
  /**
   * Scope across which the generator's value is constant. The framework
   * derives the cache strategy from this declaration; generator authors
   * never need to know about cache keys. See `GeneratorStability` for
   * the per-value semantics.
   */
  readonly stability: GeneratorStability;
}

export interface SqlRuntimeTargetDescriptor<
  TTargetId extends string = string,
  TTargetInstance extends RuntimeTargetInstance<'sql', TTargetId> = RuntimeTargetInstance<
    'sql',
    TTargetId
  >,
> extends RuntimeTargetDescriptor<'sql', TTargetId, TTargetInstance>,
    SqlStaticContributions {}

export interface SqlRuntimeAdapterDescriptor<
  TTargetId extends string = string,
  TAdapterInstance extends RuntimeAdapterInstance<
    'sql',
    TTargetId
  > = SqlRuntimeAdapterInstance<TTargetId>,
> extends RuntimeAdapterDescriptor<'sql', TTargetId, TAdapterInstance>,
    SqlStaticContributions {}

export interface SqlRuntimeExtensionDescriptor<TTargetId extends string = string>
  extends RuntimeExtensionDescriptor<'sql', TTargetId, SqlRuntimeExtensionInstance<TTargetId>>,
    SqlStaticContributions {
  create(): SqlRuntimeExtensionInstance<TTargetId>;
}

export interface SqlExecutionStack<TTargetId extends string = string> {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId>;
  readonly extensionPacks: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}

export type SqlExecutionStackWithDriver<TTargetId extends string = string> = Omit<
  ExecutionStack<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>,
    SqlRuntimeDriverInstance<TTargetId>,
    SqlRuntimeExtensionInstance<TTargetId>
  >,
  'target' | 'adapter' | 'driver' | 'extensionPacks'
> & {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId, SqlRuntimeAdapterInstance<TTargetId>>;
  readonly driver:
    | RuntimeDriverDescriptor<'sql', TTargetId, unknown, SqlRuntimeDriverInstance<TTargetId>>
    | undefined;
  readonly extensionPacks: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
};

export interface SqlRuntimeExtensionInstance<TTargetId extends string>
  extends RuntimeExtensionInstance<'sql', TTargetId> {}

export type SqlRuntimeAdapterInstance<TTargetId extends string = string> = RuntimeAdapterInstance<
  'sql',
  TTargetId
> &
  Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;

/**
 * NOTE: Binding type is intentionally erased to unknown at this shared runtime layer.
 * Target clients (for example `postgres()`) validate and construct the concrete binding
 * before calling `driver.connect(binding)`, which keeps runtime behavior safe today.
 * A future follow-up can preserve TBinding through stack/context generics end-to-end.
 */
export type SqlRuntimeDriverInstance<TTargetId extends string = string> = RuntimeDriverInstance<
  'sql',
  TTargetId
> &
  SqlDriver<unknown>;

export function createSqlExecutionStack<TTargetId extends string>(options: {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId>;
  readonly driver?:
    | RuntimeDriverDescriptor<'sql', TTargetId, unknown, SqlRuntimeDriverInstance<TTargetId>>
    | undefined;
  readonly extensionPacks?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[] | undefined;
}): SqlExecutionStackWithDriver<TTargetId> {
  return createExecutionStack({
    target: options.target,
    adapter: options.adapter,
    driver: options.driver,
    extensionPacks: options.extensionPacks,
  });
}

export type { ExecutionContext, TypeHelperRegistry };

export function assertExecutionStackContractRequirements(
  contract: Contract<SqlStorage>,
  stack: SqlExecutionStack,
): void {
  const providedComponentIds = new Set<string>([
    stack.target.id,
    stack.adapter.id,
    ...stack.extensionPacks.map((pack) => pack.id),
  ]);

  const result = checkContractComponentRequirements({
    contract,
    expectedTargetFamily: 'sql',
    expectedTargetId: stack.target.targetId,
    providedComponentIds,
  });

  if (result.familyMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_FAMILY_MISMATCH',
      `Contract target family '${result.familyMismatch.actual}' does not match runtime family '${result.familyMismatch.expected}'.`,
      {
        actual: result.familyMismatch.actual,
        expected: result.familyMismatch.expected,
      },
    );
  }

  if (result.targetMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_TARGET_MISMATCH',
      `Contract target '${result.targetMismatch.actual}' does not match runtime target descriptor '${result.targetMismatch.expected}'.`,
      {
        actual: result.targetMismatch.actual,
        expected: result.targetMismatch.expected,
      },
    );
  }

  if (result.missingExtensionPackIds.length > 0) {
    const packIds = result.missingExtensionPackIds;
    const packList = packIds.map((id) => `'${id}'`).join(', ');
    throw runtimeError(
      'RUNTIME.MISSING_EXTENSION_PACK',
      `Contract requires extension pack(s) ${packList}, but runtime descriptors do not provide matching component(s).`,
      { packIds },
    );
  }
}

function validateTypeParams(
  typeParams: Record<string, unknown>,
  descriptor: RuntimeParameterizedCodecDescriptor,
  context: { typeName?: string; tableName?: string; columnName?: string },
): Record<string, unknown> {
  const result = descriptor.paramsSchema['~standard'].validate(typeParams);
  if (result instanceof Promise) {
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `paramsSchema for codec '${descriptor.codecId}' returned a Promise; runtime validation requires a synchronous Standard Schema validator.`,
      { ...context, codecId: descriptor.codecId, typeParams },
    );
  }
  if (result.issues) {
    const messages = result.issues.map((issue) => issue.message).join('; ');
    const locationInfo = context.typeName
      ? `type '${context.typeName}'`
      : `column '${context.tableName}.${context.columnName}'`;
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for ${locationInfo} (codecId: ${descriptor.codecId}): ${messages}`,
      { ...context, codecId: descriptor.codecId, typeParams },
    );
  }
  return result.value as Record<string, unknown>;
}

/**
 * Collect every {@link CodecDescriptor} contributed by the SQL stack and
 * partition into "parameterized" vs "non-parameterized" by reference-
 * equality with the framework-supplied {@link voidParamsSchema}. Every
 * non-parameterized class-form descriptor falls back to the singleton
 * `voidParamsSchema` for `paramsSchema`; parameterized descriptors author
 * their own
 * `paramsSchema`, so the singleton check classifies them as
 * parameterized regardless of how permissive the validator is. The
 * heuristic survives "validators that accept everything" (test stubs).
 *
 * The unified descriptor list collapses the legacy split (a separate
 * slot used to register parameterized codecs) — every codec id resolves
 * through the same map (codec-registry-unification spec § Decision).
 */
function collectCodecDescriptors(contributors: ReadonlyArray<SqlStaticContributions>): {
  readonly all: ReadonlyArray<AnyCodecDescriptor>;
  readonly parameterized: Map<string, RuntimeParameterizedCodecDescriptor>;
} {
  const all: AnyCodecDescriptor[] = [];
  const parameterized = new Map<string, RuntimeParameterizedCodecDescriptor>();
  const seen = new Set<string>();

  for (const contributor of contributors) {
    for (const descriptor of contributor.codecs()) {
      if (seen.has(descriptor.codecId)) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_CODEC',
          `Duplicate codec descriptor for codecId '${descriptor.codecId}'.`,
          { codecId: descriptor.codecId },
        );
      }
      seen.add(descriptor.codecId);
      all.push(descriptor);

      if (descriptor.paramsSchema !== voidParamsSchema) {
        // The descriptor authored its own params schema → parameterized.
        // Cast widens the descriptor's heterogeneous `P` to the runtime
        // alias surface; consumers narrow per codec id at the dispatch
        // site, where the descriptor's own `paramsSchema` validates
        // JSON-sourced params before the factory ever sees them.
        parameterized.set(
          descriptor.codecId,
          descriptor as unknown as RuntimeParameterizedCodecDescriptor,
        );
      }
    }
  }

  return { all, parameterized };
}

function collectTypeRefSites(
  storage: SqlStorage,
): Map<string, Array<{ readonly table: string; readonly column: string }>> {
  const sites = new Map<string, Array<{ readonly table: string; readonly column: string }>>();
  for (const [tableName, table] of Object.entries(storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (typeof column.typeRef !== 'string') continue;
      const list = sites.get(column.typeRef);
      const entry = { table: tableName, column: columnName };
      if (list) {
        list.push(entry);
      } else {
        sites.set(column.typeRef, [entry]);
      }
    }
  }
  return sites;
}

function initializeTypeHelpers(
  storage: SqlStorage,
  codecDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): TypeHelperRegistry {
  const helpers: TypeHelperRegistry = {};
  const storageTypes = storage.types;

  if (!storageTypes) {
    return helpers;
  }

  const typeRefSites = collectTypeRefSites(storage);

  for (const [typeName, typeInstance] of Object.entries(storageTypes)) {
    const descriptor = codecDescriptors.get(typeInstance.codecId);

    if (!descriptor) {
      // No parameterized descriptor for this codec id — store the raw
      // type instance for callers that need typeParams metadata.
      helpers[typeName] = typeInstance;
      continue;
    }

    const validatedParams = validateTypeParams(typeInstance.typeParams, descriptor, {
      typeName,
    });

    const usedAt = typeRefSites.get(typeName) ?? [];
    const ctx: SqlCodecInstanceContext = { name: typeName, usedAt };
    helpers[typeName] = descriptor.factory(validatedParams)(ctx);
  }

  return helpers;
}

function validateColumnTypeParams(
  storage: SqlStorage,
  codecDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): void {
  for (const [tableName, table] of Object.entries(storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.typeParams) {
        const descriptor = codecDescriptors.get(column.codecId);
        if (descriptor) {
          validateTypeParams(column.typeParams, descriptor, { tableName, columnName });
        }
      }
    }
  }
}

function isResolvedCodec(candidate: unknown): candidate is Codec {
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    'id' in candidate &&
    'decode' in candidate
  );
}

/**
 * Walk the contract's `storage.tables[].columns[]` and resolve each
 * column to a `Codec` through the unified descriptor map. Per-instance
 * behavior:
 *
 * - **typeRef columns**: reuse the resolved codec materialized once by
 *   `initializeTypeHelpers` for the `storage.types` entry. Multiple
 *   columns sharing one typeRef share one codec instance.
 * - **inline-typeParams columns**: call `descriptor.factory(typeParams)
 *   (ctx)` once per column (per-column anonymous instance).
 * - **non-parameterized columns**: call `descriptor.factory()(ctx)`
 *   once. The synthesized descriptor's factory is constant — every call
 *   returns the same shared codec instance — so columns sharing a non-
 *   parameterized codec id share one resolved codec without explicit
 *   caching.
 *
 * Codec-registry-unification spec § AC-4: every column resolves through
 * one descriptor map without branching on parameterization. JSON-Schema
 * validation, when required, lives inside the resolved codec's `decode`
 * body (see `arktype-json`'s `ArktypeJsonCodecClass`); the framework
 * no longer maintains a parallel validator registry.
 */
function buildContractCodecRegistry(
  contract: Contract<SqlStorage>,
  codecDescriptors: CodecDescriptorRegistry,
  legacyCodecRegistry: CodecRegistry,
  types: TypeHelperRegistry,
  parameterizedDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): ContractCodecRegistry {
  const byColumn = new Map<string, Codec>();
  const byCodecId = new Map<string, Codec>();
  // Codec ids whose `byCodecId` entry is ambiguous — multiple distinct
  // resolved instances landed under the same parameterized codec id
  // (e.g. `Vector<1024>` and `Vector<1536>` both registering under
  // `pg/vector@1`). The refs-less `forCodecId` fallback rejects these
  // ids so a DSL-param without a column ref cannot silently bind to
  // the wrong instance. The validator pass enforces refs on every
  // parameterized `ParamRef`, so this branch is reachable only as a
  // defensive guard for non-parameterized columns whose `byCodecId`
  // entry is unique by construction.
  const ambiguousCodecIds = new Set<string>();

  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      const columnKey = `${tableName}.${columnName}`;
      const descriptor = codecDescriptors.descriptorFor(column.codecId);

      let resolvedCodec: Codec | undefined;

      if (descriptor) {
        const isParameterized = parameterizedDescriptors.has(column.codecId);

        if (column.typeRef) {
          // The named instance was already materialized once by
          // `initializeTypeHelpers`; reuse it so multiple columns sharing
          // the same typeRef share one codec instance (and any per-
          // instance helper state on it).
          const helper = types[column.typeRef];
          if (isResolvedCodec(helper)) {
            resolvedCodec = helper;
          }
        } else if (column.typeParams && isParameterized) {
          const parameterizedDescriptor = parameterizedDescriptors.get(column.codecId);
          if (parameterizedDescriptor) {
            const validatedParams = validateTypeParams(column.typeParams, parameterizedDescriptor, {
              tableName,
              columnName,
            });
            const ctx: SqlCodecInstanceContext = {
              name: `<anon:${tableName}.${columnName}>`,
              usedAt: [{ table: tableName, column: columnName }],
            };
            resolvedCodec = parameterizedDescriptor.factory(validatedParams)(ctx);
          }
        } else if (!isParameterized) {
          // Non-parameterized column. Cache the resolved codec by codec
          // id — non-parameterized descriptors' factories are constant
          // (every call returns the same shared codec instance), so
          // columns sharing this codec id share one resolved instance.
          let cached = byCodecId.get(column.codecId);
          if (!cached) {
            const ctx: SqlCodecInstanceContext = {
              name: `<shared:${column.codecId}>`,
              usedAt: [{ table: tableName, column: columnName }],
            };
            // The descriptor's `P` is `void` for non-parameterized
            // codecs; the runtime's `void` value is `undefined`. The
            // cast narrows the descriptor's family-agnostic
            // `CodecInstanceContext` slot to the SQL
            // `SqlCodecInstanceContext` we pass at this call site —
            // function-argument contravariance makes the narrow safe.
            const voidFactory = descriptor.factory as unknown as (
              params: undefined,
            ) => (ctx: SqlCodecInstanceContext) => Codec;
            cached = voidFactory(undefined)(ctx);
            byCodecId.set(column.codecId, cached);
          }
          resolvedCodec = cached;
        }
        // else: parameterized codec id with no typeRef and no
        // typeParams — this is the legitimate "undimensioned" form for
        // codecs that ship a no-params column variant alongside a
        // parameterized one (e.g. pgvector's `vectorColumn` vs.
        // `vector(N)`). Leave `resolvedCodec` undefined; encode/decode
        // for this column flows through `forCodecId`. The fallback
        // works for these cases because their wire format is
        // params-independent (vector formats `[v1,v2,...]` regardless
        // of declared length).
      }

      if (resolvedCodec) {
        byColumn.set(columnKey, resolvedCodec);
        const existing = byCodecId.get(column.codecId);
        if (existing === undefined) {
          byCodecId.set(column.codecId, resolvedCodec);
        } else if (existing !== resolvedCodec && parameterizedDescriptors.has(column.codecId)) {
          ambiguousCodecIds.add(column.codecId);
        }
      }
    }
  }

  const registry: ContractCodecRegistry = {
    forColumn(table, column) {
      return byColumn.get(`${table}.${column}`);
    },
    forCodecId(codecId) {
      // Codec-id-only fallback for refs-less sites. The validator pass
      // (`validateParamRefRefs`) enforces refs on every parameterized
      // `ParamRef` before encode, so this path is only legitimately
      // reachable for non-parameterized codec ids. Prefer the
      // contract-walk-derived shared codec; fall back to the legacy
      // `codecRegistry.get` for parameterized codec ids whose contracts
      // don't have a typeRef/typeParams column the walk could resolve
      // through.
      //
      // Reject ambiguous parameterized fallbacks: if the contract walk
      // resolved more than one distinct codec instance under this id
      // (e.g. multiple vector dimensions, multiple arktype-json
      // schemas), the codec-id-keyed lookup cannot honor the call site
      // — fail fast rather than bind to whichever instance happened to
      // land first.
      if (ambiguousCodecIds.has(codecId)) {
        throw runtimeError(
          'RUNTIME.TYPE_PARAMS_INVALID',
          `Codec '${codecId}' resolves to multiple parameterized instances; column-aware dispatch is required.`,
          { codecId },
        );
      }
      return byCodecId.get(codecId) ?? legacyCodecRegistry.get(codecId);
    },
  };

  return registry;
}

function assertMutationDefaultGeneratorsAvailable(
  contract: Contract<SqlStorage>,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
): void {
  const defaults = contract.execution?.mutations.defaults ?? [];
  if (defaults.length === 0) return;

  const missing = new Set<string>();
  for (const mutationDefault of defaults) {
    for (const phase of [mutationDefault.onCreate, mutationDefault.onUpdate]) {
      if (!phase) continue;
      if (phase.kind === 'generator' && !generatorRegistry.has(phase.id)) {
        missing.add(phase.id);
      }
    }
  }

  if (missing.size === 0) return;

  const ids = Array.from(missing);
  const idList = ids.map((id) => `'${id}'`).join(', ');
  throw runtimeError(
    'RUNTIME.MISSING_MUTATION_DEFAULT_GENERATOR',
    `Contract requires mutation default generator(s) ${idList}, but no runtime component provides them.`,
    { ids },
  );
}

function collectMutationDefaultGenerators(
  contributors: ReadonlyArray<SqlStaticContributions & { readonly id: string }>,
): ReadonlyMap<string, RuntimeMutationDefaultGenerator> {
  const generators = new Map<string, RuntimeMutationDefaultGenerator>();
  const owners = new Map<string, string>();

  for (const contributor of contributors) {
    const nextGenerators = contributor.mutationDefaultGenerators?.() ?? [];
    for (const generator of nextGenerators) {
      const existingOwner = owners.get(generator.id);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
          `Duplicate mutation default generator '${generator.id}'.`,
          {
            id: generator.id,
            existingOwner,
            incomingOwner: contributor.id,
          },
        );
      }
      generators.set(generator.id, generator);
      owners.set(generator.id, contributor.id);
    }
  }

  return generators;
}

function computeExecutionDefaultValue(
  spec: ExecutionMutationDefaultValue,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
): unknown {
  switch (spec.kind) {
    case 'generator': {
      const generator = generatorRegistry.get(spec.id);
      if (!generator) {
        throw runtimeError(
          'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
          `Contract references mutation default generator '${spec.id}' but no runtime component provides it.`,
          {
            id: spec.id,
          },
        );
      }
      // nosemgrep: javascript.express.security.express-wkhtml-injection.express-wkhtmltoimage-injection
      return generator.generate(spec.params);
    }
  }
}

function applyMutationDefaults(
  contract: Contract<SqlStorage>,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
  options: MutationDefaultsOptions,
): ReadonlyArray<AppliedMutationDefault> {
  const defaults = contract.execution?.mutations.defaults ?? [];
  if (defaults.length === 0) {
    return [];
  }

  const isEmptyUpdate = options.op === 'update' && Object.keys(options.values).length === 0;

  const applied: AppliedMutationDefault[] = [];
  const appliedColumns = new Set<string>();
  // Fresh per-call cache for `stability: 'row'` generators — they share
  // across columns of a single row but regenerate on the next call.
  const rowCache = new Map<string, unknown>();

  for (const mutationDefault of defaults) {
    if (mutationDefault.ref.table !== options.table) {
      continue;
    }

    const defaultSpec =
      options.op === 'create' ? mutationDefault.onCreate : mutationDefault.onUpdate;
    if (!defaultSpec) {
      continue;
    }

    // RD2: empty update payloads skip onUpdate defaults — no write means
    // no `@updatedAt` advance.
    if (isEmptyUpdate) {
      continue;
    }

    const columnName = mutationDefault.ref.column;
    if (Object.hasOwn(options.values, columnName) || appliedColumns.has(columnName)) {
      continue;
    }

    applied.push({
      column: columnName,
      value: resolveScopedValue(
        defaultSpec,
        generatorRegistry,
        rowCache,
        options.defaultValueCache,
      ),
    });
    appliedColumns.add(columnName);
  }

  return applied;
}

function resolveScopedValue(
  spec: ExecutionMutationDefaultValue,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
  rowCache: Map<string, unknown>,
  queryCache: Map<string, unknown> | undefined,
): unknown {
  if (spec.kind !== 'generator') {
    return computeExecutionDefaultValue(spec, generatorRegistry);
  }
  const generator = generatorRegistry.get(spec.id);
  const cache = scopedCache(generator?.stability, rowCache, queryCache);
  if (!cache) {
    return computeExecutionDefaultValue(spec, generatorRegistry);
  }
  if (cache.has(spec.id)) {
    return cache.get(spec.id);
  }
  const value = computeExecutionDefaultValue(spec, generatorRegistry);
  cache.set(spec.id, value);
  return value;
}

function scopedCache(
  stability: GeneratorStability | undefined,
  rowCache: Map<string, unknown>,
  queryCache: Map<string, unknown> | undefined,
): Map<string, unknown> | undefined {
  switch (stability) {
    case 'row':
      return rowCache;
    case 'query':
      return queryCache;
    default:
      return undefined;
  }
}

export function createExecutionContext<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
  TTargetId extends string = string,
>(options: {
  readonly contract: TContract;
  readonly stack: SqlExecutionStack<TTargetId>;
}): ExecutionContext<TContract> {
  const { contract, stack } = options;

  assertExecutionStackContractRequirements(contract, stack);

  const contributors: Array<SqlStaticContributions & ComponentDescriptor<string>> = [
    stack.target,
    stack.adapter,
    ...stack.extensionPacks,
  ];

  const { all: allCodecDescriptors, parameterized: parameterizedCodecDescriptors } =
    collectCodecDescriptors(contributors);

  // Materialize the runtime codec view by calling
  // `descriptor.factory(undefined)(ctx)` once per descriptor. For non-
  // parameterized descriptors the factory is constant — every call
  // yields the same shared codec. For parameterized descriptors whose
  // factory tolerates `undefined` (pgvector's factory ignores its
  // params and returns the same shared codec), the materialization
  // produces a representative codec instance the `forCodecId` fallback
  // can hand out for refs-less call sites (the AC-5 carve-out path for
  // parameter encoding); descriptors whose factory needs real params
  // (arktype-json) raise — skip them and let the per-column dispatch
  // path handle materialization lazily.
  const codecMap = new Map<string, Codec<string>>();
  const codecRegistry: CodecRegistry = {
    get: (id) => codecMap.get(id),
    has: (id) => codecMap.has(id),
    register: (c) => {
      if (codecMap.has(c.id)) {
        throw new Error(`Codec with ID '${c.id}' is already registered`);
      }
      codecMap.set(c.id, c);
    },
    values: () => codecMap.values(),
    [Symbol.iterator]: function* () {
      yield* codecMap.values();
    },
  };
  for (const descriptor of allCodecDescriptors) {
    const ctx: SqlCodecInstanceContext = {
      name: `<shared:${descriptor.codecId}>`,
      usedAt: [],
    };
    // The descriptor's `P` is heterogeneous; for non-parameterized
    // descriptors it's `void` and runtime value is `undefined`, for
    // parameterized descriptors `undefined` may be tolerated (pgvector)
    // or raise (arktype-json — needs `jsonIr`). The cast narrows the
    // family-agnostic `CodecInstanceContext` to the SQL extension
    // supplied at this call site (contravariant input narrow is safe).
    const factory = descriptor.factory as unknown as (
      params: unknown,
    ) => (ctx: SqlCodecInstanceContext) => Codec;
    try {
      codecRegistry.register(factory(undefined)(ctx));
    } catch {
      // Parameterized descriptor whose factory needs real params; skip
      // here and let the per-column dispatch path materialize lazily.
    }
  }

  const queryOperationRegistry = createSqlOperationRegistry();
  for (const contributor of contributors) {
    for (const op of contributor.queryOperations?.() ?? []) {
      queryOperationRegistry.register(op);
    }
  }

  const codecDescriptors = buildCodecDescriptorRegistry(allCodecDescriptors);
  const mutationDefaultGeneratorRegistry = collectMutationDefaultGenerators(contributors);
  assertMutationDefaultGeneratorsAvailable(contract, mutationDefaultGeneratorRegistry);

  if (parameterizedCodecDescriptors.size > 0) {
    validateColumnTypeParams(contract.storage, parameterizedCodecDescriptors);
  }

  const types = initializeTypeHelpers(contract.storage, parameterizedCodecDescriptors);

  const contractCodecs = buildContractCodecRegistry(
    contract,
    codecDescriptors,
    codecRegistry,
    types,
    parameterizedCodecDescriptors,
  );

  return {
    contract,
    codecs: codecRegistry,
    contractCodecs,
    codecDescriptors,
    queryOperations: queryOperationRegistry,
    types,
    applyMutationDefaults: (options) =>
      applyMutationDefaults(contract, mutationDefaultGeneratorRegistry, options),
  };
}

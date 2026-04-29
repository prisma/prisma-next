import type { Contract, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  CodecDescriptor,
  ParameterizedCodecDescriptor,
} from '@prisma-next/framework-components/codec';
import { synthesizeNonParameterizedDescriptor } from '@prisma-next/framework-components/codec';
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
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  AppliedMutationDefault,
  CodecDescriptorRegistry,
  ExecutionContext,
  JsonSchemaValidateFn,
  JsonSchemaValidatorRegistry,
  MutationDefaultsOptions,
  TypeHelperRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';

/**
 * Runtime parameterized codec descriptor.
 *
 * Carries the curried-factory shape contributed by `ParameterizedCodecDescriptor`:
 * `factory: (P) => (Ctx) => Codec` plus `paramsSchema: StandardSchemaV1<P>` and an
 * optional `renderOutputType`. There is no separate `init` hook — the higher-order
 * factory IS what `init` was; per-instance state lives on the codec the factory
 * returns. See [ADR 205 — Higher-order codecs for parameterized types](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */
export type RuntimeParameterizedCodecDescriptor<P = Record<string, unknown>> =
  ParameterizedCodecDescriptor<P>;

export interface SqlStaticContributions {
  readonly codecs: () => CodecRegistry;
  // biome-ignore lint/suspicious/noExplicitAny: needed for covariance with concrete descriptor types
  readonly parameterizedCodecs: () => ReadonlyArray<RuntimeParameterizedCodecDescriptor<any>>;
  readonly queryOperations?: () => ReadonlyArray<SqlOperationDescriptor>;
  readonly mutationDefaultGenerators?: () => ReadonlyArray<RuntimeMutationDefaultGenerator>;
}

export interface RuntimeMutationDefaultGenerator {
  readonly id: string;
  readonly generate: (params?: Record<string, unknown>) => unknown;
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

export type { ExecutionContext, JsonSchemaValidatorRegistry, TypeHelperRegistry };

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
  codecDescriptor: RuntimeParameterizedCodecDescriptor,
  context: { typeName?: string; tableName?: string; columnName?: string },
): Record<string, unknown> {
  const result = codecDescriptor.paramsSchema['~standard'].validate(typeParams);
  if (result instanceof Promise) {
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `paramsSchema for codec '${codecDescriptor.codecId}' returned a Promise; runtime validation requires a synchronous Standard Schema validator.`,
      { ...context, codecId: codecDescriptor.codecId, typeParams },
    );
  }
  if (result.issues) {
    const messages = result.issues.map((issue) => issue.message).join('; ');
    const locationInfo = context.typeName
      ? `type '${context.typeName}'`
      : `column '${context.tableName}.${context.columnName}'`;
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for ${locationInfo} (codecId: ${codecDescriptor.codecId}): ${messages}`,
      { ...context, codecId: codecDescriptor.codecId, typeParams },
    );
  }
  return result.value as Record<string, unknown>;
}

function collectParameterizedCodecDescriptors(
  contributors: ReadonlyArray<SqlStaticContributions>,
): Map<string, RuntimeParameterizedCodecDescriptor> {
  const descriptors = new Map<string, RuntimeParameterizedCodecDescriptor>();

  for (const contributor of contributors) {
    for (const descriptor of contributor.parameterizedCodecs()) {
      if (descriptors.has(descriptor.codecId)) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_PARAMETERIZED_CODEC',
          `Duplicate parameterized codec descriptor for codecId '${descriptor.codecId}'.`,
          { codecId: descriptor.codecId },
        );
      }
      descriptors.set(descriptor.codecId, descriptor);
    }
  }

  return descriptors;
}

/**
 * Build the unified descriptor map. Combines parameterized descriptors (which
 * already ship as `CodecDescriptor`s) with synthesized descriptors for non-
 * parameterized codecs registered through the legacy `codecs:` slot. Codec ids
 * that ship a parameterized descriptor take precedence — even when the legacy
 * registry registers a representative codec under the same id, the
 * parameterized descriptor is the authoritative source.
 *
 * Codec-registry-unification spec § Decision: every codec resolves through one
 * descriptor map; reads are non-branching.
 */
function buildCodecDescriptorRegistry(
  codecRegistry: CodecRegistry,
  parameterizedDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): CodecDescriptorRegistry {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous descriptor map; consumers narrow per codec.
  type AnyDescriptor = CodecDescriptor<any>;
  const byId = new Map<string, AnyDescriptor>();
  const byTargetType = new Map<string, Array<AnyDescriptor>>();

  function registerInIndices(descriptor: AnyDescriptor): void {
    byId.set(descriptor.codecId, descriptor);
    for (const targetType of descriptor.targetTypes) {
      const list = byTargetType.get(targetType);
      if (list) {
        list.push(descriptor);
      } else {
        byTargetType.set(targetType, [descriptor]);
      }
    }
  }

  for (const descriptor of parameterizedDescriptors.values()) {
    registerInIndices(descriptor);
  }

  for (const codec of codecRegistry.values()) {
    if (byId.has(codec.id)) continue;
    registerInIndices(synthesizeNonParameterizedDescriptor(codec));
  }

  return {
    descriptorFor(codecId: string): AnyDescriptor | undefined {
      return byId.get(codecId);
    },
    *values(): IterableIterator<AnyDescriptor> {
      yield* byId.values();
    },
    byTargetType(targetType: string): readonly AnyDescriptor[] {
      return byTargetType.get(targetType) ?? Object.freeze([]);
    },
  };
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
      helpers[typeName] = typeInstance;
      continue;
    }

    const validatedParams = validateTypeParams(typeInstance.typeParams, descriptor, {
      typeName,
    });

    const usedAt = typeRefSites.get(typeName) ?? [];
    helpers[typeName] = descriptor.factory(validatedParams)({
      name: typeName,
      usedAt,
    });
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

/**
 * View of a codec that exposes a per-instance JSON-schema `validate` function.
 * Codecs declare this contract by including the `'json-validator'` `CodecTrait`
 * in their `traits` array; the trait is the gate that lets `extractValidator`
 * resolve from structurally-typed `unknown` to this typed view.
 */
type JsonValidatorCodec = {
  readonly traits?: ReadonlyArray<unknown>;
  readonly validate: JsonSchemaValidateFn;
};

function hasJsonValidatorTrait(candidate: unknown): candidate is JsonValidatorCodec {
  if (candidate === null || typeof candidate !== 'object') return false;
  const traits = (candidate as { readonly traits?: unknown }).traits;
  if (!Array.isArray(traits)) return false;
  if (!traits.includes('json-validator')) return false;
  const validate = (candidate as { readonly validate?: unknown }).validate;
  return typeof validate === 'function';
}

/**
 * Gate the `validate` extraction on the `'json-validator'` `CodecTrait`.
 * Codecs that participate in the JSON-schema validator registry must declare
 * the trait; the read of `validate` is then a typed field-access on
 * `JsonValidatorCodec` rather than a generic `unknown` cast. See ADR 205.
 */
function extractValidator(candidate: unknown): JsonSchemaValidateFn | undefined {
  return hasJsonValidatorTrait(candidate) ? candidate.validate : undefined;
}

/**
 * Walk the contract's `storage.tables[].columns[]` and resolve each column to
 * a `Codec` through the unified descriptor map. Index by `${table}.${column}`.
 *
 * Per-instance behavior:
 * - **typeRef columns**: reuse the resolved codec materialized once by
 *   `initializeTypeHelpers` for the `storage.types` entry. Multiple columns
 *   sharing one typeRef share one codec instance.
 * - **inline-typeParams columns**: call `descriptor.factory(typeParams)(ctx)`
 *   once per column (per-column anonymous instance).
 * - **non-parameterized columns**: call `descriptor.factory()(ctx)` once.
 *   The descriptor's factory is constant — every call returns the same
 *   shared codec instance — so columns sharing a non-parameterized codec id
 *   share one resolved codec without explicit caching.
 *
 * Combines what `initializeTypeHelpers` (named-instance walk) and
 * `buildJsonSchemaValidatorRegistry` (per-column walk) used to do separately:
 * one walk over all columns, one resolved codec per column, one trait-gated
 * validator extraction per column. The result drives both the dispatch
 * registry (`ContractCodecRegistry.forColumn`) and the validator registry.
 *
 * The returned object exposes:
 * - `forColumn`/`forCodecId` for the dispatch registry.
 * - `jsonValidators` for the JSON-schema validator registry (derived from
 *   the same per-column resolved codecs via the `'json-validator'` trait).
 *
 * Codec-registry-unification spec § AC-4: every column resolves through one
 * descriptor map without branching on parameterization.
 */
function buildContractCodecRegistry(
  contract: Contract<SqlStorage>,
  codecDescriptors: CodecDescriptorRegistry,
  legacyCodecRegistry: CodecRegistry,
  types: TypeHelperRegistry,
  parameterizedDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): {
  readonly registry: ContractCodecRegistry;
  readonly jsonValidators: JsonSchemaValidatorRegistry | undefined;
} {
  const byColumn = new Map<string, Codec>();
  const byCodecId = new Map<string, Codec>();
  const validators = new Map<string, JsonSchemaValidateFn>();

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
          // the same typeRef share one codec instance (and any per-instance
          // helper state on it).
          const helper = types[column.typeRef];
          // The TypeHelperRegistry stores either the resolved Codec or, when
          // no descriptor matched the named instance, the StorageTypeInstance
          // verbatim. The Codec branch is identified by its `id` field.
          if (helper && typeof helper === 'object' && 'id' in helper && 'decode' in helper) {
            resolvedCodec = helper as Codec;
          }
        } else if (column.typeParams && isParameterized) {
          // Inline-typeParams column with a parameterized descriptor.
          const parameterizedDescriptor = parameterizedDescriptors.get(column.codecId);
          if (parameterizedDescriptor) {
            const validatedParams = validateTypeParams(column.typeParams, parameterizedDescriptor, {
              tableName,
              columnName,
            });
            resolvedCodec = parameterizedDescriptor.factory(validatedParams)({
              name: `<anon:${tableName}.${columnName}>`,
              usedAt: [{ table: tableName, column: columnName }],
            });
          }
        } else if (!isParameterized) {
          // Non-parameterized column. Cache the resolved codec by codec id —
          // the descriptor's factory is constant for non-parameterized
          // codecs, so columns sharing this codec id share one resolved
          // instance.
          let cached = byCodecId.get(column.codecId);
          if (!cached) {
            // The synthesized non-parameterized descriptor takes `void` params
            // and ignores the ctx; pass `undefined` and a synthetic ctx
            // listing the column that triggered the materialization.
            cached = descriptor.factory(undefined as never)({
              name: `<shared:${column.codecId}>`,
              usedAt: [{ table: tableName, column: columnName }],
            });
            byCodecId.set(column.codecId, cached);
          }
          resolvedCodec = cached;
        }
        // else: parameterized codec id with no typeRef and no typeParams.
        // The column is missing the params the descriptor needs to
        // instantiate. Leave `resolvedCodec` undefined; encode/decode for
        // this column will produce raw values. This was the behavior pre-
        // Phase-3.5 via the legacy `pgVectorRepresentativeCodec` fallback;
        // post-Phase-3.5 we treat the column as having no resolved codec.
      }

      if (resolvedCodec) {
        byColumn.set(columnKey, resolvedCodec);
        const validate = extractValidator(resolvedCodec);
        if (validate) {
          validators.set(columnKey, validate);
        }
        // Track a representative codec per codec id for the `forCodecId`
        // fallback path. Non-parameterized codec ids cache their shared
        // singleton; parameterized codec ids capture the first resolved
        // instance — encode-equivalent for parameterized codecs whose
        // encoder is per-instance-stateless (pgvector formats `[v1,v2,...]`
        // independent of length; JSON encoders are `JSON.stringify`-based).
        // Sites that need per-instance behavior (e.g. decode, which
        // validates against the schema for JSON-with-schema codecs) must
        // dispatch through `forColumn` with a column ref. See ADR 205 +
        // codec-registry-unification spec § AC-4.
        if (!byCodecId.has(column.codecId)) {
          byCodecId.set(column.codecId, resolvedCodec);
        }
      }
    }
  }

  const registry: ContractCodecRegistry = {
    forColumn(table, column) {
      return byColumn.get(`${table}.${column}`);
    },
    forCodecId(codecId) {
      // Codec-id-only fallback for sites without a column ref (encode-side
      // DSL params whose `ParamRef.refs` isn't populated). Prefer the
      // contract-walk-derived shared codec; fall back to the legacy
      // `codecRegistry.get` for parameterized codec ids whose contracts
      // don't have a typeRef/typeParams column the walk could resolve
      // through. The legacy fallback retires once `ParamRef.refs` is
      // threaded everywhere (Phase 3.5 T3.5.9-T3.5.11).
      return byCodecId.get(codecId) ?? legacyCodecRegistry.get(codecId);
    },
  };

  const jsonValidators: JsonSchemaValidatorRegistry | undefined =
    validators.size > 0
      ? {
          get: (key: string) => validators.get(key),
          size: validators.size,
        }
      : undefined;

  return { registry, jsonValidators };
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

  const applied: AppliedMutationDefault[] = [];
  const appliedColumns = new Set<string>();

  for (const mutationDefault of defaults) {
    if (mutationDefault.ref.table !== options.table) {
      continue;
    }

    const defaultSpec =
      options.op === 'create' ? mutationDefault.onCreate : mutationDefault.onUpdate;
    if (!defaultSpec) {
      continue;
    }

    const columnName = mutationDefault.ref.column;
    if (Object.hasOwn(options.values, columnName) || appliedColumns.has(columnName)) {
      continue;
    }

    applied.push({
      column: columnName,
      value: computeExecutionDefaultValue(defaultSpec, generatorRegistry),
    });
    appliedColumns.add(columnName);
  }

  return applied;
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

  const codecRegistry = createCodecRegistry();

  const contributors: Array<SqlStaticContributions & ComponentDescriptor<string>> = [
    stack.target,
    stack.adapter,
    ...stack.extensionPacks,
  ];

  for (const contributor of contributors) {
    for (const c of contributor.codecs().values()) {
      codecRegistry.register(c);
    }
  }

  const queryOperationRegistry = createSqlOperationRegistry();
  for (const contributor of contributors) {
    for (const op of contributor.queryOperations?.() ?? []) {
      queryOperationRegistry.register(op);
    }
  }

  const parameterizedCodecDescriptors = collectParameterizedCodecDescriptors(contributors);
  const codecDescriptors = buildCodecDescriptorRegistry(
    codecRegistry,
    parameterizedCodecDescriptors,
  );
  const mutationDefaultGeneratorRegistry = collectMutationDefaultGenerators(contributors);

  if (parameterizedCodecDescriptors.size > 0) {
    validateColumnTypeParams(contract.storage, parameterizedCodecDescriptors);
  }

  const types = initializeTypeHelpers(contract.storage, parameterizedCodecDescriptors);

  const { registry: contractCodecs, jsonValidators: jsonSchemaValidators } =
    buildContractCodecRegistry(
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
    ...(jsonSchemaValidators ? { jsonSchemaValidators } : {}),
    applyMutationDefaults: (options) =>
      applyMutationDefaults(contract, mutationDefaultGeneratorRegistry, options),
  };
}

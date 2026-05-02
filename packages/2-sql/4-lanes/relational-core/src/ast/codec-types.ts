import type { JsonValue } from '@prisma-next/contract/types';
import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecDescriptor,
  CodecInstanceContext,
  CodecTrait,
} from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export type {
  CodecCallContext,
  CodecDescriptor,
  CodecTrait,
} from '@prisma-next/framework-components/codec';

/**
 * SQL-family addressing of a single column. The decode site populates a
 * `SqlColumnRef` whenever it can resolve the cell to a single underlying
 * `(table, column)` (the typical case for projected columns from a
 * single-table source); cells the runtime cannot resolve (aggregate
 * aliases, include aggregate fields, computed projections without a
 * simple ref) get `column = undefined`.
 *
 * The shape is a structural projection of the runtime's `ColumnRef` so
 * the SQL decode site can reuse the resolution it already performs for
 * `RUNTIME.DECODE_FAILED` envelope construction without allocating
 * twice per cell.
 */
export interface SqlColumnRef {
  readonly table: string;
  readonly name: string;
}

/**
 * SQL-family per-call context. Extends the framework {@link CodecCallContext}
 * (which carries `signal` only) with `column?: SqlColumnRef`, populated
 * on **decode** call sites that can resolve a single underlying column
 * ref. Encode call sites currently leave `column` undefined (encode-time
 * column context is the middleware's domain).
 *
 * SQL codec authors writing a `(value, ctx)` author function for a SQL
 * codec descriptor observe this type. The framework codec dispatch
 * surface (and Mongo) sees only the base `CodecCallContext`.
 */
export interface SqlCodecCallContext extends CodecCallContext {
  readonly column?: SqlColumnRef;
}

/**
 * SQL-family per-instance context. Extends the framework
 * {@link CodecInstanceContext} (`name` only) with `usedAt`, the set of
 * `(table, column)` pairs the resolved codec serves.
 *
 * - For `typeRef` columns sharing one named `storage.types` instance, the
 *   array lists every referencing column — a column-scoped stateful codec
 *   (e.g. encryption) can derive aggregated per-instance state across all
 *   the columns sharing the named instance.
 * - For inline-`typeParams` columns, the array has exactly one entry —
 *   the column that owns the inline params.
 * - For shared non-parameterized codecs, the array carries one
 *   representative entry (the column that triggered materialization);
 *   the codec is shared across every column with that codec id, so the
 *   `usedAt` is informational only.
 *
 * SQL extensions consuming `usedAt` (e.g. column-scoped state derivation)
 * type their factory parameter as `SqlCodecInstanceContext`. Extensions
 * that don't read `usedAt` type their factory parameter as the
 * family-agnostic {@link CodecInstanceContext} — a `SqlCodecInstanceContext`
 * is structurally assignable to the base.
 */
export interface SqlCodecInstanceContext extends CodecInstanceContext {
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}

/**
 * Codec metadata for database-specific type information.
 * Used for schema introspection and verification.
 */
export interface CodecMeta {
  readonly db?: {
    readonly sql?: {
      readonly postgres?: {
        readonly nativeType: string; // e.g. 'integer', 'text', 'vector', 'timestamp with time zone'
      };
    };
  };
}

/**
 * SQL codec — extends the framework codec base by narrowing the per-
 * call context to the SQL-family {@link SqlCodecCallContext} (adds
 * `column?: SqlColumnRef`). TypeScript treats method-syntax
 * declarations bivariantly, so the SQL narrowing is structurally
 * compatible with the framework {@link BaseCodec} super-interface.
 *
 * Codec-id-keyed static metadata (`traits`, `targetTypes`, `meta`,
 * `paramsSchema`, `renderOutputType`) lives on the unified
 * {@link import('@prisma-next/framework-components/codec').CodecDescriptor}
 * — the codec instance itself only carries `id` plus the four
 * conversion methods (TML-2357 M2 Phase B).
 *
 * See `Codec` in `@prisma-next/framework-components/codec` for the codec
 * contract that this interface extends.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> extends BaseCodec<Id, TTraits, TWire, TInput> {
  encode(value: TInput, ctx: SqlCodecCallContext): Promise<TWire>;
  decode(wire: TWire, ctx: SqlCodecCallContext): Promise<TInput>;
}

/**
 * Contract-bound codec registry.
 *
 * The dispatch interface for encode/decode at runtime: built once at
 * `ExecutionContext` construction time by walking the contract's
 * `storage.tables[].columns[]` and resolving each column to either a per-
 * instance parameterized codec (via `descriptor.factory(typeParams)(ctx)`)
 * or the shared codec instance from the legacy `CodecRegistry` (for non-
 * parameterized codecs). The dispatch path calls
 * `forColumn(table, column).encode/decode(...)` and doesn't know whether
 * the codec is parameterized.
 *
 * `forCodecId(codecId)` is a fallback for sites that don't carry the
 * `(table, column)` ref through to the encode/decode call site —
 * primarily the param-encoding path, where `ParamRef.refs` is not
 * populated by the SQL builder today (every `ParamRef` carries `codecId`
 * but not the column it relates to). For the parameterized codecs shipped
 * at Phase B, encode is per-instance-stateless (pgvector formats
 * `[v1,v2,v3]` regardless of length; JSON's `encode` is `JSON.stringify`
 * regardless of schema), so a codec-id-keyed lookup yields a structurally
 * equivalent encoder; the fallback is the bridge that lets the legacy
 * `codecs:` registration retire from the dispatch path while staying as
 * the codec-id-only source for now.
 *
 * The encode-side fallback is the AC-5-deferred carve-out documented in
 * the codec-registry-unification spec § Non-functional constraints.
 * TML-2357 retires the fallback by threading `ParamRef.refs` through
 * column-bound construction sites.
 */
export interface ContractCodecRegistry {
  /**
   * Resolve the codec for `(table, column)`. Returns the per-instance
   * parameterized codec for parameterized columns, the shared codec for
   * non-parameterized columns, or `undefined` if the column is unknown
   * or the codec isn't registered.
   */
  forColumn(table: string, column: string): Codec | undefined;

  /**
   * Resolve a codec by id. Returns the same codec instance the legacy
   * `CodecRegistry.get(codecId)` would return — for non-parameterized
   * codecs that's the shared instance; for parameterized codecs that's
   * a representative resolved instance. Used by sites that don't carry
   * `(table, column)` through to the encode/decode call site (the AC-5
   * carve-out path).
   */
  forCodecId(codecId: string): Codec | undefined;
}

/**
 * Registry interface for codecs organized by ID and by contract scalar type.
 *
 * The registry allows looking up codecs by their namespaced ID or by the
 * contract scalar types they handle. Multiple codecs may handle the same
 * scalar type; ordering in byScalar reflects preference (adapter first,
 * then packs, then app overrides).
 */
export interface CodecRegistry {
  get(id: string): Codec<string> | undefined;
  has(id: string): boolean;
  register(codec: Codec<string>): void;
  [Symbol.iterator](): Iterator<Codec<string>>;
  values(): IterableIterator<Codec<string>>;
}

/**
 * Type helpers to extract codec types.
 */
export type CodecId<T> =
  T extends Codec<infer Id> ? Id : T extends { readonly id: infer Id } ? Id : never;
export type CodecInput<T> =
  T extends Codec<string, readonly CodecTrait[], unknown, infer In> ? In : never;
export type CodecTraits<T> =
  T extends Codec<string, infer TTraits> ? TTraits[number] & CodecTrait : never;

/**
 * Type helper to extract codec types from builder instance.
 */
export type ExtractCodecTypes<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> } = Record<never, never>,
> = {
  readonly [K in keyof ScalarNames as ScalarNames[K] extends Codec<infer Id> ? Id : never]: {
    readonly input: CodecInput<ScalarNames[K]>;
    readonly output: CodecInput<ScalarNames[K]>;
    readonly traits: CodecTraits<ScalarNames[K]>;
  };
};

/**
 * Type helper to extract data type IDs from builder instance.
 * Uses ExtractCodecTypes which preserves literal types as keys.
 * Since ExtractCodecTypes<Record<K, ScalarNames[K]>> has exactly one key (the Id),
 * we extract it by creating a mapped type that uses the Id as both key and value,
 * then extract the value type. This preserves literal types.
 */
export type ExtractDataTypes<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> },
> = {
  readonly [K in keyof ScalarNames]: {
    readonly [Id in keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>]: Id;
  }[keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>];
};

/**
 * Create a new codec registry. Inline object literal — no class
 * implementation; the registry is just a private `Map<string, Codec>`
 * with the documented surface methods.
 */
export function newCodecRegistry(): CodecRegistry {
  const byId = new Map<string, Codec<string>>();
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    register: (codec) => {
      if (byId.has(codec.id)) {
        throw new Error(`Codec with ID '${codec.id}' is already registered`);
      }
      byId.set(codec.id, codec);
    },
    values: () => byId.values(),
    [Symbol.iterator]: function* () {
      yield* byId.values();
    },
  };
}

/**
 * Spec accepted by the SQL `defineCodec()` factory. Mirrors the
 * fields on the framework {@link CodecDescriptor} plus author-side
 * `encode`/`decode` (and, when `TInput` is not JSON-safe,
 * `encodeJson`/`decodeJson`).
 *
 * `TParams` defaults to `void` for non-parameterized codecs;
 * `paramsSchema` and `renderOutputType` are then both omitted (the
 * factory supplies the framework's {@link voidParamsSchema} and there
 * is no per-codec emit-path renderer).
 *
 * `paramsSchema` is a Standard Schema validator that runs at the JSON
 * boundary (`contract.json` → runtime). `renderOutputType` is the
 * emit-path hook the framework consults to produce the TypeScript
 * output type expression for `contract.d.ts`.
 *
 * The descriptor spec is the canonical SQL codec authoring surface;
 * the produced `Codec` carries only the narrow runtime methods. Per
 * TML-2357 M2, contributors ship `CodecDescriptor`s through the unified
 * `codecs:` slot; the descriptor's `factory` materializes the resolved
 * runtime codec on demand.
 */
type CodecDescriptorSpecBase<
  Id extends string,
  TTraits extends readonly CodecTrait[],
  TWire,
  TInput,
> = {
  readonly codecId: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;
  readonly meta?: CodecMeta;
  readonly encode: (value: TInput, ctx: SqlCodecCallContext) => TWire | Promise<TWire>;
  readonly decode: (wire: TWire, ctx: SqlCodecCallContext) => TInput | Promise<TInput>;
};

/**
 * Conditional bundle for `encodeJson`/`decodeJson` on the descriptor
 * spec — JSON-safety conditional on `TInput`.
 */
type DescriptorJsonRoundTripConfig<TInput> = [TInput] extends [JsonValue]
  ? {
      encodeJson?: (value: TInput) => JsonValue;
      decodeJson?: (json: JsonValue) => TInput;
    }
  : {
      encodeJson: (value: TInput) => JsonValue;
      decodeJson: (json: JsonValue) => TInput;
    };

export type CodecDescriptorSpec<
  Id extends string,
  TTraits extends readonly CodecTrait[],
  TWire,
  TInput,
  TParams,
> = CodecDescriptorSpecBase<Id, TTraits, TWire, TInput> &
  DescriptorJsonRoundTripConfig<TInput> & {
    readonly paramsSchema?: StandardSchemaV1<TParams>;
    readonly renderOutputType?: (params: TParams) => string | undefined;
  };

/**
 * Construct a SQL codec descriptor from author functions and codec-id-
 * keyed metadata.
 *
 * Author `encode` and `decode` as sync or async functions; the factory
 * promise-lifts them onto the framework-required `Promise<…>` boundary
 * shape (per ADR 204). Authors receive a second `ctx` options argument
 * carrying the SQL-family per-call context; ignore it if you don't
 * need it.
 *
 * For non-parameterized codecs (`TParams` defaults to `void`), the
 * descriptor's `factory` is constant — every call returns the same
 * shared codec instance for every column sharing the codec id. The
 * framework's {@link voidParamsSchema} validates the absent params at
 * the JSON boundary.
 *
 * For parameterized codecs, supply a `paramsSchema` validating the
 * params shape. The current implementation closes the resolved codec
 * over the same shared instance regardless of `params` — sufficient for
 * today's parameterized codecs (e.g. pgvector) where `params` is a
 * metadata bag rather than a per-call closure dependency. Codec authors
 * who need per-instance state can wrap `defineCodec()` with their
 * own factory closure.
 *
 * `encodeJson` and `decodeJson` default to identity **only when
 * `TInput` is assignable to `JsonValue`**; otherwise both are required
 * so the contract artifact stays JSON-safe.
 *
 * Canonical SQL codec authoring factory (TML-2357 M2).
 */
export function defineCodec<
  Id extends string,
  const TTraits extends readonly CodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
  TParams = void,
>(spec: CodecDescriptorSpec<Id, TTraits, TWire, TInput, TParams>): CodecDescriptor<TParams> {
  const identity = (v: unknown) => v;
  const userEncode = spec.encode;
  const userDecode = spec.decode;
  const widenedSpec = spec as {
    readonly encodeJson?: (value: TInput) => JsonValue;
    readonly decodeJson?: (json: JsonValue) => TInput;
  };
  const traits = spec.traits
    ? (Object.freeze([...spec.traits]) as readonly CodecTrait[])
    : (Object.freeze([]) as readonly CodecTrait[]);

  const buildSqlCodec = (): Codec<Id, TTraits, TWire, TInput> =>
    ({
      id: spec.codecId,
      encode: (value, ctx) => {
        try {
          return Promise.resolve(userEncode(value, ctx));
        } catch (error) {
          return Promise.reject(error);
        }
      },
      decode: (wire, ctx) => {
        try {
          return Promise.resolve(userDecode(wire, ctx));
        } catch (error) {
          return Promise.reject(error);
        }
      },
      encodeJson: (widenedSpec.encodeJson ?? identity) as (value: TInput) => JsonValue,
      decodeJson: (widenedSpec.decodeJson ?? identity) as (json: JsonValue) => TInput,
    }) as Codec<Id, TTraits, TWire, TInput>;

  const sharedCodec = buildSqlCodec();
  const factory: CodecDescriptor<TParams>['factory'] = () => () => sharedCodec;

  // `voidParamsSchema` validates `void`/`undefined` params; widen
  // through `unknown` to populate the descriptor's
  // `StandardSchemaV1<TParams>` slot when the caller didn't supply a
  // `paramsSchema` (TParams defaults to `void`). The runtime validation
  // contract is preserved — the framework supplies no params at the
  // call boundary for non-parameterized codecs.
  const paramsSchema = (spec.paramsSchema ??
    (voidParamsSchema as unknown as StandardSchemaV1<TParams>)) as StandardSchemaV1<TParams>;

  return {
    codecId: spec.codecId,
    traits,
    targetTypes: spec.targetTypes,
    paramsSchema,
    factory,
    ...(spec.meta !== undefined ? { meta: spec.meta } : {}),
    ...(spec.renderOutputType !== undefined ? { renderOutputType: spec.renderOutputType } : {}),
  };
}

/**
 * Type helpers to extract codec types from a {@link CodecDescriptor}.
 *
 * The descriptor's runtime `factory` returns a {@link Codec} (the SQL-
 * family extension of the framework `BaseCodec`); these helpers project
 * the generic args back into a structural type-level surface for builder
 * consumers (e.g. `dataTypes`, `descriptorCodecDefinitions`).
 */
/**
 * Variance-erased descriptor type used for heterogeneous storage in the
 * descriptor builder and on the unified contributor `codecs:` slot. The
 * descriptor's `factory` and `renderOutputType` are contravariant in
 * `P`, so descriptors with different params shapes are not in a subtype
 * relationship; collecting them into one container needs an explicit
 * variance erasure rather than `CodecDescriptor<unknown>` (which is the
 * narrowest, not the widest, of the family).
 */
// biome-ignore lint/suspicious/noExplicitAny: descriptor variance erasure — `P` is contravariant on the factory and renderOutputType slots, so heterogeneous descriptor storage cannot use `unknown`.
export type AnyCodecDescriptor = CodecDescriptor<any>;

export type DescriptorResolvedCodec<D> =
  D extends CodecDescriptor<infer _P> ? ReturnType<ReturnType<D['factory']>> : never;

export type DescriptorCodecId<D> = D extends AnyCodecDescriptor ? D['codecId'] : never;

export type DescriptorCodecInput<D> =
  DescriptorResolvedCodec<D> extends BaseCodec<string, readonly CodecTrait[], unknown, infer In>
    ? In
    : never;

export type DescriptorCodecTraits<D> =
  DescriptorResolvedCodec<D> extends BaseCodec<string, infer TTraits, unknown, unknown>
    ? TTraits[number] & CodecTrait
    : never;

/**
 * Type helper to extract codec types from a descriptor builder instance
 * keyed by scalar name.
 */
export type ExtractDescriptorCodecTypes<
  ScalarNames extends {
    readonly [K in keyof ScalarNames]: AnyCodecDescriptor;
  } = Record<never, never>,
> = {
  readonly [K in keyof ScalarNames as DescriptorCodecId<ScalarNames[K]>]: {
    readonly input: DescriptorCodecInput<ScalarNames[K]>;
    readonly output: DescriptorCodecInput<ScalarNames[K]>;
    readonly traits: DescriptorCodecTraits<ScalarNames[K]>;
  };
};

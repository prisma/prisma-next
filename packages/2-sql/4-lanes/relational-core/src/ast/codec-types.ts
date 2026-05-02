import type { JsonValue } from '@prisma-next/contract/types';
import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecDescriptor,
  CodecInstanceContext,
  CodecTrait,
} from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Type } from 'arktype';
import type { O } from 'ts-toolbelt';

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
 * SQL codec authors writing a `(value, ctx)` author function for the SQL
 * `codec()` factory observe this type. The framework codec dispatch
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
 * SQL codec — extends the framework codec base with SQL-specific metadata:
 * driver-native type info (`meta.db.sql.<dialect>.nativeType`) and an
 * optional parameterized-codec descriptor (`paramsSchema` + `init`) for
 * codecs that require type-parameter validation (e.g. `pg/vector@1`).
 *
 * `encode` and `decode` are redeclared here to narrow the per-call
 * context to the SQL-family {@link SqlCodecCallContext} (adds
 * `column?: SqlColumnRef`). TypeScript treats method-syntax declarations
 * bivariantly, so the SQL narrowing is structurally compatible with the
 * framework {@link BaseCodec} super-interface.
 *
 * `traits` and `targetTypes` are redeclared here because the framework
 * {@link BaseCodec} no longer carries them — they live on the unified
 * {@link import('@prisma-next/framework-components/codec').CodecDescriptor}
 * as the codec-id-keyed source of truth. The instance-side fields stay
 * as a transitional surface that the legacy `codec()` factory still
 * emits on resolved instances; consumers of those fields (e.g.
 * `CodecLookup` assembly in `framework-components/control-stack`) read
 * them through a structural narrow until the family-extension narrow
 * lands in TML-2357 M2 Phase B.
 *
 * Note: `meta`, `paramsSchema`, and `init` are legacy adapter-level
 * slots retained transitionally on the codec instance. The runtime
 * materialization path uses `RuntimeParameterizedCodecDescriptor` (in
 * `@prisma-next/sql-runtime`) via the unified `CodecDescriptor<P>` shape;
 * codec-self-carried `meta`/`paramsSchema`/`init` retire under TML-2357.
 *
 * See `Codec` in `@prisma-next/framework-components/codec` for the codec
 * contract that this interface extends.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TParams = Record<string, unknown>,
  THelper = unknown,
> extends BaseCodec<Id, TTraits, TWire, TInput> {
  encode(value: TInput, ctx: SqlCodecCallContext): Promise<TWire>;
  decode(wire: TWire, ctx: SqlCodecCallContext): Promise<TInput>;
  /** Transitional. See file-level comment. */
  readonly traits?: TTraits;
  /**
   * Transitional. See file-level comment. Optional because the resolved
   * codec returned by a {@link import('@prisma-next/framework-components/codec').CodecDescriptor}'s
   * `factory` (framework {@link BaseCodec}) is structurally narrower; the
   * SQL `codec()` factory always populates the slot at the
   * registration boundary.
   */
  readonly targetTypes?: readonly string[];
  /** Transitional. See file-level comment. */
  readonly meta?: CodecMeta;
  /** Transitional. See file-level comment. */
  readonly paramsSchema?: Type<TParams>;
  /** Transitional. See file-level comment. */
  readonly init?: (params: TParams) => THelper;
  /** Transitional. See file-level comment. */
  readonly renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
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
  getByScalar(scalar: string): readonly Codec<string>[];
  getDefaultCodec(scalar: string): Codec<string> | undefined;
  register(codec: Codec<string>): void;
  /** Returns true if the codec with this ID has the given trait. */
  hasTrait(codecId: string, trait: CodecTrait): boolean;
  /** Returns all traits for a codec, or an empty array if not found. */
  traitsOf(codecId: string): readonly CodecTrait[];
  [Symbol.iterator](): Iterator<Codec<string>>;
  values(): IterableIterator<Codec<string>>;
}

/**
 * Implementation of CodecRegistry.
 */
class CodecRegistryImpl implements CodecRegistry {
  private readonly _byId = new Map<string, Codec<string>>();
  private readonly _byScalar = new Map<string, Codec<string>[]>();

  /**
   * Map-like interface for codec lookup by ID.
   * Example: registry.get('pg/text@1')
   */
  get(id: string): Codec<string> | undefined {
    return this._byId.get(id);
  }

  /**
   * Check if a codec with the given ID is registered.
   */
  has(id: string): boolean {
    return this._byId.has(id);
  }

  /**
   * Get all codecs that handle a given scalar type.
   * Returns an empty frozen array if no codecs are found.
   * Example: registry.getByScalar('text') → [codec1, codec2, ...]
   */
  getByScalar(scalar: string): readonly Codec<string>[] {
    return this._byScalar.get(scalar) ?? Object.freeze([]);
  }

  /**
   * Get the default codec for a scalar type (first registered codec).
   * Returns undefined if no codec handles this scalar type.
   */
  getDefaultCodec(scalar: string): Codec<string> | undefined {
    const _codecs = this._byScalar.get(scalar);
    return _codecs?.[0];
  }

  /**
   * Register a codec in the registry.
   * Throws an error if a codec with the same ID is already registered.
   *
   * @param codec - The codec to register
   * @throws Error if a codec with the same ID already exists
   */
  register(codec: Codec<string>): void {
    if (this._byId.has(codec.id)) {
      throw new Error(`Codec with ID '${codec.id}' is already registered`);
    }

    this._byId.set(codec.id, codec);

    // Update byScalar mapping. The transitional `targetTypes` field is
    // optional now — the SQL `codec()` factory always populates it, but
    // the type-system narrow (a resolved descriptor codec is the framework
    // {@link BaseCodec}) means we read defensively here. This branch retires
    // alongside `CodecRegistryImpl` in TML-2357 M2.
    for (const scalarType of codec.targetTypes ?? []) {
      const existing = this._byScalar.get(scalarType);
      if (existing) {
        existing.push(codec);
      } else {
        this._byScalar.set(scalarType, [codec]);
      }
    }
  }

  hasTrait(codecId: string, trait: CodecTrait): boolean {
    const codec = this._byId.get(codecId);
    return codec?.traits?.includes(trait) ?? false;
  }

  traitsOf(codecId: string): readonly CodecTrait[] {
    return this._byId.get(codecId)?.traits ?? [];
  }

  /**
   * Returns an iterator over all registered codecs.
   * Useful for iterating through codecs from another registry.
   */
  *[Symbol.iterator](): Iterator<Codec<string>> {
    for (const codec of this._byId.values()) {
      yield codec;
    }
  }

  /**
   * Returns an iterable of all registered codecs.
   */
  values(): IterableIterator<Codec<string>> {
    return this._byId.values();
  }
}

/**
 * Conditional bundle for `encodeJson`/`decodeJson`: when `TInput` is
 * structurally assignable to `JsonValue` the identity defaults are
 * sound and both fields are optional; otherwise both fields are
 * required so an author cannot silently produce a non-JSON-safe
 * contract artifact.
 */
type JsonRoundTripConfig<TInput> = [TInput] extends [JsonValue]
  ? {
      encodeJson?: (value: TInput) => JsonValue;
      decodeJson?: (json: JsonValue) => TInput;
    }
  : {
      encodeJson: (value: TInput) => JsonValue;
      decodeJson: (json: JsonValue) => TInput;
    };

/**
 * Construct a SQL codec from author functions and optional metadata.
 *
 * Author `encode` and `decode` as sync or async functions; the factory
 * produces a {@link Codec} whose query-time methods follow the boundary
 * contract documented on `Codec`. Authors receive a second `ctx` options
 * argument carrying the SQL-family per-call context; ignore it if you
 * don't need it.
 *
 * Both `encode` and `decode` are required so `TInput` and `TWire` are
 * always covered by an explicit author function — the factory installs
 * no identity fallback. `encodeJson` and `decodeJson` default to identity
 * **only when `TInput` is assignable to `JsonValue`**; otherwise both are
 * required so the contract artifact stays JSON-safe.
 */
export function codec<
  Id extends string,
  const TTraits extends readonly CodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
  TParams = Record<string, unknown>,
  THelper = unknown,
>(
  config: {
    typeId: Id;
    targetTypes: readonly string[];
    encode: (value: TInput, ctx: SqlCodecCallContext) => TWire | Promise<TWire>;
    decode: (wire: TWire, ctx: SqlCodecCallContext) => TInput | Promise<TInput>;
    meta?: CodecMeta;
    paramsSchema?: Type<TParams>;
    init?: (params: TParams) => THelper;
    traits?: TTraits;
    renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
  } & JsonRoundTripConfig<TInput>,
): Codec<Id, TTraits, TWire, TInput, TParams, THelper> {
  const identity = (v: unknown) => v;
  // The runtime allocates one `SqlCodecCallContext` per `runtime.execute()`
  // call (no caller-supplied `signal` produces `{}` instead of `undefined`)
  // and threads it as a non-optional reference to every codec call. The
  // author surface keeps the second parameter optional so single-arg
  // `(value) => …` authors continue to satisfy the signature via
  // TypeScript's bivariance for trailing parameters.
  const userEncode = config.encode;
  const userDecode = config.decode;
  // The conditional JsonRoundTripConfig narrows TInput|JsonValue at the
  // boundary; widen back to the generic shape inside the factory body.
  const widenedConfig = config as {
    encodeJson?: (value: TInput) => JsonValue;
    decodeJson?: (json: JsonValue) => TInput;
  };
  return {
    id: config.typeId,
    targetTypes: config.targetTypes,
    ...ifDefined('meta', config.meta),
    ...ifDefined('paramsSchema', config.paramsSchema),
    ...ifDefined('init', config.init),
    ...ifDefined(
      'traits',
      config.traits ? (Object.freeze([...config.traits]) as TTraits) : undefined,
    ),
    ...ifDefined('renderOutputType', config.renderOutputType),
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
    encodeJson: (widenedConfig.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (widenedConfig.decodeJson ?? identity) as (json: JsonValue) => TInput,
  };
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
 * Builder interface for declaring codecs.
 */
export interface CodecDefBuilder<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> } = Record<never, never>,
> {
  readonly CodecTypes: ExtractCodecTypes<ScalarNames>;

  add<ScalarName extends string, CodecImpl extends Codec<string>>(
    scalarName: ScalarName,
    codecImpl: CodecImpl,
  ): CodecDefBuilder<
    O.Overwrite<ScalarNames, Record<ScalarName, CodecImpl>> & Record<ScalarName, CodecImpl>
  >;

  readonly codecDefinitions: {
    readonly [K in keyof ScalarNames]: {
      readonly typeId: ScalarNames[K] extends Codec<infer Id extends string> ? Id : never;
      readonly scalar: K;
      readonly codec: ScalarNames[K];
      readonly input: CodecInput<ScalarNames[K]>;
      readonly output: CodecInput<ScalarNames[K]>;
      readonly jsType: CodecInput<ScalarNames[K]>;
    };
  };

  readonly dataTypes: {
    readonly [K in keyof ScalarNames]: {
      readonly [Id in keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>]: Id;
    }[keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>];
  };
}

/**
 * Implementation of CodecDefBuilder.
 */
class CodecDefBuilderImpl<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> } = Record<never, never>,
> implements CodecDefBuilder<ScalarNames>
{
  private readonly _codecs: ScalarNames;

  public readonly CodecTypes: ExtractCodecTypes<ScalarNames>;
  public readonly dataTypes: {
    readonly [K in keyof ScalarNames]: {
      readonly [Id in keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>]: Id;
    }[keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>];
  };

  constructor(codecs: ScalarNames) {
    this._codecs = codecs;

    // Populate CodecTypes from codecs
    const codecTypes: Record<
      string,
      { readonly input: unknown; readonly output: unknown; readonly traits: unknown }
    > = {};
    for (const [, codecImpl] of Object.entries(this._codecs)) {
      const codecImplTyped = codecImpl as Codec<string>;
      codecTypes[codecImplTyped.id] = {
        input: undefined as unknown as CodecInput<typeof codecImplTyped>,
        output: undefined as unknown as CodecInput<typeof codecImplTyped>,
        traits: undefined as unknown as CodecTraits<typeof codecImplTyped>,
      };
    }
    this.CodecTypes = codecTypes as ExtractCodecTypes<ScalarNames>;

    // Populate dataTypes from codecs - extract id property from each codec
    // Build object preserving keys from ScalarNames
    // Type assertion is safe because we know ScalarNames structure matches the return type
    // biome-ignore lint/suspicious/noExplicitAny: dynamic codec mapping requires any
    const dataTypes = {} as any;
    for (const key in this._codecs) {
      if (Object.hasOwn(this._codecs, key)) {
        const codec = this._codecs[key] as Codec<string>;
        dataTypes[key] = codec.id;
      }
    }
    this.dataTypes = dataTypes as {
      readonly [K in keyof ScalarNames]: {
        readonly [Id in keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>]: Id;
      }[keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>];
    };
  }

  add<ScalarName extends string, CodecImpl extends Codec<string>>(
    scalarName: ScalarName,
    codecImpl: CodecImpl,
  ): CodecDefBuilder<
    O.Overwrite<ScalarNames, Record<ScalarName, CodecImpl>> & Record<ScalarName, CodecImpl>
  > {
    return new CodecDefBuilderImpl({
      ...this._codecs,
      [scalarName]: codecImpl,
    } as O.Overwrite<ScalarNames, Record<ScalarName, CodecImpl>> & Record<ScalarName, CodecImpl>);
  }

  /**
   * Derive codecDefinitions structure.
   */
  get codecDefinitions(): {
    readonly [K in keyof ScalarNames]: {
      readonly typeId: ScalarNames[K] extends Codec<infer Id> ? Id : never;
      readonly scalar: K;
      readonly codec: ScalarNames[K];
      readonly input: CodecInput<ScalarNames[K]>;
      readonly output: CodecInput<ScalarNames[K]>;
      readonly jsType: CodecInput<ScalarNames[K]>;
    };
  } {
    const result: Record<
      string,
      {
        typeId: string;
        scalar: string;
        codec: Codec;
        input: unknown;
        output: unknown;
        jsType: unknown;
      }
    > = {};

    for (const [scalarName, codecImpl] of Object.entries(this._codecs)) {
      const codec = codecImpl as Codec<string>;
      result[scalarName] = {
        typeId: codec.id,
        scalar: scalarName,
        codec: codec,
        input: undefined as unknown as CodecInput<typeof codec>,
        output: undefined as unknown as CodecInput<typeof codec>,
        jsType: undefined as unknown as CodecInput<typeof codec>,
      };
    }

    return result as {
      readonly [K in keyof ScalarNames]: {
        readonly typeId: ScalarNames[K] extends Codec<infer Id extends string> ? Id : never;
        readonly scalar: K;
        readonly codec: ScalarNames[K];
        readonly input: CodecInput<ScalarNames[K]>;
        readonly output: CodecInput<ScalarNames[K]>;
        readonly jsType: CodecInput<ScalarNames[K]>;
      };
    };
  }
}

/**
 * Create a new codec registry.
 */
export function createCodecRegistry(): CodecRegistry {
  return new CodecRegistryImpl();
}

/**
 * Create a new codec definition builder.
 */
export function defineCodecs(): CodecDefBuilder<Record<never, never>> {
  return new CodecDefBuilderImpl({});
}

/**
 * Spec accepted by the SQL `codecDescriptor()` factory. Mirrors the
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
 * Replaces the legacy `codec()` factory's spec, which produced a
 * `Codec` with codec-id-keyed metadata fields on the instance. Per
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
 * spec — same JSON-safety conditional as the legacy `codec()` factory.
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
 * who need per-instance state can wrap `codecDescriptor()` with their
 * own factory closure.
 *
 * `encodeJson` and `decodeJson` default to identity **only when
 * `TInput` is assignable to `JsonValue`**; otherwise both are required
 * so the contract artifact stays JSON-safe.
 *
 * Replaces the legacy `codec()` factory under TML-2357 M2; the legacy
 * factory deletes once every consumer migrates.
 */
export function codecDescriptor<
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
      // SQL family extension still surfaces these legacy fields on the
      // codec instance until M2 Phase B narrows the SQL `Codec`. Attach
      // them so consumers like `extractCodecLookup` (which reads
      // `targetTypes` / `meta` / `renderOutputType` off codec instances)
      // see the same shape they get from the legacy `codec()` factory.
      // Phase B retires this attachment alongside the family-extension
      // narrow.
      traits,
      targetTypes: spec.targetTypes,
      ...(spec.meta !== undefined ? { meta: spec.meta } : {}),
      ...(spec.renderOutputType !== undefined ? { renderOutputType: spec.renderOutputType } : {}),
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

type DescriptorResolvedCodec<D> =
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

/**
 * Builder interface for declaring codec descriptors keyed by an
 * authoring-time scalar name. Produces the structural artifacts
 * (`codecDefinitions`, `dataTypes`, `CodecTypes`) consumed by
 * contributors and the contract authoring surface.
 *
 * Replaces {@link CodecDefBuilder} under TML-2357 M2; the legacy builder
 * deletes once every consumer migrates.
 */
export interface CodecDescriptorBuilder<
  ScalarNames extends {
    readonly [K in keyof ScalarNames]: AnyCodecDescriptor;
  } = Record<never, never>,
> {
  readonly CodecTypes: ExtractDescriptorCodecTypes<ScalarNames>;

  add<ScalarName extends string, D extends AnyCodecDescriptor>(
    scalarName: ScalarName,
    descriptor: D,
  ): CodecDescriptorBuilder<
    O.Overwrite<ScalarNames, Record<ScalarName, D>> & Record<ScalarName, D>
  >;

  /**
   * The shipped descriptors as a tuple, ready to feed straight into a
   * contributor's unified `codecs:` slot.
   */
  readonly descriptors: ReadonlyArray<AnyCodecDescriptor>;

  readonly codecDefinitions: {
    readonly [K in keyof ScalarNames]: {
      readonly codecId: DescriptorCodecId<ScalarNames[K]>;
      readonly scalar: K;
      readonly descriptor: ScalarNames[K];
      readonly input: DescriptorCodecInput<ScalarNames[K]>;
      readonly output: DescriptorCodecInput<ScalarNames[K]>;
      readonly jsType: DescriptorCodecInput<ScalarNames[K]>;
    };
  };

  readonly dataTypes: {
    readonly [K in keyof ScalarNames]: {
      readonly [Id in keyof ExtractDescriptorCodecTypes<Record<K, ScalarNames[K]>>]: Id;
    }[keyof ExtractDescriptorCodecTypes<Record<K, ScalarNames[K]>>];
  };
}

class CodecDescriptorBuilderImpl<
  ScalarNames extends {
    readonly [K in keyof ScalarNames]: AnyCodecDescriptor;
  } = Record<never, never>,
> implements CodecDescriptorBuilder<ScalarNames>
{
  private readonly _descriptors: ScalarNames;

  public readonly CodecTypes: ExtractDescriptorCodecTypes<ScalarNames>;
  public readonly dataTypes: {
    readonly [K in keyof ScalarNames]: {
      readonly [Id in keyof ExtractDescriptorCodecTypes<Record<K, ScalarNames[K]>>]: Id;
    }[keyof ExtractDescriptorCodecTypes<Record<K, ScalarNames[K]>>];
  };

  constructor(descriptors: ScalarNames) {
    this._descriptors = descriptors;

    const codecTypes: Record<
      string,
      { readonly input: unknown; readonly output: unknown; readonly traits: unknown }
    > = {};
    for (const [, descriptor] of Object.entries(this._descriptors)) {
      const d = descriptor as AnyCodecDescriptor;
      codecTypes[d.codecId] = {
        input: undefined as unknown as DescriptorCodecInput<typeof d>,
        output: undefined as unknown as DescriptorCodecInput<typeof d>,
        traits: undefined as unknown as DescriptorCodecTraits<typeof d>,
      };
    }
    this.CodecTypes = codecTypes as ExtractDescriptorCodecTypes<ScalarNames>;

    // biome-ignore lint/suspicious/noExplicitAny: dynamic key mapping requires any
    const dataTypes = {} as any;
    for (const key in this._descriptors) {
      if (Object.hasOwn(this._descriptors, key)) {
        const d = this._descriptors[key] as AnyCodecDescriptor;
        dataTypes[key] = d.codecId;
      }
    }
    this.dataTypes = dataTypes as {
      readonly [K in keyof ScalarNames]: {
        readonly [Id in keyof ExtractDescriptorCodecTypes<Record<K, ScalarNames[K]>>]: Id;
      }[keyof ExtractDescriptorCodecTypes<Record<K, ScalarNames[K]>>];
    };
  }

  add<ScalarName extends string, D extends AnyCodecDescriptor>(
    scalarName: ScalarName,
    descriptor: D,
  ): CodecDescriptorBuilder<
    O.Overwrite<ScalarNames, Record<ScalarName, D>> & Record<ScalarName, D>
  > {
    return new CodecDescriptorBuilderImpl({
      ...this._descriptors,
      [scalarName]: descriptor,
    } as O.Overwrite<ScalarNames, Record<ScalarName, D>> & Record<ScalarName, D>);
  }

  get descriptors(): ReadonlyArray<AnyCodecDescriptor> {
    return Object.values(this._descriptors as Record<string, AnyCodecDescriptor>);
  }

  get codecDefinitions(): {
    readonly [K in keyof ScalarNames]: {
      readonly codecId: DescriptorCodecId<ScalarNames[K]>;
      readonly scalar: K;
      readonly descriptor: ScalarNames[K];
      readonly input: DescriptorCodecInput<ScalarNames[K]>;
      readonly output: DescriptorCodecInput<ScalarNames[K]>;
      readonly jsType: DescriptorCodecInput<ScalarNames[K]>;
    };
  } {
    const result: Record<
      string,
      {
        codecId: string;
        scalar: string;
        descriptor: AnyCodecDescriptor;
        input: unknown;
        output: unknown;
        jsType: unknown;
      }
    > = {};

    for (const [scalarName, descriptor] of Object.entries(this._descriptors)) {
      const d = descriptor as AnyCodecDescriptor;
      result[scalarName] = {
        codecId: d.codecId,
        scalar: scalarName,
        descriptor: d,
        input: undefined as unknown as DescriptorCodecInput<typeof d>,
        output: undefined as unknown as DescriptorCodecInput<typeof d>,
        jsType: undefined as unknown as DescriptorCodecInput<typeof d>,
      };
    }

    return result as {
      readonly [K in keyof ScalarNames]: {
        readonly codecId: DescriptorCodecId<ScalarNames[K]>;
        readonly scalar: K;
        readonly descriptor: ScalarNames[K];
        readonly input: DescriptorCodecInput<ScalarNames[K]>;
        readonly output: DescriptorCodecInput<ScalarNames[K]>;
        readonly jsType: DescriptorCodecInput<ScalarNames[K]>;
      };
    };
  }
}

/**
 * Create a new codec descriptor builder. Replaces {@link defineCodecs}
 * under TML-2357 M2; the legacy builder deletes once every consumer
 * migrates.
 */
export function defineCodecDescriptors(): CodecDescriptorBuilder<Record<never, never>> {
  return new CodecDescriptorBuilderImpl({});
}

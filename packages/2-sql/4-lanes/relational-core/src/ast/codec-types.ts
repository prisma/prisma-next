import type { JsonValue } from '@prisma-next/contract/types';
import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecTrait,
} from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Type } from 'arktype';
import type { O } from 'ts-toolbelt';

export type { CodecCallContext, CodecTrait } from '@prisma-next/framework-components/codec';

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
 * Legacy adapter-level descriptor for parameterized codecs that require
 * type-parameter validation at compile time. The runtime descriptor
 * (`RuntimeParameterizedCodecDescriptor` in `@prisma-next/sql-runtime`)
 * has migrated to the unified `CodecDescriptor<P>` shape with
 * `factory: (P) => (Ctx) => Codec`; this descriptor stays only because
 * the SQL `Adapter.parameterizedCodecs()` surface still returns
 * `CodecParamsDescriptor[]` (compile-time typeParams validation only,
 * not runtime materialization).
 *
 * Retirement is tracked under TML-2357 T3.5.4 (single registration slot)
 * — the adapter-level `parameterizedCodecs()` collapses into the unified
 * runtime descriptor map once contributors migrate fully.
 *
 * @template TParams - The shape of the type parameters (e.g., `{ length: number }`)
 * @template THelper - The type returned by the optional `init` hook
 */
export interface CodecParamsDescriptor<TParams = Record<string, unknown>, THelper = unknown> {
  /** The codec ID this descriptor applies to (e.g., 'pg/vector@1') */
  readonly codecId: string;

  /**
   * Arktype schema for validating typeParams.
   * Used to validate both storage.types entries and inline column typeParams.
   */
  readonly paramsSchema: Type<TParams>;

  /**
   * Optional init hook called during runtime context creation.
   * Receives validated params and returns a helper object to be stored in context.types.
   * If not provided, the validated params are stored directly.
   *
   * Predecessor pattern. The runtime descriptor's curried
   * `factory: (P) => (Ctx) => Codec` subsumes this hook — per-instance
   * state lives on the resolved codec rather than in a parallel
   * `TypeHelperRegistry` entry. Retirement tracked under TML-2357 T3.5.2
   * (narrow runtime `Codec` interface) and T3.5.4 (single registration
   * slot). Adapter-level callers reading codec-self-carried `init` should
   * migrate to the runtime descriptor map's factory instead.
   */
  readonly init?: (params: TParams) => THelper;
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
 * Note: `paramsSchema` and `init` here are the legacy adapter-level slots
 * mirrored from {@link CodecParamsDescriptor}. The runtime materialization
 * path uses `RuntimeParameterizedCodecDescriptor` (in
 * `@prisma-next/sql-runtime`) via the unified `CodecDescriptor<P>` shape;
 * codec-self-carried `paramsSchema`/`init` retire under TML-2357 (T3.5.2
 * narrows the runtime `Codec` interface; T3.5.4 collapses the parallel
 * registration slots).
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
  readonly meta?: CodecMeta;
  readonly paramsSchema?: Type<TParams>;
  /**
   * Predecessor init hook. Retirement tracked under TML-2357 (T3.5.2 /
   * T3.5.4); the unified runtime descriptor's
   * `factory: (P) => (Ctx) => Codec` is the replacement.
   */
  readonly init?: (params: TParams) => THelper;
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

    // Update byScalar mapping
    for (const scalarType of codec.targetTypes) {
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

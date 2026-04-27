import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Type } from 'arktype';
import type { O } from 'ts-toolbelt';

export type { CodecTrait } from '@prisma-next/framework-components/codec';

/**
 * Descriptor for parameterized codecs that require type parameter validation.
 * Shared between adapter (compile-time) and runtime layers to avoid duplication.
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
  readonly meta?: CodecMeta;
  readonly paramsSchema?: Type<TParams>;
  readonly init?: (params: TParams) => THelper;
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
 * contract documented on `Codec`.
 *
 * `encode` is optional — when omitted, an identity default is installed
 * (declaring "the input value already is the wire value", so `TInput` and
 * `TWire` are interchangeable for that codec). `decode` is always
 * required. `encodeJson` and `decodeJson` default to identity **only when
 * `TInput` is assignable to `JsonValue`**; otherwise both are required
 * so the contract artifact stays JSON-safe.
 */
export function codec<
  Id extends string,
  const TTraits extends readonly CodecTrait[],
  TWire,
  TInput,
  TParams = Record<string, unknown>,
  THelper = unknown,
>(
  config: {
    typeId: Id;
    targetTypes: readonly string[];
    encode?: (value: TInput) => TWire | Promise<TWire>;
    decode: (wire: TWire) => TInput | Promise<TInput>;
    meta?: CodecMeta;
    paramsSchema?: Type<TParams>;
    init?: (params: TParams) => THelper;
    traits?: TTraits;
    renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
  } & JsonRoundTripConfig<TInput>,
): Codec<Id, TTraits, TWire, TInput, TParams, THelper> {
  const identity = (v: unknown) => v;
  // The synchronous identity default is only safe when the author has
  // declared "the input is already the wire value" (i.e. TInput == TWire);
  // it returns the value directly, never a Promise.
  const userEncode = config.encode ?? ((value: TInput) => value as unknown as TWire);
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
    encode: async (value) => userEncode(value),
    decode: async (wire) => userDecode(wire),
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

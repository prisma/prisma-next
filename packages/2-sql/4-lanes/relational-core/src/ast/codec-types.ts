import type { JsonValue } from '@prisma-next/contract/types';
import type {
  Codec as BaseCodec,
  CodecDecodeResult,
  CodecEncodeResult,
  CodecRuntimeBehavior,
  CodecTrait,
} from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Type } from 'arktype';
import type { O } from 'ts-toolbelt';

export type {
  CodecDecodeResult,
  CodecEncodeResult,
  CodecRuntimeBehavior,
  CodecTrait,
} from '@prisma-next/framework-components/codec';

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
 * SQL codec interface — extends the framework base with SQL-specific fields.
 *
 * Runtime encode/decode hooks may be asynchronous, but contract JSON conversion
 * remains synchronous. SQL runtime paths branch only when a codec opts into
 * async runtime work via `runtime.encode` and/or `runtime.decode`.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TParams = Record<string, unknown>,
  THelper = unknown,
  TOutput = TInput,
  TRuntime extends CodecRuntimeBehavior | undefined = undefined,
> extends BaseCodec<Id, TTraits, TWire, TInput, TOutput, TRuntime> {
  readonly meta?: CodecMeta;
  readonly paramsSchema?: Type<TParams>;
  readonly init?: (params: TParams) => THelper;
}

type AnyCodec = Codec<
  string,
  readonly CodecTrait[],
  unknown,
  unknown,
  Record<string, unknown>,
  unknown,
  unknown,
  CodecRuntimeBehavior | undefined
>;

/**
 * Registry interface for codecs organized by ID and by contract scalar type.
 *
 * The registry allows looking up codecs by their namespaced ID or by the
 * contract scalar types they handle. Multiple codecs may handle the same
 * scalar type; ordering in byScalar reflects preference (adapter first,
 * then packs, then app overrides).
 */
export interface CodecRegistry {
  get(id: string): AnyCodec | undefined;
  has(id: string): boolean;
  getByScalar(scalar: string): readonly AnyCodec[];
  getDefaultCodec(scalar: string): AnyCodec | undefined;
  register(codec: AnyCodec): void;
  /** Returns true if the codec with this ID has the given trait. */
  hasTrait(codecId: string, trait: CodecTrait): boolean;
  /** Returns all traits for a codec, or an empty array if not found. */
  traitsOf(codecId: string): readonly CodecTrait[];
  [Symbol.iterator](): Iterator<AnyCodec>;
  values(): IterableIterator<AnyCodec>;
}

/**
 * Implementation of CodecRegistry.
 */
class CodecRegistryImpl implements CodecRegistry {
  private readonly _byId = new Map<string, AnyCodec>();
  private readonly _byScalar = new Map<string, AnyCodec[]>();

  /**
   * Map-like interface for codec lookup by ID.
   * Example: registry.get('pg/text@1')
   */
  get(id: string): AnyCodec | undefined {
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
  getByScalar(scalar: string): readonly AnyCodec[] {
    return this._byScalar.get(scalar) ?? Object.freeze([]);
  }

  /**
   * Get the default codec for a scalar type (first registered codec).
   * Returns undefined if no codec handles this scalar type.
   */
  getDefaultCodec(scalar: string): AnyCodec | undefined {
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
  register(codec: AnyCodec): void {
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
  *[Symbol.iterator](): Iterator<AnyCodec> {
    for (const codec of this._byId.values()) {
      yield codec;
    }
  }

  /**
   * Returns an iterable of all registered codecs.
   */
  values(): IterableIterator<AnyCodec> {
    return this._byId.values();
  }
}

/**
 * Codec factory - creates a codec with typeId and encode/decode functions.
 * Provides identity defaults for encodeJson/decodeJson when not supplied.
 */
export function codec<
  Id extends string,
  const TTraits extends readonly CodecTrait[],
  TWire,
  TInput,
  TParams = Record<string, unknown>,
  THelper = unknown,
  TOutput = TInput,
  TRuntime extends CodecRuntimeBehavior | undefined = undefined,
>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  encode: (value: TInput) => CodecEncodeResult<TWire, TRuntime>;
  decode: (wire: TWire) => CodecDecodeResult<TOutput, TRuntime>;
  encodeJson?: (value: TInput) => JsonValue;
  decodeJson?: (json: JsonValue) => TInput;
  meta?: CodecMeta;
  paramsSchema?: Type<TParams>;
  init?: (params: TParams) => THelper;
  traits?: TTraits;
  runtime?: TRuntime;
  renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
}): Codec<Id, TTraits, TWire, TInput, TParams, THelper, TOutput, TRuntime> {
  const identity = (v: unknown) => v;
  type CodecResult = Codec<Id, TTraits, TWire, TInput, TParams, THelper, TOutput, TRuntime>;

  const baseCodec: Omit<CodecResult, 'runtime'> = {
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
    encode: config.encode,
    decode: config.decode,
    encodeJson: (config.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (config.decodeJson ?? identity) as (json: JsonValue) => TInput,
  };

  if (config.runtime === undefined) {
    return baseCodec;
  }

  return {
    ...baseCodec,
    runtime: config.runtime,
  };
}

/**
 * Type helpers to extract codec types.
 */
export type CodecId<T> =
  T extends Codec<
    infer Id,
    infer _TTraits,
    infer _TWire,
    infer _TInput,
    infer _TParams,
    infer _THelper,
    infer _TOutput,
    infer _TRuntime
  >
    ? Id
    : T extends { readonly id: infer Id }
      ? Id
      : never;
export type CodecInput<T> =
  T extends Codec<
    string,
    readonly CodecTrait[],
    unknown,
    infer TInput,
    infer _TParams,
    infer _THelper,
    infer _TOutput,
    infer _TRuntime
  >
    ? TInput
    : never;
export type CodecOutput<T> =
  T extends Codec<
    string,
    readonly CodecTrait[],
    unknown,
    infer _TInput,
    infer _TParams,
    infer _THelper,
    infer TOutput,
    infer TRuntime
  >
    ? // Await the codec-declared TOutput before re-wrapping so authors who
      // type their async `decode` return explicitly as `Promise<User>` do not
      // produce a `Promise<Promise<User>>` from the factory.
      TRuntime extends { readonly decode: 'async' }
      ? Promise<Awaited<TOutput>>
      : Awaited<TOutput>
    : never;
export type CodecTraits<T> =
  T extends Codec<
    string,
    infer TTraits,
    infer _TWire,
    infer _TInput,
    infer _TParams,
    infer _THelper,
    infer _TOutput,
    infer _TRuntime
  >
    ? TTraits[number] & CodecTrait
    : never;

/**
 * Type helper to extract codec types from builder instance.
 */
export type ExtractCodecTypes<
  ScalarNames extends { readonly [K in keyof ScalarNames]: AnyCodec } = Record<never, never>,
> = {
  readonly [K in keyof ScalarNames as CodecId<ScalarNames[K]> & string]: {
    readonly input: CodecInput<ScalarNames[K]>;
    readonly output: CodecOutput<ScalarNames[K]>;
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
export type ExtractDataTypes<ScalarNames extends { readonly [K in keyof ScalarNames]: AnyCodec }> =
  {
    readonly [K in keyof ScalarNames]: {
      readonly [Id in keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>]: Id;
    }[keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>];
  };

/**
 * Builder interface for declaring codecs.
 */
export interface CodecDefBuilder<
  ScalarNames extends { readonly [K in keyof ScalarNames]: AnyCodec } = Record<never, never>,
> {
  readonly CodecTypes: ExtractCodecTypes<ScalarNames>;

  add<ScalarName extends string, CodecImpl extends AnyCodec>(
    scalarName: ScalarName,
    codecImpl: CodecImpl,
  ): CodecDefBuilder<
    O.Overwrite<ScalarNames, Record<ScalarName, CodecImpl>> & Record<ScalarName, CodecImpl>
  >;

  readonly codecDefinitions: {
    readonly [K in keyof ScalarNames]: {
      readonly typeId: CodecId<ScalarNames[K]> & string;
      readonly scalar: K;
      readonly codec: ScalarNames[K];
      readonly input: CodecInput<ScalarNames[K]>;
      readonly output: CodecOutput<ScalarNames[K]>;
      readonly outputType: CodecOutput<ScalarNames[K]>;
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
  ScalarNames extends { readonly [K in keyof ScalarNames]: AnyCodec } = Record<never, never>,
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
      const codecImplTyped = codecImpl as AnyCodec;
      codecTypes[codecImplTyped.id] = {
        input: undefined as unknown as CodecInput<typeof codecImplTyped>,
        output: undefined as unknown as CodecOutput<typeof codecImplTyped>,
        traits: undefined as unknown as CodecTraits<typeof codecImplTyped>,
      };
    }
    this.CodecTypes = codecTypes as ExtractCodecTypes<ScalarNames>;

    // Populate dataTypes from codecs - extract id property from each codec.
    // Narrowed to `Record<string, string>` during construction; the final
    // assignment uses a structural cast to preserve the literal-keyed shape.
    const dataTypes: Record<string, string> = {};
    for (const key in this._codecs) {
      if (Object.hasOwn(this._codecs, key)) {
        const codec = this._codecs[key] as AnyCodec;
        dataTypes[key] = codec.id;
      }
    }
    this.dataTypes = dataTypes as {
      readonly [K in keyof ScalarNames]: {
        readonly [Id in keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>]: Id;
      }[keyof ExtractCodecTypes<Record<K, ScalarNames[K]>>];
    };
  }

  add<ScalarName extends string, CodecImpl extends AnyCodec>(
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
      readonly typeId: CodecId<ScalarNames[K]> & string;
      readonly scalar: K;
      readonly codec: ScalarNames[K];
      readonly input: CodecInput<ScalarNames[K]>;
      readonly output: CodecOutput<ScalarNames[K]>;
      readonly outputType: CodecOutput<ScalarNames[K]>;
    };
  } {
    const result: Record<
      string,
      {
        typeId: string;
        scalar: string;
        codec: AnyCodec;
        input: unknown;
        output: unknown;
        outputType: unknown;
      }
    > = {};

    for (const [scalarName, codecImpl] of Object.entries(this._codecs)) {
      const codec = codecImpl as AnyCodec;
      result[scalarName] = {
        typeId: codec.id,
        scalar: scalarName,
        codec: codec,
        input: undefined as unknown as CodecInput<typeof codec>,
        output: undefined as unknown as CodecOutput<typeof codec>,
        outputType: undefined as unknown as CodecOutput<typeof codec>,
      };
    }

    return result as {
      readonly [K in keyof ScalarNames]: {
        readonly typeId: CodecId<ScalarNames[K]> & string;
        readonly scalar: K;
        readonly codec: ScalarNames[K];
        readonly input: CodecInput<ScalarNames[K]>;
        readonly output: CodecOutput<ScalarNames[K]>;
        readonly outputType: CodecOutput<ScalarNames[K]>;
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

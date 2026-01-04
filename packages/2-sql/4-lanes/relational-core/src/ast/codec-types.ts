import type { O } from 'ts-toolbelt';

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
 * Codec interface for encoding/decoding values between wire format and JavaScript types.
 *
 * Codecs are pure, synchronous functions with no side effects or IO.
 * They provide deterministic conversion between database wire types and JS values.
 */
export interface Codec<Id extends string = string, TWire = unknown, TJs = unknown> {
  /**
   * Namespaced codec identifier in format 'namespace/name@version'
   * Examples: 'pg/text@1', 'pg/uuid@1', 'pg/timestamptz@1'
   */
  readonly id: Id;

  /**
   * Contract scalar type IDs that this codec can handle.
   * Examples: ['text'], ['int4', 'float8'], ['timestamp', 'timestamptz']
   */
  readonly targetTypes: readonly string[];

  /**
   * Optional metadata for database-specific type information.
   * Used for schema introspection and verification.
   */
  readonly meta?: CodecMeta;

  /**
   * Decode a wire value (from database) to JavaScript type.
   * Must be synchronous and pure (no side effects).
   */
  decode(wire: TWire): TJs;

  /**
   * Encode a JavaScript value to wire format (for database).
   * Optional - if not provided, values pass through unchanged.
   * Must be synchronous and pure (no side effects).
   */
  encode?(value: TJs): TWire;
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
 * Codec factory - creates a codec with typeId and encode/decode functions.
 */
export function codec<Id extends string, TWire, TJs>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  encode: (value: TJs) => TWire;
  decode: (wire: TWire) => TJs;
  meta?: CodecMeta;
}): Codec<Id, TWire, TJs> {
  return {
    id: config.typeId,
    targetTypes: config.targetTypes,
    ...(config.meta ? { meta: config.meta } : {}),
    encode: config.encode,
    decode: config.decode,
  };
}

/**
 * Type helpers to extract codec types.
 */
export type CodecId<T> =
  T extends Codec<infer Id, unknown, unknown>
    ? Id
    : T extends { readonly id: infer Id }
      ? Id
      : never;
export type CodecInput<T> = T extends Codec<string, unknown, infer JsT> ? JsT : never;
export type CodecOutput<T> = T extends Codec<string, unknown, infer JsT> ? JsT : never;

/**
 * Type helper to extract codec types from builder instance.
 */
export type ExtractCodecTypes<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> } = Record<never, never>,
> = {
  readonly [K in keyof ScalarNames as ScalarNames[K] extends Codec<infer Id, unknown, unknown>
    ? Id
    : never]: {
    readonly input: CodecInput<ScalarNames[K]>;
    readonly output: CodecOutput<ScalarNames[K]>;
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
      readonly typeId: ScalarNames[K] extends Codec<infer Id extends string, unknown, unknown>
        ? Id
        : never;
      readonly scalar: K;
      readonly codec: ScalarNames[K];
      readonly input: CodecInput<ScalarNames[K]>;
      readonly output: CodecOutput<ScalarNames[K]>;
      readonly jsType: CodecOutput<ScalarNames[K]>;
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
    const codecTypes: Record<string, { readonly input: unknown; readonly output: unknown }> = {};
    for (const [, codecImpl] of Object.entries(this._codecs)) {
      const codecImplTyped = codecImpl as Codec<string>;
      codecTypes[codecImplTyped.id] = {
        input: undefined as unknown as CodecInput<typeof codecImplTyped>,
        output: undefined as unknown as CodecOutput<typeof codecImplTyped>,
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
      readonly typeId: ScalarNames[K] extends Codec<infer Id, unknown, unknown> ? Id : never;
      readonly scalar: K;
      readonly codec: ScalarNames[K];
      readonly input: CodecInput<ScalarNames[K]>;
      readonly output: CodecOutput<ScalarNames[K]>;
      readonly jsType: CodecOutput<ScalarNames[K]>;
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
        output: undefined as unknown as CodecOutput<typeof codec>,
        jsType: undefined as unknown as CodecOutput<typeof codec>,
      };
    }

    return result as {
      readonly [K in keyof ScalarNames]: {
        readonly typeId: ScalarNames[K] extends Codec<infer Id extends string, unknown, unknown>
          ? Id
          : never;
        readonly scalar: K;
        readonly codec: ScalarNames[K];
        readonly input: CodecInput<ScalarNames[K]>;
        readonly output: CodecOutput<ScalarNames[K]>;
        readonly jsType: CodecOutput<ScalarNames[K]>;
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

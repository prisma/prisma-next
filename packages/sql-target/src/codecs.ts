/**
 * Codec interface for encoding/decoding values between wire format and JavaScript types.
 *
 * Codecs are pure, synchronous functions with no side effects or IO.
 * They provide deterministic conversion between database wire types and JS values.
 */
export interface Codec<TWire = unknown, TJs = unknown> {
  /**
   * Namespaced codec identifier in format 'namespace/name@version'
   * Examples: 'pg/text@1', 'pg/uuid@1', 'pg/timestamptz@1'
   */
  readonly id: string;

  /**
   * Contract scalar type IDs that this codec can handle.
   * Examples: ['text'], ['int4', 'float8'], ['timestamp', 'timestamptz']
   */
  readonly targetTypes: readonly string[];

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
 * Registry of codecs organized by ID and by contract scalar type.
 *
 * The registry allows looking up codecs by their namespaced ID or by the
 * contract scalar types they handle. Multiple codecs may handle the same
 * scalar type; ordering in byScalar reflects preference (adapter first,
 * then packs, then app overrides).
 */
export class CodecRegistry {
  private readonly _byId = new Map<string, Codec>();
  private readonly _byScalar = new Map<string, Codec[]>();

  /**
   * Map-like interface for codec lookup by ID.
   * Example: registry.get('pg/text@1')
   */
  get(id: string): Codec | undefined {
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
  getByScalar(scalar: string): readonly Codec[] {
    return this._byScalar.get(scalar) ?? Object.freeze([]);
  }

  /**
   * Get the default codec for a scalar type (first registered codec).
   * Returns undefined if no codec handles this scalar type.
   */
  getDefaultCodec(scalar: string): Codec | undefined {
    const codecs = this._byScalar.get(scalar);
    return codecs?.[0];
  }

  /**
   * Register a codec in the registry.
   * Throws an error if a codec with the same ID is already registered.
   *
   * @param codec - The codec to register
   * @throws Error if a codec with the same ID already exists
   */
  register(codec: Codec): void {
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
  *[Symbol.iterator](): Iterator<Codec> {
    for (const codec of this._byId.values()) {
      yield codec;
    }
  }

  /**
   * Returns an iterable of all registered codecs.
   */
  values(): IterableIterator<Codec> {
    return this._byId.values();
  }
}

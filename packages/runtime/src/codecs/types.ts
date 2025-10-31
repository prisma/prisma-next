/**
 * Codec interface for encoding/decoding values between wire format and JavaScript types.
 *
 * Codecs are pure, synchronous functions with no side effects or IO.
 * They provide deterministic conversion between database wire types and JS values.
 */
export interface Codec<TWire = unknown, TJs = unknown> {
  /**
   * Namespaced codec identifier in format 'namespace/name@version'
   * Examples: 'core/string@1', 'pg/uuid@1', 'core/iso-datetime@1'
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
export interface CodecRegistry {
  /**
   * Direct lookup by namespaced codec ID.
   * Example: registry.byId.get('core/string@1')
   */
  readonly byId: ReadonlyMap<string, Codec>;

  /**
   * Lookup by contract scalar type ID, returning ordered candidates.
   * Example: registry.byScalar.get('text') → [codec1, codec2, ...]
   * The first codec in the array is the default/preferred candidate.
   */
  readonly byScalar: ReadonlyMap<string, readonly Codec[]>;
}


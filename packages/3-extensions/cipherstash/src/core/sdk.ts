/**
 * Framework-native shape for the CipherStash SDK that the cipherstash
 * extension wraps.
 *
 * The first-attempt SDK (see `reference/cipherstash/stack/...`) is rich
 * and Prisma-adapter shaped (e.g. `EncryptOperation`, `LockContext`,
 * lazy-initialized `EncryptionClient`). The framework-native shape we
 * consume from the bulk-encrypt middleware (`beforeExecute`), the codec
 * (`decode`), and the `decryptAll` walker is intentionally smaller:
 * three async methods that each map cleanly to one CipherStash bulk-call
 * shape.
 *
 * - `decrypt`     — single-cell read used by `EncryptedString#decrypt()`
 *   when the user opts out of bulk decryption.
 * - `bulkEncrypt` — write-side coalesced encrypt. M2.c wires this from
 *   the bulk-encrypt middleware (`beforeExecute`); declared here in
 *   M2.a so the SDK shape stays single-source-of-truth.
 * - `bulkDecrypt` — read-side coalesced decrypt. M4 wires this from
 *   `decryptAll`.
 *
 * Each method accepts an optional `AbortSignal`; cancellation is
 * forwarded directly to the SDK per the umbrella spec's cancellation
 * contract (the per-execute `MiddlewareContext.signal` from M1's
 * middleware-param-transform seam, or the caller-supplied signal on
 * `decrypt({signal})`).
 */

/**
 * Routing-key tuple used by `bulkEncrypt`/`bulkDecrypt` to group
 * requests so each ZeroKMS round-trip handles one homogeneous batch.
 *
 * Default shape: derived from `(table, column)`. Per-column key-id
 * overrides are an open question on the umbrella spec; today the SDK
 * routing is fully derived.
 */
export interface CipherstashRoutingKey {
  readonly table: string;
  readonly column: string;
}

export interface CipherstashSingleDecryptArgs {
  /**
   * The wire ciphertext to decrypt. Opaque to the framework; the SDK
   * inspects the embedded `i.t` / `i.c` schema markers to pick the
   * right `cast_as` for the round-trip.
   */
  readonly ciphertext: unknown;
  /** Routing-key — the source `(table, column)` for the cell. */
  readonly table: string;
  readonly column: string;
  /** Optional caller-provided signal forwarded directly to the SDK. */
  readonly signal?: AbortSignal;
}

export interface CipherstashBulkEncryptArgs {
  readonly routingKey: CipherstashRoutingKey;
  readonly values: ReadonlyArray<string>;
  readonly signal?: AbortSignal;
}

export interface CipherstashBulkDecryptArgs {
  readonly routingKey: CipherstashRoutingKey;
  readonly ciphertexts: ReadonlyArray<unknown>;
  readonly signal?: AbortSignal;
}

/**
 * The framework-native CipherStash SDK contract consumed by the
 * envelope, codec, middleware, and `decryptAll` surfaces.
 *
 * Real implementations wrap the CipherStash `EncryptionClient`
 * (currently `@cipherstash/stack`'s `Encryption({ schemas })` factory).
 * Tests construct mock SDKs that implement these three methods directly.
 */
export interface CipherstashSdk {
  decrypt(args: CipherstashSingleDecryptArgs): Promise<string>;
  bulkEncrypt(args: CipherstashBulkEncryptArgs): Promise<ReadonlyArray<unknown>>;
  bulkDecrypt(args: CipherstashBulkDecryptArgs): Promise<ReadonlyArray<string>>;
}

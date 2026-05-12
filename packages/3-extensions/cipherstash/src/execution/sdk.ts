/**
 * Framework-native shape for the CipherStash SDK that the cipherstash
 * extension wraps.
 *
 * The first-attempt SDK (see `reference/cipherstash/stack/...`) is rich
 * and Prisma-adapter shaped. The framework-native shape consumed by the
 * codec runtime, the bulk-encrypt middleware, and `decryptAll` is
 * intentionally smaller — three async methods that each map cleanly to
 * one CipherStash bulk-call shape:
 *
 *   - `decrypt`     — single-cell read used by `EncryptedString#decrypt()`
 *                     when the user opts out of bulk decryption.
 *   - `bulkEncrypt` — write-side coalesced encrypt; the bulk-encrypt
 *                     middleware calls this from `beforeExecute`.
 *   - `bulkDecrypt` — read-side coalesced decrypt; `decryptAll` calls
 *                     this from a recursive walker.
 *
 * Each method accepts an optional `AbortSignal`. Cancellation is forwarded
 * directly to the SDK (the per-execute `MiddlewareContext.signal` from
 * the middleware-param-transform seam, or the caller-supplied signal on
 * `decrypt({signal})`).
 */

/**
 * Routing-key tuple used by `bulkEncrypt`/`bulkDecrypt` to group requests
 * so each ZeroKMS round-trip handles one homogeneous batch. Routing key
 * is `(table, column)`.
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
  readonly table: string;
  readonly column: string;
  readonly signal?: AbortSignal;
}

export interface CipherstashBulkEncryptArgs {
  readonly routingKey: CipherstashRoutingKey;
  /**
   * Plaintext values to encrypt. Polymorphic at the SDK boundary: each
   * batch is homogeneously typed by its `(table, column)` routing key,
   * so the SDK derives the EQL `cast_as` from the search-config already
   * registered on the column rather than from a per-batch hint.
   */
  readonly values: ReadonlyArray<unknown>;
  readonly signal?: AbortSignal;
}

export interface CipherstashBulkDecryptArgs {
  readonly routingKey: CipherstashRoutingKey;
  readonly ciphertexts: ReadonlyArray<unknown>;
  readonly signal?: AbortSignal;
}

/**
 * The framework-native CipherStash SDK contract consumed by the envelope,
 * codec, middleware, and `decryptAll` surfaces. Real implementations wrap
 * a CipherStash `EncryptionClient`; tests construct mock SDKs that
 * implement these three methods directly.
 */
export interface CipherstashSdk {
  decrypt(args: CipherstashSingleDecryptArgs): Promise<string>;
  bulkEncrypt(args: CipherstashBulkEncryptArgs): Promise<ReadonlyArray<unknown>>;
  bulkDecrypt(args: CipherstashBulkDecryptArgs): Promise<ReadonlyArray<unknown>>;
}

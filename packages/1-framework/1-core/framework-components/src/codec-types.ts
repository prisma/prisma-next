import type { JsonValue } from '@prisma-next/contract/types';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';

/**
 * A codec is the contract between an application value and its on-wire and
 * on-contract-disk representations.
 *
 * Author one JS type at the app boundary; the codec translates that type
 * to the database driver's wire format and back, and to the JSON-safe form
 * used in contract artifacts. Most codecs use one JS type for both writes
 * and reads, so `TInput` and `TOutput` collapse to the same type. When a
 * richer return type makes sense (e.g. write `string`, read `Date`), pass
 * distinct types to `encode`'s parameter and `decode`'s return — the codec
 * then carries an asymmetric input / output shape.
 *
 * Four representations participate:
 * - **Input** (`TInput`): the JS type accepted on writes.
 * - **Output** (`TOutput`): the JS type produced on reads (defaults to `TInput`).
 * - **Wire** (`TWire`): the format exchanged with the database driver.
 * - **JSON** (`JsonValue`): a JSON-safe form used in contract artifacts.
 *
 * Codec methods split into two groups:
 *
 * - **Query-time** methods (`encode`, `decode`) run per row/parameter at the
 *   IO boundary; they are required and Promise-returning. The per-family
 *   codec factory accepts sync or async author functions and lifts sync
 *   ones to Promise-shaped methods automatically.
 * - **Build-time** methods (`encodeJson`, `decodeJson`, `renderOutputType`)
 *   run when the contract is serialized, loaded, or when client types are
 *   emitted. They stay synchronous so contract validation and client
 *   construction are synchronous.
 *
 * Target-family codec interfaces extend this base with target-shaped
 * metadata.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz@1`). */
  readonly id: Id;
  /** Database-native type names this codec handles (e.g. `['timestamptz']`). */
  readonly targetTypes: readonly string[];
  /** Semantic traits for operator gating (e.g. equality, order, numeric). */
  readonly traits?: TTraits;
  /** Converts a JS value to the wire format expected by the database driver. Always Promise-returning at the boundary. */
  encode(value: TInput): Promise<TWire>;
  /** Converts a wire value from the database driver into the JS output type. Always Promise-returning at the boundary. */
  decode(wire: TWire): Promise<TOutput>;
  /** Converts a JS value to a JSON-safe representation for contract serialization. Synchronous; called during contract emission. */
  encodeJson(value: TInput): JsonValue;
  /** Converts a JSON representation back to the JS input type. Synchronous; called during contract loading via `validateContract`. */
  decodeJson(json: JsonValue): TInput;
  /** Produces the TypeScript output type expression for a field given its `typeParams`. Synchronous; used during contract.d.ts emission. */
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}

export interface CodecLookup {
  get(id: string): Codec | undefined;
}

export const emptyCodecLookup: CodecLookup = {
  get: () => undefined,
};

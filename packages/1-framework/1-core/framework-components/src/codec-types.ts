import type { JsonValue } from '@prisma-next/contract/types';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';

/**
 * Base codec interface for all target families.
 *
 * A codec maps between four representations of a value:
 * - **Input** (`TInput`): the JavaScript type accepted on writes
 * - **Output** (`TOutput`): the JavaScript type produced on reads (defaults to `TInput`)
 * - **Wire** (`TWire`): the format sent to/from the database driver
 * - **JSON** (`JsonValue`): the JSON-safe form stored in contract artifacts
 *
 * The interface lands on the seam between **query-time** (per-row, IO-relevant)
 * and **build-time** (per-contract-load) methods:
 *
 * - **Query-time methods** (`encode`, `decode`) are required and Promise-returning
 *   at the boundary. The codec factory (`codec()`) accepts both sync and async
 *   author functions and lifts sync ones to Promise-shaped methods, so authors
 *   write whichever shape is natural per method.
 * - **Build-time methods** (`encodeJson`, `decodeJson`, `renderOutputType`) are
 *   synchronous so `validateContract` and client construction stay synchronous.
 *
 * Family-specific codec interfaces (SQL `Codec`, Mongo `MongoCodec`) extend
 * this base to add family-specific metadata.
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

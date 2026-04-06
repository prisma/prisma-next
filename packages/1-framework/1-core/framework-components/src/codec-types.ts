import type { JsonValue } from '@prisma-next/contract/types';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';

/**
 * Base codec interface for all target families.
 *
 * A codec maps between three representations of a value:
 * - **JS** (`TJs`): the JavaScript type used in application code
 * - **Wire** (`TWire`): the format sent to/from the database driver
 * - **JSON** (`JsonValue`): the JSON-safe form stored in contract artifacts
 *
 * Family-specific codec interfaces (SQL `Codec`, Mongo `MongoCodec`) extend
 * this base to add family-specific metadata.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TJs = unknown,
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz@1`). */
  readonly id: Id;
  /** Database-native type names this codec handles (e.g. `['timestamptz']`). */
  readonly targetTypes: readonly string[];
  /** Semantic traits for operator gating (e.g. equality, order, numeric). */
  readonly traits?: TTraits;
  /** Converts a JS value to the wire format expected by the database driver. Optional when the driver accepts the JS type directly. */
  encode?(value: TJs): TWire;
  /** Converts a wire value from the database driver into the JS type. */
  decode(wire: TWire): TJs;
  /** Converts a JS value to a JSON-safe representation for contract serialization. Called during contract emission. */
  encodeJson(value: TJs): JsonValue;
  /** Converts a JSON representation back to the JS type. Called during contract loading via `validateContract`. */
  decodeJson(json: JsonValue): TJs;
}

export interface CodecLookup {
  get(id: string): Codec | undefined;
}

export const emptyCodecLookup: CodecLookup = {
  get: () => undefined,
};

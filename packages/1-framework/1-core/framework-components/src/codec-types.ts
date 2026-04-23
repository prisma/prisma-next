import type { JsonValue } from '@prisma-next/contract/types';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';
export type CodecRuntimeBehavior = {
  readonly encode?: 'async';
  readonly decode?: 'async';
};

type CodecEncodeResult<TWire, TEncodeAsync extends boolean> = TEncodeAsync extends true
  ? Promise<TWire>
  : TWire;
type CodecDecodeResult<TOutput, TDecodeAsync extends boolean> = TDecodeAsync extends true
  ? Promise<TOutput>
  : TOutput;

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
  TInput = unknown,
  TOutput = TInput,
  TEncodeAsync extends boolean = false,
  TDecodeAsync extends boolean = false,
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz@1`). */
  readonly id: Id;
  /** Database-native type names this codec handles (e.g. `['timestamptz']`). */
  readonly targetTypes: readonly string[];
  /** Semantic traits for operator gating (e.g. equality, order, numeric). */
  readonly traits?: TTraits;
  /** Declares whether runtime encode/decode work crosses an async boundary. */
  readonly runtime?: CodecRuntimeBehavior;
  /** Converts an app-facing value to the wire format expected by the database driver. Optional when the driver accepts the app value directly. */
  encode?(value: TInput): CodecEncodeResult<TWire, TEncodeAsync>;
  /** Converts a wire value from the database driver into the app-facing result type. */
  decode(wire: TWire): CodecDecodeResult<TOutput, TDecodeAsync>;
  /** Converts an app-facing value to a JSON-safe representation for contract serialization. Called during contract emission. */
  encodeJson(value: TInput): JsonValue;
  /** Converts a JSON representation back to the app-facing write/input type. Called during contract loading via `validateContract`. */
  decodeJson(json: JsonValue): TInput;
  /** Produces the TypeScript output type expression for a field given its `typeParams`. Used during contract.d.ts emission. */
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}

export interface CodecLookup {
  get(id: string): Codec | undefined;
}

export const emptyCodecLookup: CodecLookup = {
  get: () => undefined,
};

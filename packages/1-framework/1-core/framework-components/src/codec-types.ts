import type { JsonValue } from '@prisma-next/contract/types';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';
export type CodecRuntimeBehavior = {
  readonly encode?: 'async';
  readonly decode?: 'async';
};

/** Returns Promise<TWire> when the runtime config marks encoding async, else TWire. */
export type CodecEncodeResult<TWire, TRuntime> = TRuntime extends {
  readonly encode: 'async';
}
  ? Promise<TWire>
  : TWire;
/** Returns Promise<TOutput> when the runtime config marks decoding async, else TOutput. */
export type CodecDecodeResult<TOutput, TRuntime> = TRuntime extends {
  readonly decode: 'async';
}
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
 *
 * `TRuntime` carries the codec's async-runtime contract. Defaulting to
 * `undefined` means encode/decode are synchronous — family factories that
 * pin `TRuntime = undefined` (e.g. Mongo) statically guarantee sync-only
 * behavior at the type level.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
  TRuntime extends CodecRuntimeBehavior | undefined = undefined,
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz@1`). */
  readonly id: Id;
  /** Database-native type names this codec handles (e.g. `['timestamptz']`). */
  readonly targetTypes: readonly string[];
  /** Semantic traits for operator gating (e.g. equality, order, numeric). */
  readonly traits?: TTraits;
  /**
   * Declares whether runtime encode/decode work crosses an async boundary.
   * The field type is deliberately `CodecRuntimeBehavior` (not `TRuntime`) so
   * a generic `Codec` reference with default `TRuntime = undefined` still
   * lets consumers inspect `codec.runtime?.decode === 'async'` at runtime.
   * `TRuntime` remains the type-level flag threaded into encode/decode
   * signatures so authoring-side inference stays precise.
   */
  readonly runtime?: CodecRuntimeBehavior;
  /** Converts an app-facing value to the wire format expected by the database driver. Optional when the driver accepts the app value directly. */
  encode?(value: TInput): CodecEncodeResult<TWire, TRuntime>;
  /** Converts a wire value from the database driver into the app-facing result type. */
  decode(wire: TWire): CodecDecodeResult<TOutput, TRuntime>;
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

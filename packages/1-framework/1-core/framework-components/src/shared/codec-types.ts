import type { JsonValue } from '@prisma-next/contract/types';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';

/**
 * Per-call context the runtime threads to every `codec.encode` /
 * `codec.decode` invocation for a single `runtime.execute()` call.
 *
 * The framework-level shape is family-agnostic and carries one field:
 *
 * - `signal?: AbortSignal` — per-query cancellation. The runtime returns
 *   a `RUNTIME.ABORTED` envelope when the signal aborts; codec authors
 *   who forward `signal` to their underlying SDK get true cancellation
 *   of in-flight network calls.
 *
 * Family layers extend this base with their own shape-of-call metadata:
 * the SQL family adds `column?: SqlColumnRef` via `SqlCodecCallContext`
 * (see `@prisma-next/sql-relational-core`). Mongo currently uses this
 * framework type unchanged. Column metadata is intentionally **not** on
 * the framework type — it is a SQL-family concept rooted in SQL's
 * `(table, column)` addressing model and would not generalise to other
 * families.
 *
 * The interface is named explicitly (not inlined) so future framework
 * fields and family extensions can land additively without breaking
 * codec author signatures.
 */
export interface CodecCallContext {
  readonly signal?: AbortSignal;
}

/**
 * A codec is the contract between an application value and its on-wire and
 * on-contract-disk representations.
 *
 * The author's mental model is two JS-side types — `TInput` (the
 * application JS type) and `TWire` (the database driver wire format) —
 * plus `JsonValue` for build-time contract artifacts. The codec translates
 * `TInput` to `TWire` on writes and back on reads, and to/from `JsonValue`
 * during contract emission and loading.
 *
 * Three representations participate:
 * - **Input** (`TInput`): the JS type at the application boundary.
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
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz@1`). */
  readonly id: Id;
  /** Database-native type names this codec handles (e.g. `['timestamptz']`). */
  readonly targetTypes: readonly string[];
  /** Semantic traits for operator gating (e.g. equality, order, numeric). */
  readonly traits?: TTraits;
  /** Converts a JS value to the wire format expected by the database driver. Always Promise-returning at the boundary. The optional {@link CodecCallContext} carries per-query cancellation and (on decode call sites only) column identity. */
  encode(value: TInput, ctx?: CodecCallContext): Promise<TWire>;
  /** Converts a wire value from the database driver into the JS application type. Always Promise-returning at the boundary. The optional {@link CodecCallContext} carries per-query cancellation and column identity when the cell resolves to a single (table, name). */
  decode(wire: TWire, ctx?: CodecCallContext): Promise<TInput>;
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

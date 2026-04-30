import type { JsonValue } from '@prisma-next/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export type CodecTrait =
  | 'equality'
  | 'order'
  | 'boolean'
  | 'numeric'
  | 'textual'
  /**
   * The codec carries a per-instance `validate(value: unknown) =>
   * JsonSchemaValidationResult` function on the resolved codec object that
   * the framework's `JsonSchemaValidatorRegistry` consults at runtime. The
   * trait gates the `extractValidator` cast from structurally-typed
   * `unknown` to a typed validator view.
   */
  | 'json-validator';

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
  /** Converts a JS value to the wire format expected by the database driver. Always Promise-returning at the boundary. The {@link CodecCallContext} is supplied by the runtime on every call (allocated once per `runtime.execute()`); family layers may narrow the ctx to extend it (e.g. SQL adds `column`). Author-side single-arg `(value) => …` functions remain legal via TypeScript's bivariance for trailing parameters. */
  encode(value: TInput, ctx: CodecCallContext): Promise<TWire>;
  /** Converts a wire value from the database driver into the JS application type. Always Promise-returning at the boundary. The {@link CodecCallContext} is supplied by the runtime on every call (allocated once per `runtime.execute()`); family layers may narrow the ctx to extend it (e.g. SQL adds `column`). Author-side single-arg `(wire) => …` functions remain legal via TypeScript's bivariance for trailing parameters. */
  decode(wire: TWire, ctx: CodecCallContext): Promise<TInput>;
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

/**
 * Column context supplied by the framework when applying a higher-order
 * codec factory. Allows stateful codecs (e.g. column-scoped encryption) to
 * derive per-instance state from the column it is bound to.
 *
 * - `name` — the `storage.types` instance name (e.g. `Embedding1536`) for
 *   typeRef-shaped columns, the synthesized anonymous instance name
 *   (`<anon:Document.embedding>`) for inline-`typeParams` columns, or the
 *   shared sentinel (`<shared:pg/text@1>`) for non-parameterized codec ids.
 * - `usedAt` — every column the resolved codec serves. For `typeRef`
 *   columns sharing one named instance the array lists every referencing
 *   column; for inline-`typeParams` columns the array has exactly one
 *   entry; for shared non-parameterized codecs the array carries the
 *   column that triggered materialization (representative — the codec is
 *   shared across all columns with that codec id).
 */
export interface Ctx {
  readonly name: string;
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}

/**
 * Family-agnostic codec metadata. Family-specific extensions augment the
 * base `db.<family>.<target>` block with native-type information; the base
 * shape is an empty object so non-relational codecs can carry no metadata.
 */
export interface CodecMeta {
  readonly db?: Record<string, unknown>;
}

/**
 * Unified codec descriptor. Every codec in the framework registers through
 * this shape — non-parameterized codecs use `P = void` and a constant
 * factory that returns the same shared codec instance for every column;
 * parameterized codecs use a non-empty `P` and a curried higher-order
 * factory that returns a per-instance codec.
 *
 * The descriptor is the codec-id-keyed source of truth for static metadata
 * (`traits`, `targetTypes`, `meta`) and registration concerns
 * (`paramsSchema` for JSON-boundary validation; optional `renderOutputType`
 * for the `contract.d.ts` emit path). The runtime `Codec` instance returned
 * by `factory(params)(ctx)` carries only the conversion behavior.
 *
 * Whether a codec id "is parameterized" stops being a registration-time
 * distinction — it's a property of `P` on the descriptor. The descriptor
 * map indexes every descriptor by `codecId`; both `descriptorFor(codecId)`
 * and `forColumn(table, column)` resolve through the same map without
 * branching on parameterization.
 *
 * @template P - The shape of the params accepted by the factory (`void` for
 *   non-parameterized codecs; a record like `{ length: number }` for
 *   parameterized codecs).
 *
 * Codec-registry-unification project § Decision.
 */
export interface CodecDescriptor<P = void> {
  /** The codec ID this descriptor applies to (e.g. `pg/vector@1`, `pg/text@1`). */
  readonly codecId: string;
  /** Semantic traits for operator gating (e.g. equality, order, numeric). */
  readonly traits: readonly CodecTrait[];
  /** Database-native type names this codec handles (e.g. `['timestamptz']`). */
  readonly targetTypes: readonly string[];
  /** Optional family-specific metadata (e.g. SQL-side `db.sql.postgres.nativeType`). */
  readonly meta?: CodecMeta;
  /**
   * Standard Schema validator for the factory's params. Validates JSON-
   * sourced params at the contract boundary (PSL → IR; `contract.json` →
   * runtime). For non-parameterized codecs (`P = void`), the schema
   * validates `void`/`undefined` — the framework supplies no params at the
   * call boundary.
   */
  readonly paramsSchema: StandardSchemaV1<P>;
  /**
   * Emit-path string renderer for `contract.d.ts`. Returns the TypeScript
   * output type expression for given params (e.g. `Vector<1536>`).
   * Optional; absent renderers cause the emitter to fall back to the
   * codec's base output type. Non-parameterized codecs typically omit it.
   */
  readonly renderOutputType?: (params: P) => string | undefined;
  /**
   * The curried higher-order codec. For non-parameterized codecs, the
   * factory is constant — every call returns the same shared codec
   * instance. For parameterized codecs, the factory is called once per
   * `storage.types` instance (or once per inline-`typeParams` column),
   * with `ctx` carrying the column set the resulting codec serves.
   */
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}

/**
 * Standard Schema validator for `void` params. Accepts any input and
 * returns `undefined`. Used by the framework-supplied non-parameterized
 * descriptor synthesizer.
 */
export const voidParamsSchema: StandardSchemaV1<void> = {
  '~standard': {
    version: 1,
    vendor: 'prisma-next',
    validate: () => ({ value: undefined }),
  },
};

/**
 * Synthesize a `CodecDescriptor<void>` for a non-parameterized codec
 * runtime instance. The factory is constant — every call returns the same
 * shared codec instance — so columns sharing this codec id share one
 * resolved codec.
 *
 * Codec-registry-unification spec § Decision (Case T — non-parameterized
 * text codec). This is the bridge while non-parameterized codec
 * contributors still register through the legacy `codecs:` slot; once they
 * migrate to ship descriptors directly (TML-2357 T3.5.3), this synthesis
 * steps aside.
 */
export function synthesizeNonParameterizedDescriptor(codec: Codec): CodecDescriptor<void> {
  // The descriptor's `factory: (params: void) => (ctx: Ctx) => Codec` is a
  // constant for non-parameterized codecs — `params` is never read and the
  // returned ctx-applier always yields the same shared codec. We rely on
  // the descriptor's typed `factory` slot to infer the signatures rather
  // than naming `void` locally (biome's `noConfusingVoidType` flags `void`
  // outside return positions).
  const sharedFactory = () => () => codec;
  // Family-extended codecs (SQL `Codec`) carry an optional `meta` field
  // that the base interface doesn't declare. Read it through a structural
  // narrow so the synthesizer forwards it to the descriptor without losing
  // type safety on the base shape.
  const codecMeta = (codec as { readonly meta?: CodecMeta }).meta;
  return {
    codecId: codec.id,
    traits: codec.traits ?? [],
    targetTypes: codec.targetTypes,
    paramsSchema: voidParamsSchema,
    factory: sharedFactory,
    ...(codecMeta !== undefined ? { meta: codecMeta } : {}),
  };
}

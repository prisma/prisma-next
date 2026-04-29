import type { JsonValue } from '@prisma-next/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export type CodecTrait =
  | 'equality'
  | 'order'
  | 'boolean'
  | 'numeric'
  | 'textual'
  /**
   * The codec carries a per-instance `validate(value: unknown) => unknown`
   * function on the resolved codec object (one that the framework's
   * `JsonSchemaValidatorRegistry` consults at runtime). This trait is the
   * gate that lets the runtime's `extractValidator` cast resolve from
   * structurally-typed (`unknown`) to a typed `JsonValidatorCodec` view.
   * See [ADR 205](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
   */
  | 'json-validator';

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

/**
 * Lookup of `ParameterizedCodecDescriptor` by `codecId`. Built by the control
 * stack from `ComponentMetadata.types.codecTypes.parameterizedCodecs` and
 * threaded into the emit path so the emitter consults `descriptor.renderOutputType`
 * (the spec's long-term home) rather than reading the optional field off the
 * codec object via duck-typed cast.
 */
export interface ParameterizedCodecDescriptorLookup {
  // biome-ignore lint/suspicious/noExplicitAny: descriptors carry distinct param shapes per codec; the registry is heterogeneous and the consumer narrows per codec.
  get(codecId: string): ParameterizedCodecDescriptor<any> | undefined;
}

export const emptyParameterizedCodecDescriptorLookup: ParameterizedCodecDescriptorLookup = {
  get: () => undefined,
};

/**
 * Column context supplied by the contract-authoring API when applying a higher-order
 * codec factory. Allows stateful codecs (e.g. CipherStash column-scoped encryption)
 * to derive per-instance state from the column it is bound to.
 *
 * - `name` — the `storage.types` instance name (e.g. `Embedding1536`) or the
 *   synthesized anonymous instance name (`<anon:Document.embedding>`).
 * - `usedAt` — every column that references this storage-types entry. For inline
 *   `typeParams` columns the array has exactly one entry; for `typeRef` columns
 *   pointing at a shared `storage.types` entry the array lists every referencing
 *   column post-aggregation.
 */
export interface Ctx {
  readonly name: string;
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}

/**
 * Family-agnostic codec metadata. Family-specific extensions augment the base
 * `db.<family>.<target>` block with native-type information; the base shape is
 * an empty object so non-relational codecs can carry no metadata.
 */
export interface CodecMeta {
  readonly db?: Record<string, unknown>;
}

/**
 * Unified codec descriptor. Every codec in the framework is registered through
 * this shape — non-parameterized codecs use `P = void` and a constant factory
 * that returns the same shared codec instance for every column;
 * parameterized codecs use a non-empty `P` and a curried higher-order factory
 * that returns a per-instance codec.
 *
 * The descriptor is the codec-id-keyed source of truth for static metadata
 * (`traits`, `targetTypes`, `meta`) and registration concerns (`paramsSchema`
 * for JSON-boundary validation; optional `renderOutputType` for the
 * `contract.d.ts` emit path). The runtime `Codec` instance returned by
 * `factory(params)(ctx)` carries only the conversion behavior (`encode`,
 * `decode`, `encodeJson`, `decodeJson`); codec-id-keyed metadata reads
 * consult the descriptor.
 *
 * Whether a codec id "is parameterized" stops being a registration-time
 * distinction; it's a property of `P` on the descriptor. The descriptor
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
   * Standard Schema validator for the factory's params. Validates JSON-sourced
   * params at the contract boundary (PSL → IR; `contract.json` → runtime).
   * For non-parameterized codecs (`P = void`), the schema validates `void`/
   * `undefined` — the framework supplies no params at the call boundary.
   */
  readonly paramsSchema: StandardSchemaV1<P>;
  /**
   * Emit-path string renderer for `contract.d.ts`. Returns the TypeScript output
   * type expression for given params (e.g. `Vector<1536>`). Optional; absent
   * renderers cause the emitter to fall back to the codec's base output type.
   * Non-parameterized codecs typically omit it.
   */
  readonly renderOutputType?: (params: P) => string;
  /**
   * The curried higher-order codec. For non-parameterized codecs, the factory
   * is constant — every call returns the same shared codec instance. For
   * parameterized codecs, the factory is called once per `storage.types`
   * instance (or once per inline-`typeParams` column), with `ctx` carrying
   * the column set the resulting codec serves.
   */
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}

/**
 * @deprecated Renamed to `CodecDescriptor`. Kept as a transitional alias
 * during Phase 3.5 of codec-registry-unification; will be removed once every
 * external consumer migrates. The shape is unchanged — `P` is non-void by
 * convention but the type is structurally identical.
 */
export type ParameterizedCodecDescriptor<P = Record<string, unknown>> = CodecDescriptor<P>;

/**
 * Standard Schema validator for `void` params. Accepts any input and returns
 * `undefined`. Used by the framework-supplied non-parameterized descriptor
 * synthesizer; library-supplied non-parameterized descriptors typically
 * reuse this.
 */
export const voidParamsSchema: StandardSchemaV1<void> = {
  '~standard': {
    version: 1,
    vendor: 'prisma-next',
    validate: () => ({ value: undefined }),
  },
};

/**
 * Synthesize a `CodecDescriptor<void>` for a non-parameterized codec runtime
 * instance. The factory is constant — every call returns the same shared
 * codec instance — so columns sharing this codec id share one resolved codec.
 *
 * Codec-registry-unification spec § Decision (Case T — non-parameterized text
 * codec). This is the bridge while non-parameterized codec contributors still
 * register through the legacy `codecs:` slot; once they migrate to ship
 * descriptors directly (Phase 3.5 T3.5.3), this synthesis steps aside.
 */
export function synthesizeNonParameterizedDescriptor(codec: Codec): CodecDescriptor<void> {
  const resolvedCtxFactory: (ctx: Ctx) => Codec = () => codec;
  const sharedFactory: (params: void) => (ctx: Ctx) => Codec = () => resolvedCtxFactory;
  // Family-extended codecs (SQL `Codec`) carry an optional `meta` field that
  // the base interface doesn't declare. Read it through a structural narrow
  // so the synthesizer forwards it to the descriptor without losing type
  // safety on the base shape.
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

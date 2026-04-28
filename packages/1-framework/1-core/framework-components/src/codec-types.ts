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
   * gate that lets the runtime'"'"'s `extractValidator` cast resolve from
   * structurally-typed (`unknown`) to a typed `JsonValidatorCodec` view.
   *
   * Codec-model-unification project, M4 cleanup F06.
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
 * (the spec'"'"'s long-term home) rather than reading the optional field off the
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
 * Sister descriptor that registers a parameterized codec with the framework.
 *
 * A parameterized codec is a curried higher-order function `(params) => (ctx) => Codec`.
 * The function is the type-level surface and the runtime implementation. The
 * descriptor carries the framework-facing metadata (id, runtime params validator,
 * optional emit-path renderer) and a reference to the factory.
 *
 * @template P - The shape of the params accepted by the factory (e.g. `{ length: number }`).
 */
export interface ParameterizedCodecDescriptor<P = Record<string, unknown>> {
  /** The codec ID this descriptor applies to (e.g. `pg/vector@1`). */
  readonly codecId: string;
  /**
   * Standard Schema validator for the factory's params. Validates JSON-sourced
   * params at the contract boundary (PSL → IR; `contract.json` → runtime).
   */
  readonly paramsSchema: StandardSchemaV1<P>;
  /**
   * Emit-path string renderer for `contract.d.ts`. Returns the TypeScript output
   * type expression for given params (e.g. `Vector<1536>`). Optional; absent
   * renderers cause the emitter to fall back to the codec's base output type.
   */
  readonly renderOutputType?: (params: P) => string;
  /** The curried higher-order codec. The descriptor's only behavior; everything else is data. */
  readonly factory: (params: P) => (ctx: Ctx) => Codec;
}

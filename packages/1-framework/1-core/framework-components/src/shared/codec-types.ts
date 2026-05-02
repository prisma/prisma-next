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
   *
   * Retirement target. The unified `CodecDescriptor` model moves
   * validation into the resolved codec's `decode` body; the parallel
   * `JsonSchemaValidatorRegistry` (and this trait alongside it) retires
   * under TML-2357 (T3.5.12). Per-library JSON extensions like
   * `@prisma-next/extension-arktype-json` already follow the new pattern.
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
 * The runtime instance carries only its `id` (the descriptor's `codecId`,
 * set by the factory) and the four conversion methods. Static metadata
 * (`traits`, `targetTypes`, `meta`) and the build-time `renderOutputType`
 * renderer live on the {@link CodecDescriptor} keyed by `codecId` — the
 * read-surface single source of truth. Consumers that need them resolve
 * through `descriptorFor(codecId)`.
 *
 * Codec methods split into two groups:
 *
 * - **Query-time** methods (`encode`, `decode`) run per row/parameter at the
 *   IO boundary; they are required and Promise-returning. The per-family
 *   codec factory accepts sync or async author functions and lifts sync
 *   ones to Promise-shaped methods automatically.
 * - **Build-time** methods (`encodeJson`, `decodeJson`) run when the
 *   contract is serialized or loaded. They stay synchronous so contract
 *   validation and client construction are synchronous.
 *
 * Target-family codec interfaces extend this base; family-specific
 * concerns (e.g. the SQL `column?` per-call context) layer on through
 * the `CodecCallContext` extension pattern.
 */
/**
 * Phantom marker symbol for the {@link Codec} `TTraits` generic. The
 * trait set is type-encoded on the codec generic so downstream helpers
 * (`CodecTraits<C>`, trait-gated operator surfaces, family extensions)
 * can thread it without the instance carrying a runtime `traits` field.
 * Runtime source of truth is {@link CodecDescriptor.traits}; the slot
 * here is `undefined` and exists only as a type-level carrier.
 */
declare const codecTraitsPhantom: unique symbol;

export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz@1`). The factory sets this to the descriptor's `codecId`; consumers use it as a back-reference for descriptor lookups and for decode-error diagnostics. */
  readonly id: Id;
  /** Phantom carrier for the `TTraits` generic; see {@link codecTraitsPhantom}. */
  readonly [codecTraitsPhantom]?: TTraits;
  /** Converts a JS value to the wire format expected by the database driver. Always Promise-returning at the boundary. The {@link CodecCallContext} is supplied by the runtime on every call (allocated once per `runtime.execute()`); family layers may narrow the ctx to extend it (e.g. SQL adds `column`). Author-side single-arg `(value) => …` functions remain legal via TypeScript's bivariance for trailing parameters. */
  encode(value: TInput, ctx: CodecCallContext): Promise<TWire>;
  /** Converts a wire value from the database driver into the JS application type. Always Promise-returning at the boundary. The {@link CodecCallContext} is supplied by the runtime on every call (allocated once per `runtime.execute()`); family layers may narrow the ctx to extend it (e.g. SQL adds `column`). Author-side single-arg `(wire) => …` functions remain legal via TypeScript's bivariance for trailing parameters. */
  decode(wire: TWire, ctx: CodecCallContext): Promise<TInput>;
  /** Converts a JS value to a JSON-safe representation for contract serialization. Synchronous; called during contract emission. */
  encodeJson(value: TInput): JsonValue;
  /** Converts a JSON representation back to the JS input type. Synchronous; called during contract loading via `validateContract`. */
  decodeJson(json: JsonValue): TInput;
}

/**
 * Codec-id-keyed read surface threaded into emit and authoring paths.
 *
 * - `get(id)` returns the runtime {@link Codec} instance for the codec
 *   id (used by `validateContract` for `decodeJson` of literal column
 *   defaults).
 * - `targetTypesFor(id)` exposes the codec-id-keyed `targetTypes`
 *   metadata the runtime instance no longer carries (TML-2357 AC-3).
 *   Returns the same array `CodecDescriptor.targetTypes` would; for
 *   Mongo (whose registration doesn't yet resolve through the unified
 *   descriptor map — TML-2324) the family-side assembly populates this
 *   directly from the contributor's codec metadata.
 * - `metaFor(id)` exposes the codec-id-keyed `meta` (e.g. SQL-side
 *   `db.sql.postgres.nativeType`) the runtime instance no longer
 *   carries.
 * - `renderOutputTypeFor(id, params)` exposes the codec-id-keyed
 *   `renderOutputType` renderer the runtime instance no longer carries.
 *   Returns `undefined` when the codec doesn't render a custom type or
 *   when the codec id is unknown.
 */
export interface CodecLookup {
  get(id: string): Codec | undefined;
  targetTypesFor(id: string): readonly string[] | undefined;
  metaFor(id: string): CodecMeta | undefined;
  renderOutputTypeFor(id: string, params: Record<string, unknown>): string | undefined;
}

export const emptyCodecLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

/**
 * Family-agnostic per-instance context supplied by the framework when
 * applying a higher-order codec factory. Allows stateful codecs (e.g.
 * column-scoped encryption) to derive per-instance state from the
 * materialization site.
 *
 * - `name` — the family-agnostic instance identity. For SQL, the runtime
 *   populates this as the `storage.types` instance name (e.g.
 *   `Embedding1536`) for typeRef-shaped columns, the synthesized
 *   anonymous instance name (`<anon:Document.embedding>`) for inline-
 *   `typeParams` columns, or a shared sentinel (`<shared:pg/text@1>`)
 *   for non-parameterized codec ids. Other families pick the analogous
 *   identity for their materialization sites.
 *
 * Family-specific extensions (e.g. {@link import('@prisma-next/sql-relational-core/ast').SqlCodecInstanceContext}
 * in the SQL layer) augment this base with domain-shaped column-set
 * metadata. Codec authors target the base when they don't read family-
 * specific metadata; they target the family extension when they do.
 */
export interface CodecInstanceContext {
  readonly name: string;
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
  readonly factory: (params: P) => (ctx: CodecInstanceContext) => Codec;
}

/**
 * Variance-erased {@link CodecDescriptor} alias. `CodecDescriptor<P>` is
 * invariant in `P` (the `factory` and `renderOutputType` slots use `P`
 * contravariantly), so `CodecDescriptor<P>` does not extend
 * `CodecDescriptor<unknown>` for specific `P`. Heterogeneous descriptor
 * collections — e.g. `SqlStaticContributions.codecs:` returning a list
 * that mixes parameterized and non-parameterized descriptors — type
 * against this alias and narrow per codec id at the consumer.
 *
 * Codec-registry-unification spec § Decision: every codec resolves
 * through one descriptor map; reads are non-branching.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure for heterogeneous descriptor collections
export type AnyCodecDescriptor = CodecDescriptor<any>;

/**
 * Standard Schema validator for `void` params. Accepts only `undefined`
 * (or absent input); rejects any other value so a contract that tries to
 * thread `typeParams` through a non-parameterized codec id fails fast at
 * the JSON boundary instead of silently coercing the value away. Used by
 * the framework-supplied non-parameterized descriptor synthesizer.
 */
export const voidParamsSchema: StandardSchemaV1<void> = {
  '~standard': {
    version: 1,
    vendor: 'prisma-next',
    validate: (input) =>
      input === undefined
        ? { value: undefined }
        : {
            issues: [
              {
                message: 'unexpected typeParams for non-parameterized codec (void params expected)',
              },
            ],
          },
  },
};

/**
 * Compose a derived {@link CodecDescriptor} from an existing base
 * descriptor by overlaying a new `codecId`, a new `targetTypes` set, and
 * optional new `meta`. The alias's `factory` delegates to the base
 * factory, then rewrites `id` on the resolved codec so per-instance
 * decode-error envelopes report the alias id.
 *
 * Replaces the legacy `aliasCodec` helper (TML-2357 T2.1) — composes at
 * the descriptor level rather than the codec-instance level so a single
 * registration slot ships the alias.
 *
 * Per-instance state on the base codec (closure-captured params,
 * derived helpers) is shared by the alias because the alias's factory
 * passes its `params` straight through to the base factory and reuses
 * the resulting codec's behavior.
 */
export function aliasDescriptor<P>(
  base: CodecDescriptor<P>,
  overrides: {
    readonly codecId: string;
    readonly targetTypes: readonly string[];
    readonly meta?: CodecMeta;
  },
): CodecDescriptor<P> {
  const factory: CodecDescriptor<P>['factory'] = (params) => (ctx) => {
    const baseCodec = base.factory(params)(ctx);
    return { ...baseCodec, id: overrides.codecId };
  };
  return {
    codecId: overrides.codecId,
    traits: base.traits,
    targetTypes: overrides.targetTypes,
    paramsSchema: base.paramsSchema,
    factory,
    ...(overrides.meta !== undefined ? { meta: overrides.meta } : {}),
    ...(base.renderOutputType !== undefined ? { renderOutputType: base.renderOutputType } : {}),
  };
}

/**
 * Construct a runtime {@link Codec} instance from the narrow runtime
 * shape — `id` plus the four conversion methods. Author `encode` /
 * `decode` as sync or async; `buildCodec` promise-lifts both onto the
 * framework-required `Promise<…>` boundary (per ADR 204) so authors
 * don't have to wrap return values themselves. `encodeJson` /
 * `decodeJson` default to identity when omitted; supply explicit
 * functions when `TInput` is not JSON-safe.
 *
 * Strictly the runtime instance shape: `buildCodec` does **not** accept
 * `targetTypes`, `traits`, `meta`, `paramsSchema`, or
 * `renderOutputType`. Codec-id-keyed metadata (and the build-time
 * renderer) belong on the {@link CodecDescriptor}; build the descriptor
 * via the family factory (`defineCodec` in SQL) when registering a
 * codec. `buildCodec` is for sites that need a raw `Codec` instance
 * — descriptor `factory` bodies that materialize a per-call codec from
 * closure-captured state, and tests that exercise the codec dispatch
 * surface against ad-hoc codecs.
 */
export function buildCodec<
  Id extends string,
  TWire = unknown,
  TInput = unknown,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
>(spec: {
  readonly id: Id;
  readonly encode: (value: TInput, ctx: CodecCallContext) => TWire | Promise<TWire>;
  readonly decode: (wire: TWire, ctx: CodecCallContext) => TInput | Promise<TInput>;
  readonly encodeJson?: (value: TInput) => JsonValue;
  readonly decodeJson?: (json: JsonValue) => TInput;
}): Codec<Id, TTraits, TWire, TInput> {
  const userEncode = spec.encode;
  const userDecode = spec.decode;
  const identity = (v: unknown) => v;
  return {
    id: spec.id,
    encode: (value, ctx) => {
      try {
        return Promise.resolve(userEncode(value, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    decode: (wire, ctx) => {
      try {
        return Promise.resolve(userDecode(wire, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    encodeJson: (spec.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (spec.decodeJson ?? identity) as (json: JsonValue) => TInput,
  } as Codec<Id, TTraits, TWire, TInput>;
}

import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecDescriptor,
  CodecInstanceContext,
  CodecTrait,
} from '@prisma-next/framework-components/codec';

export type {
  CodecCallContext,
  CodecDescriptor,
  CodecTrait,
} from '@prisma-next/framework-components/codec';

/**
 * SQL-family addressing of a single column. The decode site populates a
 * `SqlColumnRef` whenever it can resolve the cell to a single underlying
 * `(table, column)` (the typical case for projected columns from a
 * single-table source); cells the runtime cannot resolve (aggregate
 * aliases, include aggregate fields, computed projections without a
 * simple ref) get `column = undefined`.
 *
 * The shape is a structural projection of the runtime's `ColumnRef` so
 * the SQL decode site can reuse the resolution it already performs for
 * `RUNTIME.DECODE_FAILED` envelope construction without allocating
 * twice per cell.
 */
export interface SqlColumnRef {
  readonly table: string;
  readonly name: string;
}

/**
 * SQL-family per-call context. Extends the framework {@link CodecCallContext}
 * (which carries `signal` only) with `column?: SqlColumnRef`, populated
 * on **decode** call sites that can resolve a single underlying column
 * ref. Encode call sites currently leave `column` undefined (encode-time
 * column context is the middleware's domain).
 *
 * SQL codec authors writing class-form codec methods observe this type
 * via {@link SqlCodec}. The framework codec dispatch surface (and Mongo)
 * sees only the base `CodecCallContext`.
 */
export interface SqlCodecCallContext extends CodecCallContext {
  readonly column?: SqlColumnRef;
}

/**
 * SQL-family per-instance context. Extends the framework
 * {@link CodecInstanceContext} (`name` only) with `usedAt`, the set of
 * `(table, column)` pairs the resolved codec serves.
 *
 * - For `typeRef` columns sharing one named `storage.types` instance, the
 *   array lists every referencing column — a column-scoped stateful codec
 *   (e.g. encryption) can derive aggregated per-instance state across all
 *   the columns sharing the named instance.
 * - For inline-`typeParams` columns, the array has exactly one entry —
 *   the column that owns the inline params.
 * - For shared non-parameterized codecs, the array carries one
 *   representative entry (the column that triggered materialization);
 *   the codec is shared across every column with that codec id, so the
 *   `usedAt` is informational only.
 *
 * SQL extensions consuming `usedAt` (e.g. column-scoped state derivation)
 * type their factory parameter as `SqlCodecInstanceContext`. Extensions
 * that don't read `usedAt` type their factory parameter as the
 * family-agnostic {@link CodecInstanceContext} — a `SqlCodecInstanceContext`
 * is structurally assignable to the base.
 */
export interface SqlCodecInstanceContext extends CodecInstanceContext {
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}

/**
 * Codec metadata for database-specific type information.
 * Used for schema introspection and verification.
 */
export interface CodecMeta {
  readonly db?: {
    readonly sql?: {
      readonly postgres?: {
        readonly nativeType: string; // e.g. 'integer', 'text', 'vector', 'timestamp with time zone'
      };
    };
  };
}

/**
 * SQL codec — extends the framework codec base by narrowing the per-
 * call context to the SQL-family {@link SqlCodecCallContext} (adds
 * `column?: SqlColumnRef`). TypeScript treats method-syntax
 * declarations bivariantly, so the SQL narrowing is structurally
 * compatible with the framework {@link BaseCodec} super-interface.
 *
 * Codec-id-keyed static metadata (`traits`, `targetTypes`, `meta`,
 * `paramsSchema`, `renderOutputType`) lives on the unified
 * {@link import('@prisma-next/framework-components/codec').CodecDescriptor}
 * — the codec instance itself only carries `id` plus the four
 * conversion methods (TML-2357 M2 Phase B).
 *
 * See `Codec` in `@prisma-next/framework-components/codec` for the codec
 * contract that this interface extends.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> extends BaseCodec<Id, TTraits, TWire, TInput> {
  encode(value: TInput, ctx: SqlCodecCallContext): Promise<TWire>;
  decode(wire: TWire, ctx: SqlCodecCallContext): Promise<TInput>;
}

/**
 * Contract-bound codec registry.
 *
 * The dispatch interface for encode/decode at runtime: built once at
 * `ExecutionContext` construction time by walking the contract's
 * `storage.tables[].columns[]` and resolving each column to either a per-
 * instance parameterized codec (via `descriptor.factory(typeParams)(ctx)`)
 * or the shared codec instance from the legacy `CodecRegistry` (for non-
 * parameterized codecs). The dispatch path calls
 * `forColumn(table, column).encode/decode(...)` and doesn't know whether
 * the codec is parameterized.
 *
 * `forCodecId(codecId)` is a fallback for sites that don't carry the
 * `(table, column)` ref through to the encode/decode call site —
 * primarily the param-encoding path, where `ParamRef.refs` is not
 * populated by the SQL builder today (every `ParamRef` carries `codecId`
 * but not the column it relates to). For the parameterized codecs shipped
 * at Phase B, encode is per-instance-stateless (pgvector formats
 * `[v1,v2,v3]` regardless of length; JSON's `encode` is `JSON.stringify`
 * regardless of schema), so a codec-id-keyed lookup yields a structurally
 * equivalent encoder; the fallback is the bridge that lets the legacy
 * `codecs:` registration retire from the dispatch path while staying as
 * the codec-id-only source for now.
 *
 * The encode-side fallback is the AC-5-deferred carve-out documented in
 * the codec-registry-unification spec § Non-functional constraints.
 * TML-2357 retires the fallback by threading `ParamRef.refs` through
 * column-bound construction sites.
 */
export interface ContractCodecRegistry {
  /**
   * Resolve the codec for `(table, column)`. Returns the per-instance
   * parameterized codec for parameterized columns, the shared codec for
   * non-parameterized columns, or `undefined` if the column is unknown
   * or the codec isn't registered.
   */
  forColumn(table: string, column: string): Codec | undefined;

  /**
   * Resolve a codec by id. Returns the same codec instance the legacy
   * `CodecRegistry.get(codecId)` would return — for non-parameterized
   * codecs that's the shared instance; for parameterized codecs that's
   * a representative resolved instance. Used by sites that don't carry
   * `(table, column)` through to the encode/decode call site (the AC-5
   * carve-out path).
   */
  forCodecId(codecId: string): Codec | undefined;
}

/**
 * Registry interface for codecs organized by namespaced id.
 *
 * The registry allows looking up codecs by their namespaced ID. After
 * TML-2357 M0 Phase C the legacy scalar-name-keyed `byScalar` lookup
 * retired with the carrier deletion sweep — codec-id is the single
 * dispatch key (with adapter-first / packs / app-overrides registration
 * preference enforced at compose time).
 */
export interface CodecRegistry {
  get(id: string): Codec<string> | undefined;
  has(id: string): boolean;
  register(codec: Codec<string>): void;
  [Symbol.iterator](): Iterator<Codec<string>>;
  values(): IterableIterator<Codec<string>>;
}

/**
 * Create a new codec registry. Inline object literal — no class
 * implementation; the registry is just a private `Map<string, Codec>`
 * with the documented surface methods.
 */
export function newCodecRegistry(): CodecRegistry {
  const byId = new Map<string, Codec<string>>();
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    register: (codec) => {
      if (byId.has(codec.id)) {
        throw new Error(`Codec with ID '${codec.id}' is already registered`);
      }
      byId.set(codec.id, codec);
    },
    values: () => byId.values(),
    [Symbol.iterator]: function* () {
      yield* byId.values();
    },
  };
}

/**
 * Variance-erased descriptor type used for heterogeneous storage in
 * collection containers and on the unified contributor `codecs:` slot.
 * The descriptor's `factory` and `renderOutputType` are contravariant
 * in `P`, so descriptors with different params shapes are not in a
 * subtype relationship; collecting them into one container needs an
 * explicit variance erasure rather than `CodecDescriptor<unknown>`
 * (which is the narrowest, not the widest, of the family).
 */
// biome-ignore lint/suspicious/noExplicitAny: descriptor variance erasure — `P` is contravariant on the factory and renderOutputType slots, so heterogeneous descriptor storage cannot use `unknown`.
export type AnyCodecDescriptor = CodecDescriptor<any>;

type DescriptorResolvedCodec<D> =
  D extends CodecDescriptor<infer _P> ? ReturnType<ReturnType<D['factory']>> : never;

export type DescriptorCodecId<D> = D extends AnyCodecDescriptor ? D['codecId'] : never;

export type DescriptorCodecInput<D> =
  DescriptorResolvedCodec<D> extends BaseCodec<string, readonly CodecTrait[], unknown, infer In>
    ? In
    : never;

export type DescriptorCodecTraits<D> =
  DescriptorResolvedCodec<D> extends BaseCodec<string, infer TTraits, unknown, unknown>
    ? TTraits[number] & CodecTrait
    : never;

/**
 * Project a record of {@link AnyCodecDescriptor}s keyed by scalar name
 * onto the codec-id-keyed `CodecTypes` shape consumed by emit and no-
 * emit type pipelines (`{ readonly [codecId]: { input; output; traits } }`).
 *
 * After the TML-2357 M0 Phase C deletion sweep this is the canonical
 * extractor — the legacy instance-keyed `ExtractCodecTypes` (and its
 * `mkCodec`-bound builder) retired alongside the carrier deletion.
 */
export type ExtractCodecTypes<
  ScalarNames extends {
    readonly [K in keyof ScalarNames]: AnyCodecDescriptor;
  } = Record<never, never>,
> = {
  readonly [K in keyof ScalarNames as DescriptorCodecId<ScalarNames[K]>]: {
    readonly input: DescriptorCodecInput<ScalarNames[K]>;
    readonly output: DescriptorCodecInput<ScalarNames[K]>;
    readonly traits: DescriptorCodecTraits<ScalarNames[K]>;
  };
};

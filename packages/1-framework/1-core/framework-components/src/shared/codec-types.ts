import type { JsonValue } from '@prisma-next/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Codec } from './codec';

export type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';

/**
 * Serializable codec identity carried by every codec-bearing AST node.
 *
 * `(codecId, typeParams?)` is the single fact the runtime needs to materialize a codec via `descriptorFor(codecId).factory(typeParams)(ctx)`. The pair is content-keyed: two refs with the same `codecId` and structurally equal `typeParams` (regardless of object key ordering) resolve to the same memoized {@link Codec} instance.
 *
 * `typeParams` is `JsonValue`-constrained so the ref survives JSON serialization (relevant for AST-embedded migration ops). Non-parameterized codecs leave `typeParams` undefined; the descriptor's `paramsSchema` validates the value at the JSON boundary.
 *
 * `many` marks a scalar-array (list-typed) column. When `true`, the encode/decode paths map the element codec over the JS array rather than applying the codec to the whole value. The element codec id is `codecId`; the driver owns the array wire framing (`{…}`) in both directions. Absent for scalar columns.
 *
 * Family-agnostic by design — both SQL and Mongo AST nodes carry `codec: CodecRef | undefined`, and the resolver is the only dispatch path that survives serialization.
 */
export interface CodecRef {
  readonly codecId: string;
  readonly typeParams?: JsonValue;
  readonly many?: boolean;
}

/**
 * Per-call context the runtime threads to every `codec.encode` / `codec.decode` invocation for a single `runtime.execute()` call.
 *
 * The framework-level shape is family-agnostic and carries one field:
 *
 * - `signal?: AbortSignal` — per-query cancellation. The runtime returns a `RUNTIME.ABORTED` envelope when the signal aborts; codec authors who forward `signal` to their underlying SDK get true cancellation of in-flight network calls.
 *
 * Family layers extend this base with their own shape-of-call metadata: the SQL family adds `column?: SqlColumnRef` via `SqlCodecCallContext` (see `@prisma-next/sql-relational-core`). Mongo currently uses this framework type unchanged. Column metadata is intentionally **not** on the framework type — it is a SQL-family concept rooted in SQL's `(table, column)` addressing model and would not generalise to other families.
 *
 * The interface is named explicitly (not inlined) so future framework fields and family extensions can land additively without breaking codec author signatures.
 */
export interface CodecCallContext {
  readonly signal?: AbortSignal;
}

/**
 * Codec-id-keyed read surface threaded into emit and authoring paths.
 *
 * - `get(id)` returns a representative {@link Codec} instance for the codec id (used by `family.deserializeContract` for `decodeJson` of literal column defaults). For parameterized codecs whose factory requires concrete params, this may return `undefined` — use `CodecRegistry.forCodecRef` instead.
 * - `targetTypesFor(id)` exposes the codec-id-keyed `targetTypes` metadata the runtime instance no longer carries (TML-2357). Returns the same array `CodecDescriptor.targetTypes` would; for Mongo (whose registration doesn't yet resolve through the unified descriptor map — TML-2324) the family-side assembly populates this directly from the contributor's codec metadata.
 * - `metaFor(id, typeParams)` exposes the codec-id-keyed `meta` (e.g. SQL-side `db.sql.postgres.nativeType`) the runtime instance no longer carries. `typeParams` is optional: when given and the codec descriptor implements a params-aware `metaFor`, the descriptor computes its meta from those params (e.g. a native enum's per-instance Postgres type name); otherwise (or when `typeParams` is omitted) the codec's static `meta` is returned.
 * - `renderOutputTypeFor(id, params)` exposes the codec-id-keyed `renderOutputType` renderer the runtime instance no longer carries. Returns `undefined` when the codec doesn't render a custom type or when the codec id is unknown.
 */
export interface CodecLookup {
  get(id: string): Codec | undefined;
  targetTypesFor(id: string): readonly string[] | undefined;
  metaFor(id: string, typeParams?: Record<string, unknown> | JsonValue): CodecMeta | undefined;
  renderOutputTypeFor(id: string, params: Record<string, unknown>): string | undefined;
  /** Codec-id-keyed `renderInputType` renderer for the `contract.d.ts` input position. Optional so existing lookups need not provide it; returns `undefined` when the codec renders no custom input type or the id is unknown. */
  renderInputTypeFor?(id: string, params: Record<string, unknown>): string | undefined;
  /** Codec-id-keyed `renderValueLiteral` renderer for the emit path (`side`: `output` = read type, `input` = create/update type). Optional so existing lookups need not provide it; returns `undefined` when the codec's output isn't literal-expressible or the id is unknown. */
  renderValueLiteralFor?(
    id: string,
    value: JsonValue,
    side: 'output' | 'input',
  ): string | undefined;
}

/**
 * Full codec registry — the read surface of {@link CodecLookup} plus codec resolution by ref or
 * column coordinate. Built once by `extractCodecLookup` and passed by reference to adapters and
 * other consumers that need to materialise codecs at runtime.
 *
 * - `forCodecRef(ref)` materialises a codec from a {@link CodecRef}. Throws
 *   `RUNTIME.CODEC_DESCRIPTOR_MISSING` for unknown ids and `RUNTIME.TYPE_PARAMS_INVALID` on param
 *   schema rejection.
 * - `forColumn(namespaceId, table, column)` returns the codec for a specific column coordinate, or
 *   `undefined` when no column-to-codec mapping is present. This registry is contract-free so it
 *   always returns `undefined` — the method exists so the object structurally satisfies the SQL
 *   `ContractCodecRegistry` interface.
 */
export interface CodecRegistry extends CodecLookup {
  forCodecRef(ref: CodecRef): Codec;
  forColumn(namespaceId: string, table: string, column: string): Codec | undefined;
}

export const emptyCodecLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

/**
 * Family-agnostic per-instance context supplied by the framework when applying a higher-order codec factory. Allows stateful codecs (e.g. column-scoped encryption) to derive per-instance state from the materialization site.
 *
 * - `name` — the family-agnostic instance identity. For SQL, the runtime populates this as the `storage.types` instance name (e.g. `Embedding1536`) for typeRef-shaped columns, an inline-column sentinel (`<col:Document.embedding>`) for inline-`typeParams` columns, a shared codec-id sentinel (`<codec:pg/text@1>`) for non-parameterized codec ids, or the canonical cache key (`<codecId>:<canonicalizeJson(typeParams)>`) for ad-hoc refs the contract walk did not pre-populate. Other families pick the analogous identity for their materialization sites.
 *
 * Family-specific extensions (e.g. {@link import('@prisma-next/sql-relational-core/ast').SqlCodecInstanceContext} in the SQL layer) augment this base with domain-shaped column-set metadata. Codec authors target the base when they don't read family-specific metadata; they target the family extension when they do.
 */
export interface CodecInstanceContext {
  readonly name: string;
}

/**
 * Family-agnostic codec metadata. Family-specific extensions augment the base `db.<family>.<target>` block with native-type information; the base shape is an empty object so non-relational codecs can carry no metadata.
 */
export interface CodecMeta {
  readonly db?: Record<string, unknown>;
}

/**
 * Standard Schema validator for `void` params. Accepts only `undefined` (or absent input); rejects any other value so a contract that tries to thread `typeParams` through a non-parameterized codec id fails fast at the JSON boundary instead of silently coercing the value away. Used by the framework-supplied non-parameterized descriptor synthesizer.
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

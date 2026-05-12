/**
 * Operation type definitions for the cipherstash extension.
 *
 * Mirrors `packages/3-extensions/pgvector/src/types/operation-types.ts`
 * — the type-only counterpart to `cipherstashQueryOperations()` in
 * `../execution/operators.ts`. Every entry's `self` dispatch shape
 * mirrors the runtime registration 1:1:
 *
 *   - Single-codec entries (`cipherstashEq`, `cipherstashIlike`,
 *     `cipherstashNotIlike`, `cipherstashJsonbPathExists`) declare
 *     `self: { codecId: '<id>' }`. The framework's `OpMatchesField`
 *     direct-codec-id branch surfaces the method on columns whose
 *     codec id is the literal — no consumer-side `CodecTypes`
 *     augmentation needed.
 *
 *   - Multi-codec entries (the equality / order-and-range operators)
 *     declare `self: { traits: ['cipherstash:<x>'] }`. Trait dispatch
 *     surfaces the method on every column whose codec id resolves to
 *     a `CodecTypes` entry whose `traits` set includes the same
 *     identifier. The cipherstash-namespaced `cipherstash:` prefix
 *     isolates these from the framework's closed `CodecTrait` union
 *     so adding the trait to a cipherstash codec descriptor cannot
 *     silently re-attach a framework built-in.
 *
 * Both surfaces (codec-keyed `OperationTypes` and flat
 * `QueryOperationTypes`) get composed into the consuming
 * application's generated `contract.d.ts` by the contract emitter,
 * via the `types.queryOperationTypes` import declaration on
 * `cipherstashPackMeta` (`../extension-metadata/descriptor-meta.ts`).
 *
 * Return-codec id is `pg/bool@1` for every predicate operator —
 * pinned to what the runtime impl builds (`../execution/operators.ts`
 * `PG_BOOL_CODEC_ID`). The framework's predicate machinery looks at
 * the return codec's `'boolean'` trait to decide a value is suitable
 * for a WHERE clause.
 */

import type { CodecExpression, Expression } from '@prisma-next/sql-relational-core/expression';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const CIPHERSTASH_STRING_CODEC = 'cipherstash/string@1';
type CipherstashStringCodec = typeof CIPHERSTASH_STRING_CODEC;

type PgBoolReturn = Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

/**
 * Trait tuples used to gate multi-codec operators (see ADR 214).
 *
 * Cipherstash uses extension-namespaced trait identifiers
 * (`cipherstash:equality`, `cipherstash:order-and-range`) that
 * intentionally live outside the framework's closed `CodecTrait`
 * union. Preserving the literal trait strings at the type level is
 * load-bearing: the consuming `OpMatchesField` predicate (in
 * `packages/3-extensions/sql-orm-client/src/types.ts`) reads
 * `Self.traits` and tests
 * `[traits[number]] extends [CT[CodecId]['traits']]`, so widening to
 * the framework's closed `CodecTrait` union (or to `never[]` via
 * intersection) erases the extension's dispatch information and
 * collapses every codec into a trait match.
 *
 * The framework's `QueryOperationSelfSpec` types `traits` as
 * `readonly CodecTrait[]`; cipherstash's `QueryOperationTypes`
 * therefore declares its entries directly (rather than via the
 * `SqlQueryOperationTypes<CT, T>` wrapper that constrains
 * `T extends Record<string, QueryOperationTypeEntry>`) so the
 * literal trait strings flow through untouched. The consumer-side
 * pipeline (`ExtractQueryOperationTypes` -> `OpMatchesField`) walks
 * the entries structurally and accepts any `traits` shape
 * extending `readonly string[]`. AGENTS.md requires the rationale
 * comment alongside any non-standard surface; this is the type-only
 * twin of `extension-metadata/constants.ts:CIPHERSTASH_CODEC_TRAITS`,
 * which carries the runtime-side rationale for the same pattern.
 */
type EqualityTraits = readonly ['cipherstash:equality'];
type OrderAndRangeTraits = readonly ['cipherstash:order-and-range'];
type FreeTextSearchTraits = readonly ['cipherstash:free-text-search'];
type SearchableJsonTraits = readonly ['cipherstash:searchable-json'];

/**
 * Schematic constraint on `self` for a multi-codec cipherstash
 * predicate. The runtime impl reads `self.returnType.codecId` and
 * dispatches to the matching `Encrypted*` envelope — accepting any
 * `Expression` here is correct because the surface is column-method
 * autocomplete, not a free-standing helper. The framework's
 * `OpMatchesField` is what restricts visibility to codecs declaring
 * the gating trait; this `self` argument type is irrelevant to that
 * dispatch.
 */
type AnyExpressionLike = Expression<{ readonly codecId: string; readonly nullable: boolean }>;

/**
 * Flat operation signatures consumed by the SQL query builder. Read
 * via the `queryOperations` slot on the runtime context to project
 * the cipherstash predicate methods onto cipherstash column accessors
 * inside `model.where(...)` / `sql(t).where(...)` callbacks.
 *
 * Every operator's runtime impl (`../execution/operators.ts`) wraps
 * the user-supplied argument(s) in the appropriate `Encrypted*`
 * envelope at lowering time and stamps the column's `(table, column)`
 * routing context, then lowers to the canonical EQL function call.
 *
 * The user-facing argument type is intentionally permissive
 * (`unknown` for multi-codec ops, `pg/text@1` for the legacy
 * single-codec ops). The cipherstash extension does not ship a
 * `codec-types` augmentation declaring `input` / `output` shapes for
 * the cipherstash codec ids, so the symmetric encrypted-codec-typed
 * `other` shape pgvector uses for its `cosineDistance` arg would only
 * accept full `Expression` values, not raw plaintext literals. The
 * asymmetry mirrors the runtime: the column `self` is the encrypted
 * column; the comparand is plaintext the operator encrypts on the
 * user's behalf.
 */
export type QueryOperationTypes<CT extends CodecTypesBase> = CT extends CodecTypesBase
  ? {
      readonly cipherstashEq: {
        readonly self: { readonly codecId: CipherstashStringCodec };
        readonly impl: (
          self: CodecExpression<CipherstashStringCodec, boolean, CT>,
          other: CodecExpression<'pg/text@1', boolean, CT>,
        ) => PgBoolReturn;
      };
      readonly cipherstashIlike: {
        readonly self: { readonly codecId: CipherstashStringCodec };
        readonly impl: (
          self: CodecExpression<CipherstashStringCodec, boolean, CT>,
          pattern: CodecExpression<'pg/text@1', boolean, CT>,
        ) => PgBoolReturn;
      };
      readonly cipherstashNotIlike: {
        readonly self: { readonly traits: FreeTextSearchTraits };
        readonly impl: (self: AnyExpressionLike, pattern: string) => PgBoolReturn;
      };
      readonly cipherstashNe: {
        readonly self: { readonly traits: EqualityTraits };
        readonly impl: (self: AnyExpressionLike, other: unknown) => PgBoolReturn;
      };
      readonly cipherstashInArray: {
        readonly self: { readonly traits: EqualityTraits };
        readonly impl: (self: AnyExpressionLike, values: readonly unknown[]) => PgBoolReturn;
      };
      readonly cipherstashNotInArray: {
        readonly self: { readonly traits: EqualityTraits };
        readonly impl: (self: AnyExpressionLike, values: readonly unknown[]) => PgBoolReturn;
      };
      readonly cipherstashGt: {
        readonly self: { readonly traits: OrderAndRangeTraits };
        readonly impl: (self: AnyExpressionLike, other: unknown) => PgBoolReturn;
      };
      readonly cipherstashGte: {
        readonly self: { readonly traits: OrderAndRangeTraits };
        readonly impl: (self: AnyExpressionLike, other: unknown) => PgBoolReturn;
      };
      readonly cipherstashLt: {
        readonly self: { readonly traits: OrderAndRangeTraits };
        readonly impl: (self: AnyExpressionLike, other: unknown) => PgBoolReturn;
      };
      readonly cipherstashLte: {
        readonly self: { readonly traits: OrderAndRangeTraits };
        readonly impl: (self: AnyExpressionLike, other: unknown) => PgBoolReturn;
      };
      readonly cipherstashBetween: {
        readonly self: { readonly traits: OrderAndRangeTraits };
        readonly impl: (self: AnyExpressionLike, low: unknown, high: unknown) => PgBoolReturn;
      };
      readonly cipherstashNotBetween: {
        readonly self: { readonly traits: OrderAndRangeTraits };
        readonly impl: (self: AnyExpressionLike, low: unknown, high: unknown) => PgBoolReturn;
      };
      readonly cipherstashJsonbPathExists: {
        readonly self: { readonly traits: SearchableJsonTraits };
        readonly impl: (self: AnyExpressionLike, path: string) => PgBoolReturn;
      };
    }
  : never;

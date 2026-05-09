/**
 * Operation type definitions for the cipherstash extension.
 *
 * Mirrors `packages/3-extensions/pgvector/src/types/operation-types.ts` —
 * the type-only counterpart to `cipherstashQueryOperations()` in
 * `../core/operators.ts`. Where pgvector projects `cosineDistance` /
 * `cosineSimilarity` onto `pg/vector@1` columns, cipherstash projects
 * `cipherstashEq` / `cipherstashIlike` onto `cipherstash/string@1`
 * columns.
 *
 * Both surfaces (codec-keyed `OperationTypes` and flat
 * `QueryOperationTypes`) get composed into the consuming application's
 * generated `contract.d.ts` by the contract emitter, via the
 * `types.operationTypes` / `types.queryOperationTypes` import
 * declarations on the cipherstash pack-meta (`../core/descriptor-meta.ts`).
 *
 * Return-codec id is `pg/bool@1` — pinned to what `eqlOperator` actually
 * builds at runtime (`../core/operators.ts:170-183`, `PG_BOOL_CODEC_ID`
 * constant). Both operators are non-nullable predicates suitable for a
 * WHERE clause.
 */

import type { SqlQueryOperationTypes } from '@prisma-next/sql-contract/types';
import type { CodecExpression, Expression } from '@prisma-next/sql-relational-core/expression';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const CIPHERSTASH_STRING_CODEC = 'cipherstash/string@1';
type CipherstashStringCodec = typeof CIPHERSTASH_STRING_CODEC;

/**
 * Codec-keyed operation surface. Read by the model-accessor type
 * machinery to attach `cipherstashEq` / `cipherstashIlike` onto the
 * `where(...)` filter object for `cipherstash/string@1`-typed fields
 * (e.g. `db.user.findMany({ where: { email: { cipherstashEq: 'x' } } })`).
 */
export type OperationTypes = {
  readonly 'cipherstash/string@1': {
    readonly cipherstashEq: {
      readonly self: { readonly codecId: CipherstashStringCodec };
    };
    readonly cipherstashIlike: {
      readonly self: { readonly codecId: CipherstashStringCodec };
    };
  };
};

/**
 * Flat operation signatures consumed by the SQL query builder. Read
 * via the `queryOperations` slot on the runtime context to project
 * `t.email.cipherstashEq(...)` onto `cipherstash/string@1` column
 * accessors inside `sql(t).where(...)` callbacks.
 *
 * Both operators take an encrypted-string `self` and a plaintext-or-
 * envelope `other`/`pattern`; the runtime implementation
 * (`eqlOperator` in `../core/operators.ts`) wraps the user-supplied
 * second argument in an `EncryptedString` envelope, stamps the
 * column's routing context, and lowers to `eql_v2.eq` / `eql_v2.ilike`.
 *
 * Return type is the postgres `pg/bool@1` codec — that's the codec
 * the framework's predicate machinery looks at via the `'boolean'`
 * trait to decide a value is suitable for a WHERE clause.
 */
export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly cipherstashEq: {
      readonly self: { readonly codecId: CipherstashStringCodec };
      readonly impl: (
        self: CodecExpression<CipherstashStringCodec, boolean, CT>,
        other: CodecExpression<CipherstashStringCodec, boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly cipherstashIlike: {
      readonly self: { readonly codecId: CipherstashStringCodec };
      readonly impl: (
        self: CodecExpression<CipherstashStringCodec, boolean, CT>,
        // ILIKE pattern is a plain SQL pattern (`%x%`) the runtime wraps
        // in an `EncryptedString` envelope at lowering time. Typed as
        // `pg/text@1` (not `cipherstash/string@1`) so callers can pass
        // a plain string literal; this matches the design doc and the
        // user-visible call shape (`cipherstashIlike('%@example.com')`).
        pattern: CodecExpression<'pg/text@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
  }
>;

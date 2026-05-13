/**
 * Cipherstash free-standing helpers — the non-predicate side of the
 * cipherstash operator surface (see ADR 214).
 *
 * Predicates (`cipherstashEq`, `cipherstashGt`, …) live in the
 * operator registry and surface as column methods through trait-
 * dispatched `QueryOperationTypes`. Non-predicates (sort, JSON
 * SELECT-expression accessors) cannot share that surface — they
 * return `OrderByItem` / column-codec-typed `Expression`, not the
 * boolean predicate the registry's where-binding pipeline expects.
 *
 * The four helpers below are pure functions exported from
 * `@prisma-next/extension-cipherstash/runtime`. Each:
 *
 *   - validates the column's codec id is a cipherstash codec the
 *     helper supports (sort: any of the four
 *     `cipherstash:order-and-range`-bearing codecs;
 *     JSON helpers: `cipherstash/json@1` only)
 *   - constructs the appropriate AST primitive directly:
 *       sort  → `OrderByItem.asc/desc(<column-ref>)`
 *       JSON  → `Expression`-shaped `OperationExpr` with the EQL
 *               function template baked into `lowering.template`
 *   - throws a descriptive `TypeError` naming the helper and the
 *     accepted codec ids on a mismatch
 *
 * # Sort lowering — bare column reference
 *
 * `cipherstashAsc(col)` lowers to `ORDER BY <col> ASC` with no EQL
 * function wrapping. EQL ships native `<` / `>` / `<=` / `>=` operator
 * overloads on `eql_v2_encrypted` (see `eql_v2."<"(eql_v2_encrypted,
 * eql_v2_encrypted)` and the `CREATE OPERATOR <(LEFTARG=eql_v2_encrypted,
 * RIGHTARG=eql_v2_encrypted, …)` definition in the bundled EQL
 * install) so Postgres uses the EQL operator family for the sort
 * comparison. The wrapped form (`eql_v2.order_by_<index>(col)`) is
 * the documented fallback if the bare-column form ever stops working
 * against a future EQL bundle.
 *
 * # JSON helpers — Expression-typed OperationExpr
 *
 * `cipherstashJsonbPathQueryFirst(col, path)` lowers to
 *   `eql_v2.jsonb_path_query_first({{self}}, {{arg0}})`
 * `cipherstashJsonbGet(col, path)` lowers to
 *   `eql_v2."->"({{self}}, {{arg0}})`
 *
 * Both return `eql_v2_encrypted` and so are typed
 * `Expression<{codecId: 'cipherstash/json@1', nullable: false}>` —
 * the result is itself a JSON-encrypted value usable as the column
 * argument to a follow-on JSON helper or predicate. The path is a
 * user-authored static literal (a JSONpath expression or a JSON key
 * string) and is bound as a `pg/text@1` `ParamRef`. Dynamic
 * user-controlled runtime path values are not supported here — paths
 * must be statically authored to keep the JSONpath surface free of
 * injection-shaped input.
 *
 * # No registry participation
 *
 * These are not registered operators. They're called by the user
 * directly (e.g. `db.query(...).orderBy([cipherstashAsc(col)])`) and
 * are typed at their function-declaration site. There is no
 * `QueryOperationTypes` entry and no operator-registry
 * descriptor — the helpers do not flow through the column-method
 * dispatch that the predicate operators rely on.
 */

import { type AnyExpression, OrderByItem, ParamRef } from '@prisma-next/sql-relational-core/ast';
import {
  buildOperation,
  type Expression,
  type ScopeField,
} from '@prisma-next/sql-relational-core/expression';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../extension-metadata/constants';

/** Cipherstash codec ids that carry the `cipherstash:order-and-range` trait. */
const ORDER_AND_RANGE_CODEC_IDS = [
  CIPHERSTASH_STRING_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
] as const;

const ORDER_AND_RANGE_SET: ReadonlySet<string> = new Set(ORDER_AND_RANGE_CODEC_IDS);

type CipherstashJsonReturn = {
  readonly codecId: typeof CIPHERSTASH_JSON_CODEC_ID;
  readonly nullable: false;
};

function getCodecId(col: Expression<ScopeField>, helperName: string): string {
  const codecId = col.returnType?.codecId;
  if (typeof codecId !== 'string') {
    throw new TypeError(
      `${helperName}: argument is missing a codec id; expected an Expression bound to a cipherstash column.`,
    );
  }
  return codecId;
}

function describeOrderAndRangeCodecs(): string {
  return ORDER_AND_RANGE_CODEC_IDS.join(', ');
}

/**
 * ASC sort over a cipherstash column whose codec carries the
 * `cipherstash:order-and-range` trait (string / double / bigint /
 * date). Returns an `OrderByItem` carrying the column reference;
 * Postgres uses EQL's `<` / `>` operator overloads on
 * `eql_v2_encrypted` to compute the sort.
 */
export function cipherstashAsc(col: Expression<ScopeField>): OrderByItem {
  const codecId = getCodecId(col, 'cipherstashAsc');
  if (!ORDER_AND_RANGE_SET.has(codecId)) {
    throw new TypeError(
      `cipherstashAsc: column codec id "${codecId}" does not support order-and-range sort; ` +
        `cipherstashAsc accepts cipherstash columns whose codec id is one of: ${describeOrderAndRangeCodecs()}.`,
    );
  }
  return OrderByItem.asc(col.buildAst());
}

/**
 * DESC sort over a cipherstash column whose codec carries the
 * `cipherstash:order-and-range` trait. See {@link cipherstashAsc}
 * for the lowering rationale.
 */
export function cipherstashDesc(col: Expression<ScopeField>): OrderByItem {
  const codecId = getCodecId(col, 'cipherstashDesc');
  if (!ORDER_AND_RANGE_SET.has(codecId)) {
    throw new TypeError(
      `cipherstashDesc: column codec id "${codecId}" does not support order-and-range sort; ` +
        `cipherstashDesc accepts cipherstash columns whose codec id is one of: ${describeOrderAndRangeCodecs()}.`,
    );
  }
  return OrderByItem.desc(col.buildAst());
}

function requireJsonColumn(col: Expression<ScopeField>, helperName: string): AnyExpression {
  const codecId = getCodecId(col, helperName);
  if (codecId !== CIPHERSTASH_JSON_CODEC_ID) {
    throw new TypeError(
      `${helperName}: column codec id "${codecId}" is not "${CIPHERSTASH_JSON_CODEC_ID}"; ` +
        `${helperName} only accepts cipherstash JSON columns.`,
    );
  }
  return col.buildAst();
}

function requirePathString(path: unknown, helperName: string): string {
  if (typeof path !== 'string') {
    throw new TypeError(
      `${helperName}: expected a string path argument, got ${
        path === null ? 'null' : typeof path
      }.`,
    );
  }
  return path;
}

/**
 * Lower to `eql_v2.jsonb_path_query_first({{self}}, {{arg0}})`. The
 * column must be `cipherstash/json@1`. The path is a user-authored
 * static JSONpath literal; it is bound as a `pg/text@1` `ParamRef`.
 *
 * The result is `eql_v2_encrypted` and can be passed as the column
 * argument to a follow-on cipherstash JSON helper or
 * `cipherstashJsonbPathExists` predicate (a column codec is not
 * required at the type level for those — the runtime branch checks
 * the trait/codec at impl time).
 */
export function cipherstashJsonbPathQueryFirst(
  col: Expression<ScopeField>,
  path: string,
): Expression<CipherstashJsonReturn> {
  const selfAst = requireJsonColumn(col, 'cipherstashJsonbPathQueryFirst');
  const checked = requirePathString(path, 'cipherstashJsonbPathQueryFirst');
  return buildOperation({
    method: 'cipherstashJsonbPathQueryFirst',
    args: [selfAst, ParamRef.of(checked, { codec: { codecId: 'pg/text@1' } })],
    returns: { codecId: CIPHERSTASH_JSON_CODEC_ID, nullable: false },
    lowering: {
      targetFamily: 'sql',
      strategy: 'function',
      template: 'eql_v2.jsonb_path_query_first({{self}}, {{arg0}})',
    },
  });
}

/**
 * Lower to `eql_v2."->"({{self}}, {{arg0}})`. The column must be
 * `cipherstash/json@1`. The path is a JSON key string (the right
 * argument of the `->` operator); it is bound as a `pg/text@1`
 * `ParamRef` against EQL's `(eql_v2_encrypted, text)` overload.
 *
 * The result is `eql_v2_encrypted`, mirroring
 * {@link cipherstashJsonbPathQueryFirst}.
 *
 * The exported function name preserves the `Get` suffix convention
 * (vs the SQL `->` operator) so the JS surface stays identifier-
 * friendly; the lowering still emits the quoted operator-as-function
 * form.
 */
export function cipherstashJsonbGet(
  col: Expression<ScopeField>,
  path: string,
): Expression<CipherstashJsonReturn> {
  const selfAst = requireJsonColumn(col, 'cipherstashJsonbGet');
  const checked = requirePathString(path, 'cipherstashJsonbGet');
  return buildOperation({
    method: 'cipherstashJsonbGet',
    args: [selfAst, ParamRef.of(checked, { codec: { codecId: 'pg/text@1' } })],
    returns: { codecId: CIPHERSTASH_JSON_CODEC_ID, nullable: false },
    lowering: {
      targetFamily: 'sql',
      strategy: 'function',
      template: 'eql_v2."->"({{self}}, {{arg0}})',
    },
  });
}

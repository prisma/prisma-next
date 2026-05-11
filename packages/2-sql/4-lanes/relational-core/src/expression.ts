import type { ParamSpec } from '@prisma-next/operations';
import type { QueryOperationReturn } from '@prisma-next/sql-contract/types';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';
import type { AnyExpression as AstExpression } from './ast/types';
import { OperationExpr, ParamRef } from './ast/types';

export type ScopeField = { codecId: string; nullable: boolean };

/**
 * A typed SQL expression. Identity is carried by the `returnType` descriptor (inherited from `QueryOperationReturn` and narrowed to `T`) — distinct `T` makes distinct Expression types structurally. `buildAst()` materialises the underlying AST node.
 */
export type Expression<T extends ScopeField> = QueryOperationReturn & {
  readonly returnType: T;
  buildAst(): AstExpression;
};

type CodecIdsWithTrait<
  CT extends Record<string, { readonly input: unknown }>,
  RequiredTraits extends readonly string[],
> = {
  [K in keyof CT & string]: CT[K] extends { readonly traits: infer T }
    ? [RequiredTraits[number]] extends [T]
      ? K
      : never
    : never;
}[keyof CT & string];

type NullSuffix<N> = N extends true ? null : never;

/**
 * An expression or literal value targeting a specific codec.
 *
 * Accepts any of:
 * - An `Expression` whose codec matches exactly
 * - A raw JS value of the codec's `input` type
 * - `null` when `Nullable` is true
 */
export type CodecExpression<
  CodecId extends string,
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> =
  | Expression<{ codecId: CodecId; nullable: Nullable }>
  | (CodecId extends keyof CT ? CT[CodecId]['input'] : never)
  | NullSuffix<Nullable>;

/**
 * An expression or literal value targeting any codec whose trait set contains all the required traits.
 *
 * Resolves the trait set to the union of matching codec identities via `CodecIdsWithTrait`, then reuses `CodecExpression` for the codec-id form.
 */
export type TraitExpression<
  Traits extends readonly string[],
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> = CodecExpression<CodecIdsWithTrait<CT, Traits>, Nullable, CT>;

/**
 * Resolve a raw value or an Expression into an AST expression node.
 *
 * When `value` is an Expression (duck-typed by its `buildAst` method), the AST it wraps is returned. Otherwise the value is embedded as a ParamRef tagged with `codecId` (if given) and optionally `refs: { table, column }` (if the caller knows the column-bound site).
 *
 * For parameterized codec ids (e.g. `pg/vector@1`), encode-side dispatch requires `refs` to select the per-instance codec — so operation implementations that compare a column to a user-supplied value should derive `refs` from the column-bound side and pass it down. Non-parameterized codec ids (e.g. `pg/int4@1`) tolerate refs-less ParamRefs; the validator pass enforces refs only for parameterized ids.
 */
export function toExpr(
  value: unknown,
  codecId?: string,
  refs?: { table: string; column: string },
): AstExpression {
  if (isExpressionLike(value)) {
    return value.buildAst();
  }
  if (codecId === undefined && refs === undefined) return ParamRef.of(value);
  return ParamRef.of(value, {
    ...(codecId !== undefined ? { codecId } : {}),
    ...(refs !== undefined ? { refs } : {}),
  });
}

/**
 * Derive `(table, column)` refs from an expression-like value when it carries column-bound metadata. Returns `undefined` for non-column-bound expressions and for raw scalar values.
 *
 * Two sources are consulted, in order: 1. An optional `refs` slot on the `Expression` wrapper (the SQL builder's `ExpressionImpl` records `(table, column)` for top-level fields whose AST is `IdentifierRef` — the AST stays bare to preserve SQL rendering, the metadata lives on the wrapper). 2. The wrapped AST when it's already a `ColumnRef` (the namespaced field-proxy form, or operation impls passing column-bound exprs
 * directly).
 *
 * Operation implementations call this on the column-bound side of a comparison and forward the refs to {@link toExpr} on the user-value side, so the resulting `ParamRef` carries the table+column required by encode-side `forColumn` dispatch.
 */
export function refsOf(value: unknown): { table: string; column: string } | undefined {
  if (!isExpressionLike(value)) return undefined;
  const wrapperRefs = (value as { refs?: { table: string; column: string } }).refs;
  if (wrapperRefs) return { table: wrapperRefs.table, column: wrapperRefs.column };
  const ast = value.buildAst();
  if (ast.kind === 'column-ref') {
    return { table: ast.table, column: ast.column };
  }
  return undefined;
}

function isExpressionLike(value: unknown): value is Expression<ScopeField> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof (value as { buildAst: unknown }).buildAst === 'function'
  );
}

export interface BuildOperationSpec<R extends ScopeField> {
  readonly method: string;
  /**
   * The operation's arguments. The first element is the self argument (the value the operation is being applied to); the rest are the remaining user-supplied arguments.
   */
  readonly args: readonly [AstExpression, ...AstExpression[]];
  readonly returns: R & ParamSpec;
  readonly lowering: SqlLoweringSpec;
}

/**
 * Construct an OperationExpr AST node and wrap it as a typed Expression. Operation implementations use this to turn their user-facing arguments into the AST node the compilation pipeline eventually lowers to SQL.
 */
export function buildOperation<R extends ScopeField>(spec: BuildOperationSpec<R>): Expression<R> {
  const [self, ...rest] = spec.args;
  const op = new OperationExpr({
    method: spec.method,
    self,
    args: rest.length > 0 ? rest : undefined,
    returns: spec.returns,
    lowering: spec.lowering,
  });
  return {
    returnType: spec.returns,
    buildAst: () => op,
  };
}

import type { ParamSpec } from '@prisma-next/operations';
import type { QueryOperationReturn } from '@prisma-next/sql-contract/types';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';
import type { AnyExpression as AstExpression } from './ast/types';
import { OperationExpr, ParamRef } from './ast/types';

export type ScopeField = { codecId: string; nullable: boolean };

/**
 * A typed SQL expression. Identity is carried by the `returnType` descriptor
 * (inherited from `QueryOperationReturn` and narrowed to `T`) — distinct `T`
 * makes distinct Expression types structurally. `buildAst()` materialises the
 * underlying AST node.
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
 *   - An `Expression` whose codec matches exactly
 *   - A raw JS value of the codec's `input` type
 *   - `null` when `Nullable` is true
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
 * An expression or literal value targeting any codec whose trait set contains
 * all the required traits.
 *
 * Resolves the trait set to the union of matching codec identities via
 * `CodecIdsWithTrait`, then reuses `CodecExpression` for the codec-id form.
 */
export type TraitExpression<
  Traits extends readonly string[],
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> = CodecExpression<CodecIdsWithTrait<CT, Traits>, Nullable, CT>;

/**
 * Resolve a raw value or an Expression into an AST expression node.
 *
 * When `value` is an Expression (duck-typed by its `buildAst` method), the AST
 * it wraps is returned. Otherwise the value is embedded as a ParamRef tagged
 * with `codecId` (if given). Pass `codecId` to encode the literal with a
 * specific codec — most operations do.
 */
export function toExpr(value: unknown, codecId?: string): AstExpression {
  if (isExpressionLike(value)) {
    return value.buildAst();
  }
  return ParamRef.of(value, codecId ? { codecId } : undefined);
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
   * The operation's arguments. The first element is the self argument (the
   * value the operation is being applied to); the rest are the remaining
   * user-supplied arguments.
   */
  readonly args: readonly [AstExpression, ...AstExpression[]];
  readonly returns: R & ParamSpec;
  readonly lowering: SqlLoweringSpec;
}

/**
 * Construct an OperationExpr AST node and wrap it as a typed Expression.
 * Operation implementations use this to turn their user-facing arguments into
 * the AST node the compilation pipeline eventually lowers to SQL.
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

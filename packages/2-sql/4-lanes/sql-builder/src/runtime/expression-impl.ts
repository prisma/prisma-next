import type { AnyExpression as AstExpression } from '@prisma-next/sql-relational-core/ast';
import type { Expression } from '@prisma-next/sql-relational-core/expression';
import type { ScopeField } from '../scope';

/**
 * Runtime wrapper around a relational-core AST expression node. Carries ScopeField metadata (codecId, nullable) so aggregate-like combinators can propagate the input codec onto their result.
 *
 * `refs` records the column-bound binding (`{ table, column }`) when known — the field-proxy populates it for both the namespaced form (`f.user.email` → `ColumnRef`) and the top-level shortcut (`f.email` → `IdentifierRef` + refs metadata). Encode-side dispatch and the `validateParamRefRefs` pass read it via `refsOf(expression)`.
 */
export class ExpressionImpl<T extends ScopeField = ScopeField> implements Expression<T> {
  private readonly ast: AstExpression;
  readonly returnType: T;
  readonly refs: { readonly table: string; readonly column: string } | undefined;

  constructor(
    ast: AstExpression,
    returnType: T,
    refs?: { readonly table: string; readonly column: string },
  ) {
    this.ast = ast;
    this.returnType = returnType;
    this.refs = refs;
  }

  buildAst(): AstExpression {
    return this.ast;
  }
}

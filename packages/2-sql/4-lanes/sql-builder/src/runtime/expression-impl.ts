import type { AnyExpression as AstExpression } from '@prisma-next/sql-relational-core/ast';
import type { Expression } from '@prisma-next/sql-relational-core/expression';
import type { ScopeField } from '../scope';

/**
 * Runtime wrapper around a relational-core AST expression node.
 * Carries ScopeField metadata (codecId, nullable) so aggregate-like
 * combinators can propagate the input codec onto their result.
 */
export class ExpressionImpl<T extends ScopeField = ScopeField> implements Expression<T> {
  private readonly ast: AstExpression;
  readonly returnType: T;

  constructor(ast: AstExpression, returnType: T) {
    this.ast = ast;
    this.returnType = returnType;
  }

  buildAst(): AstExpression {
    return this.ast;
  }
}

import type { AnyExpression as AstExpression } from '@prisma-next/sql-relational-core/ast';
import type { Expression } from '../expression';
import { ExpressionType, type ScopeField } from '../scope';

/**
 * Runtime wrapper around a relational-core AST expression node.
 * Carries ScopeField metadata (codecId, nullable) for plan generation.
 */
export class ExpressionImpl<T extends ScopeField = ScopeField> implements Expression<T> {
  declare readonly [ExpressionType]: T;
  private readonly ast: AstExpression;
  readonly field: T;

  constructor(ast: AstExpression, field: T) {
    this[ExpressionType] = field;
    this.ast = ast;
    this.field = field;
  }

  buildAst(): AstExpression {
    return this.ast;
  }
}

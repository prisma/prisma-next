import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode } from '../red';
import { IdentifierAst } from './identifier';

export class FunctionCallAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lparen(): Token | undefined {
    return findChildToken(this.syntax, 'LParen');
  }

  rparen(): Token | undefined {
    return findChildToken(this.syntax, 'RParen');
  }

  *args(): Iterable<AttributeArgAst> {
    yield* filterChildren(this.syntax, AttributeArgAst.cast);
  }

  static cast(node: SyntaxNode): FunctionCallAst | undefined {
    return node.kind === 'FunctionCall' ? new FunctionCallAst(node) : undefined;
  }
}

export class ArrayLiteralAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  lbracket(): Token | undefined {
    return findChildToken(this.syntax, 'LBracket');
  }

  rbracket(): Token | undefined {
    return findChildToken(this.syntax, 'RBracket');
  }

  *elements(): Iterable<ExpressionAst> {
    yield* filterChildren(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): ArrayLiteralAst | undefined {
    return node.kind === 'ArrayLiteral' ? new ArrayLiteralAst(node) : undefined;
  }
}

export class StringLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): Token | undefined {
    return findChildToken(this.syntax, 'StringLiteral');
  }

  value(): string | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    const raw = tok.text.slice(1, -1);
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  static cast(node: SyntaxNode): StringLiteralExprAst | undefined {
    return node.kind === 'StringLiteralExpr' ? new StringLiteralExprAst(node) : undefined;
  }
}

export class NumberLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): Token | undefined {
    return findChildToken(this.syntax, 'NumberLiteral');
  }

  value(): number | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    return Number(tok.text);
  }

  static cast(node: SyntaxNode): NumberLiteralExprAst | undefined {
    return node.kind === 'NumberLiteralExpr' ? new NumberLiteralExprAst(node) : undefined;
  }
}

export class BooleanLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): Token | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  value(): boolean | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    if (tok.text === 'true') return true;
    if (tok.text === 'false') return false;
    return undefined;
  }

  static cast(node: SyntaxNode): BooleanLiteralExprAst | undefined {
    return node.kind === 'BooleanLiteralExpr' ? new BooleanLiteralExprAst(node) : undefined;
  }
}

export type ExpressionAst =
  | FunctionCallAst
  | ArrayLiteralAst
  | StringLiteralExprAst
  | NumberLiteralExprAst
  | BooleanLiteralExprAst
  | IdentifierAst;

export function castExpression(node: SyntaxNode): ExpressionAst | undefined {
  return (
    FunctionCallAst.cast(node) ??
    ArrayLiteralAst.cast(node) ??
    StringLiteralExprAst.cast(node) ??
    NumberLiteralExprAst.cast(node) ??
    BooleanLiteralExprAst.cast(node) ??
    IdentifierAst.cast(node)
  );
}

export class AttributeArgAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    if (!this.colon()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  colon(): Token | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  value(): ExpressionAst | undefined {
    if (this.colon()) {
      let pastColon = false;
      for (const child of this.syntax.children()) {
        if (!(child instanceof SyntaxNode)) {
          if (child.kind === 'Colon') pastColon = true;
          continue;
        }
        if (pastColon) {
          const expr = castExpression(child);
          if (expr) return expr;
        }
      }
      return undefined;
    }
    return findFirstChild(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): AttributeArgAst | undefined {
    return node.kind === 'AttributeArg' ? new AttributeArgAst(node) : undefined;
  }
}

import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { findChildToken } from '../ast-helpers';
import type { SyntaxNode } from '../red';

export class IdentifierAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): Token | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  static cast(node: SyntaxNode): IdentifierAst | undefined {
    return node.kind === 'Identifier' ? new IdentifierAst(node) : undefined;
  }
}

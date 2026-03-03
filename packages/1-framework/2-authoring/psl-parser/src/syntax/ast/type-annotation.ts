import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { findChildToken, findFirstChild } from '../ast-helpers';
import type { SyntaxNode } from '../red';
import { IdentifierAst } from './identifier';

export class TypeAnnotationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbracket(): Token | undefined {
    return findChildToken(this.syntax, 'LBracket');
  }

  rbracket(): Token | undefined {
    return findChildToken(this.syntax, 'RBracket');
  }

  questionMark(): Token | undefined {
    return findChildToken(this.syntax, 'Question');
  }

  isList(): boolean {
    return this.lbracket() !== undefined;
  }

  isOptional(): boolean {
    return this.questionMark() !== undefined;
  }

  static cast(node: SyntaxNode): TypeAnnotationAst | undefined {
    return node.kind === 'TypeAnnotation' ? new TypeAnnotationAst(node) : undefined;
  }
}

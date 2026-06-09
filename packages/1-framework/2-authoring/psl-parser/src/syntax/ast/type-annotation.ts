import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import type { SyntaxNode } from '../red';
import { FunctionCallAst } from './expressions';
import { IdentifierAst } from './identifier';

export class TypeAnnotationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  // REVIEW: don't collect the array
  #segments(): IdentifierAst[] {
    return Array.from(filterChildren(this.syntax, IdentifierAst.cast));
  }

  name(): IdentifierAst | undefined {
    return this.#segments().at(-1);
  }

  colon(): Token | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  dot(): Token | undefined {
    return findChildToken(this.syntax, 'Dot');
  }

  spaceName(): IdentifierAst | undefined {
    if (!this.colon()) return undefined;
    return this.#segments().at(0);
  }

  namespaceName(): IdentifierAst | undefined {
    if (!this.dot()) return undefined;
    return this.#segments().at(-2);
  }

  constructorCall(): FunctionCallAst | undefined {
    return findFirstChild(this.syntax, FunctionCallAst.cast);
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

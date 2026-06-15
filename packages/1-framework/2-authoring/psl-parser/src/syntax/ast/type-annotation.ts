import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode } from '../red';
import { FunctionCallAst } from './expressions';
import { IdentifierAst } from './identifier';

export class TypeAnnotationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  #lastSegment(): IdentifierAst | undefined {
    let last: IdentifierAst | undefined;
    for (const segment of filterChildren(this.syntax, IdentifierAst.cast)) {
      last = segment;
    }
    return last;
  }

  #penultimateSegment(): IdentifierAst | undefined {
    let last: IdentifierAst | undefined;
    let penultimate: IdentifierAst | undefined;
    for (const segment of filterChildren(this.syntax, IdentifierAst.cast)) {
      penultimate = last;
      last = segment;
    }
    return penultimate;
  }

  name(): IdentifierAst | undefined {
    return this.#lastSegment();
  }

  colon(): Token | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  dot(): Token | undefined {
    return findChildToken(this.syntax, 'Dot');
  }

  #separatorCount(kind: 'Dot' | 'Colon'): number {
    let count = 0;
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode) && child.kind === kind) count++;
    }
    return count;
  }

  /**
   * Whether this annotation carries more qualifier segments than a well-formed
   * type allows (a second `.`-namespace or a second `:`-space). This mirrors the
   * `parse`-side over-qualification check that emits `PSL_INVALID_QUALIFIED_TYPE`,
   * so the resolver can recognise an annotation `parse` has already flagged and
   * not double-report it as an unresolved reference.
   */
  isOverQualified(): boolean {
    return this.#separatorCount('Dot') > 1 || this.#separatorCount('Colon') > 1;
  }

  spaceName(): IdentifierAst | undefined {
    if (!this.colon()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  namespaceName(): IdentifierAst | undefined {
    if (!this.dot()) return undefined;
    return this.#penultimateSegment();
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

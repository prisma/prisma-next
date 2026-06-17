import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode } from '../red';
import { IdentifierAst } from './identifier';

/** A namespace-qualified name, e.g. `pgvector.Vector` or `supabase:auth.User`. */
export class QualifiedNameAst implements AstNode {
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

  #separatorCount(kind: 'Dot' | 'Colon'): number {
    let count = 0;
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode) && child.kind === kind) count++;
    }
    return count;
  }

  colon(): Token | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  dot(): Token | undefined {
    return findChildToken(this.syntax, 'Dot');
  }

  space(): IdentifierAst | undefined {
    if (!this.colon()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  namespace(): IdentifierAst | undefined {
    if (!this.dot()) return undefined;
    return this.#penultimateSegment();
  }

  identifier(): IdentifierAst | undefined {
    return this.#lastSegment();
  }

  /**
   * Every identifier segment, in source order. A bare `Vector` yields
   * `['Vector']`; a qualified `pgvector.Vector` yields `['pgvector', 'Vector']`.
   */
  path(): readonly string[] {
    const segments: string[] = [];
    for (const segment of filterChildren(this.syntax, IdentifierAst.cast)) {
      const text = segment.token()?.text;
      if (text !== undefined) segments.push(text);
    }
    return segments;
  }

  /**
   * Flags a malformed name with more qualifier segments than allowed (a second
   * `:`-space or a second `.`-namespace).
   */
  isOverQualified(): boolean {
    return this.#separatorCount('Dot') > 1 || this.#separatorCount('Colon') > 1;
  }

  static cast(node: SyntaxNode): QualifiedNameAst | undefined {
    return node.kind === 'QualifiedName' ? new QualifiedNameAst(node) : undefined;
  }
}

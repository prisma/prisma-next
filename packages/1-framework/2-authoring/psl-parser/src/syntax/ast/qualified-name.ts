import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode } from '../red';
import { IdentifierAst } from './identifier';

/**
 * A namespace-qualified name `[space ':']? Ident ('.' Ident)*`, parsed as a single
 * unit by `parseQualifiedName`. It is the one shape every qualified position
 * shares: a type annotation's reference or constructor callee, a qualified
 * function/constructor call's callee, and a qualified `@@`-attribute name.
 *
 * The colon-introduced first segment is the cross-space `space`; the dot-joined
 * tail is `namespace.name` (or just `name` when undotted). Reading the segments
 * back out:
 *
 * - `space()` — the segment before a `:`, when one is present.
 * - `identifier()` — the last segment (the bare type / call / attribute name).
 * - `namespace()` — the segment immediately before the last `.`, when dotted.
 */
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

  /** The cross-space `space` segment (the identifier before a `:`), if any. */
  space(): IdentifierAst | undefined {
    if (!this.colon()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  /** The namespace segment (the identifier before the last `.`), if dotted. */
  namespace(): IdentifierAst | undefined {
    if (!this.dot()) return undefined;
    return this.#penultimateSegment();
  }

  /** The bare name — the last identifier segment. */
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
   * Whether this name carries more qualifier segments than a well-formed name
   * allows (a second `:`-space or a second `.`-namespace). `parseQualifiedName`
   * emits `PSL_INVALID_QUALIFIED_NAME` for it; the resolver reads it to avoid
   * double-reporting an already-flagged annotation as unresolved.
   */
  isOverQualified(): boolean {
    return this.#separatorCount('Dot') > 1 || this.#separatorCount('Colon') > 1;
  }

  static cast(node: SyntaxNode): QualifiedNameAst | undefined {
    return node.kind === 'QualifiedName' ? new QualifiedNameAst(node) : undefined;
  }
}

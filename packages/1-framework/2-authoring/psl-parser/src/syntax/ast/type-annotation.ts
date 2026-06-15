import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import type { SyntaxNode } from '../red';
import { AttributeArgListAst } from './attributes';
import { IdentifierAst } from './identifier';
import { QualifiedNameAst } from './qualified-name';

export class TypeAnnotationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  /**
   * The qualified-name unit `[space ':']? Ident ('.' Ident)*` — the annotation's
   * reference, or the callee of a constructor when an {@link argList} follows.
   */
  qualifiedName(): QualifiedNameAst | undefined {
    return findFirstChild(this.syntax, QualifiedNameAst.cast);
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
    return this.qualifiedName()?.name() ?? this.#lastSegment();
  }

  colon(): Token | undefined {
    return this.qualifiedName()?.colon() ?? findChildToken(this.syntax, 'Colon');
  }

  dot(): Token | undefined {
    return this.qualifiedName()?.dot() ?? findChildToken(this.syntax, 'Dot');
  }

  /**
   * Whether this annotation carries more qualifier segments than a well-formed
   * type allows (a second `.`-namespace or a second `:`-space). Mirrors the
   * `parse`-side over-qualification check that emits `PSL_INVALID_QUALIFIED_TYPE`,
   * so the resolver can recognise an annotation `parse` has already flagged and
   * not double-report it as an unresolved reference.
   */
  isOverQualified(): boolean {
    return this.qualifiedName()?.isOverQualified() ?? false;
  }

  spaceName(): IdentifierAst | undefined {
    const qualified = this.qualifiedName();
    if (qualified) return qualified.space();
    if (!this.colon()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  namespaceName(): IdentifierAst | undefined {
    const qualified = this.qualifiedName();
    if (qualified) return qualified.namespace();
    if (!this.dot()) return undefined;
    return this.#penultimateSegment();
  }

  /**
   * The constructor argument list, present when the annotation is a constructor
   * (`Vector(1536)`, `pgvector.Vector(1536)`) rather than a plain reference — i.e.
   * a `(` followed the {@link qualifiedName}.
   */
  argList(): AttributeArgListAst | undefined {
    return findFirstChild(this.syntax, AttributeArgListAst.cast);
  }

  isConstructor(): boolean {
    return this.argList() !== undefined;
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

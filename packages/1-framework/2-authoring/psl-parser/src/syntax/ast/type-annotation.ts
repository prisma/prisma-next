import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { findChildToken, findFirstChild } from '../ast-helpers';
import type { SyntaxNode } from '../red';
import { AttributeArgListAst } from './attributes';
import { QualifiedNameAst } from './qualified-name';

export class TypeAnnotationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  /**
   * The qualified-name unit `[space ':']? Ident ('.' Ident)*` — the annotation's
   * reference, or the callee of a constructor when an {@link argList} follows.
   * Reach through it for the name segments (`space()`/`namespace()`/`name()`/
   * `path()`) and the over-qualification check.
   */
  name(): QualifiedNameAst | undefined {
    return findFirstChild(this.syntax, QualifiedNameAst.cast);
  }

  /**
   * The constructor argument list, present when the annotation is a constructor
   * (`Vector(1536)`, `pgvector.Vector(1536)`) rather than a plain reference — i.e.
   * a `(` followed the {@link name}.
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

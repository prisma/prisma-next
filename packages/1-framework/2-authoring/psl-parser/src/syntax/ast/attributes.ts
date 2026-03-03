import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import type { SyntaxNode } from '../red';
import { AttributeArgAst } from './expressions';
import { IdentifierAst } from './identifier';

export class AttributeArgListAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
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

  static cast(node: SyntaxNode): AttributeArgListAst | undefined {
    return node.kind === 'AttributeArgList' ? new AttributeArgListAst(node) : undefined;
  }
}

export class FieldAttributeAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  at(): Token | undefined {
    return findChildToken(this.syntax, 'At');
  }

  name(): IdentifierAst | undefined {
    if (this.dot()) {
      let count = 0;
      for (const child of this.syntax.childNodes()) {
        if (child.kind === 'Identifier') {
          count++;
          if (count === 2) return new IdentifierAst(child);
        }
      }
      return undefined;
    }
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  dot(): Token | undefined {
    return findChildToken(this.syntax, 'Dot');
  }

  namespaceName(): IdentifierAst | undefined {
    if (!this.dot()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  argList(): AttributeArgListAst | undefined {
    return findFirstChild(this.syntax, AttributeArgListAst.cast);
  }

  static cast(node: SyntaxNode): FieldAttributeAst | undefined {
    return node.kind === 'FieldAttribute' ? new FieldAttributeAst(node) : undefined;
  }
}

export class ModelAttributeAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  doubleAt(): Token | undefined {
    return findChildToken(this.syntax, 'DoubleAt');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  argList(): AttributeArgListAst | undefined {
    return findFirstChild(this.syntax, AttributeArgListAst.cast);
  }

  static cast(node: SyntaxNode): ModelAttributeAst | undefined {
    return node.kind === 'ModelAttribute' ? new ModelAttributeAst(node) : undefined;
  }
}

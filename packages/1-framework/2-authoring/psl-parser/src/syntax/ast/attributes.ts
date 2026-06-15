import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import type { SyntaxNode } from '../red';
import { AttributeArgAst } from './expressions';
import { IdentifierAst } from './identifier';
import { QualifiedNameAst } from './qualified-name';

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

/**
 * The attribute name's last segment (`map`, or the `VarChar` of `db.VarChar`).
 * Reads through the {@link QualifiedName} the parser builds; falls back to the
 * second-or-first direct `Identifier` child for hand-built trees.
 */
function attributeName(syntax: SyntaxNode): IdentifierAst | undefined {
  const qualified = findFirstChild(syntax, QualifiedNameAst.cast);
  if (qualified) return qualified.name();
  if (findChildToken(syntax, 'Dot')) {
    let count = 0;
    for (const child of syntax.childNodes()) {
      if (child.kind === 'Identifier') {
        count++;
        if (count === 2) return new IdentifierAst(child);
      }
    }
    return undefined;
  }
  return findFirstChild(syntax, IdentifierAst.cast);
}

/** The attribute's namespace segment (the `db` of `@db.VarChar`), if dotted. */
function attributeNamespace(syntax: SyntaxNode): IdentifierAst | undefined {
  const qualified = findFirstChild(syntax, QualifiedNameAst.cast);
  if (qualified) return qualified.namespace();
  if (!findChildToken(syntax, 'Dot')) return undefined;
  return findFirstChild(syntax, IdentifierAst.cast);
}

/** The dot in a qualified attribute name, whether nested in a QualifiedName or direct. */
function attributeDot(syntax: SyntaxNode): Token | undefined {
  return findFirstChild(syntax, QualifiedNameAst.cast)?.dot() ?? findChildToken(syntax, 'Dot');
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
    return attributeName(this.syntax);
  }

  dot(): Token | undefined {
    return attributeDot(this.syntax);
  }

  namespaceName(): IdentifierAst | undefined {
    return attributeNamespace(this.syntax);
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
    return attributeName(this.syntax);
  }

  dot(): Token | undefined {
    return attributeDot(this.syntax);
  }

  namespaceName(): IdentifierAst | undefined {
    return attributeNamespace(this.syntax);
  }

  argList(): AttributeArgListAst | undefined {
    return findFirstChild(this.syntax, AttributeArgListAst.cast);
  }

  static cast(node: SyntaxNode): ModelAttributeAst | undefined {
    return node.kind === 'ModelAttribute' ? new ModelAttributeAst(node) : undefined;
  }
}

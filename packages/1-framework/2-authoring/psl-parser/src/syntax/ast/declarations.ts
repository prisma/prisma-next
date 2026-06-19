import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode } from '../red';
import { FieldAttributeAst, ModelAttributeAst } from './attributes';
import type { ExpressionAst } from './expressions';
import { castExpression } from './expressions';
import { IdentifierAst } from './identifier';
import { TypeAnnotationAst } from './type-annotation';

/**
 * What may appear inside a `namespace` block: models, composite types, and
 * extension (block) declarations. `types {}` blocks and nested `namespace`
 * blocks are document-only, so they are not namespace members.
 */
export type NamespaceMemberAst =
  | ModelDeclarationAst
  | CompositeTypeDeclarationAst
  | GenericBlockDeclarationAst;

function castNamespaceMember(node: SyntaxNode): NamespaceMemberAst | undefined {
  return (
    ModelDeclarationAst.cast(node) ??
    CompositeTypeDeclarationAst.cast(node) ??
    GenericBlockDeclarationAst.cast(node)
  );
}

export class DocumentAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  *declarations(): Iterable<NamespaceMemberAst | TypesBlockAst | NamespaceDeclarationAst> {
    yield* filterChildren(
      this.syntax,
      (node) =>
        castNamespaceMember(node) ?? TypesBlockAst.cast(node) ?? NamespaceDeclarationAst.cast(node),
    );
  }

  static cast(node: SyntaxNode): DocumentAst | undefined {
    return node.kind === 'Document' ? new DocumentAst(node) : undefined;
  }
}

export class ModelDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): Token | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): Token | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): Token | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *fields(): Iterable<FieldDeclarationAst> {
    yield* filterChildren(this.syntax, FieldDeclarationAst.cast);
  }

  *attributes(): Iterable<ModelAttributeAst> {
    yield* filterChildren(this.syntax, ModelAttributeAst.cast);
  }

  static cast(node: SyntaxNode): ModelDeclarationAst | undefined {
    return node.kind === 'ModelDeclaration' ? new ModelDeclarationAst(node) : undefined;
  }
}

export class CompositeTypeDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): Token | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): Token | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): Token | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *fields(): Iterable<FieldDeclarationAst> {
    yield* filterChildren(this.syntax, FieldDeclarationAst.cast);
  }

  *attributes(): Iterable<ModelAttributeAst> {
    yield* filterChildren(this.syntax, ModelAttributeAst.cast);
  }

  static cast(node: SyntaxNode): CompositeTypeDeclarationAst | undefined {
    return node.kind === 'CompositeTypeDeclaration'
      ? new CompositeTypeDeclarationAst(node)
      : undefined;
  }
}

export class NamespaceDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): Token | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): Token | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): Token | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *declarations(): Iterable<NamespaceMemberAst> {
    yield* filterChildren(this.syntax, castNamespaceMember);
  }

  static cast(node: SyntaxNode): NamespaceDeclarationAst | undefined {
    return node.kind === 'Namespace' ? new NamespaceDeclarationAst(node) : undefined;
  }
}

export class TypesBlockAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): Token | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  lbrace(): Token | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): Token | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *declarations(): Iterable<NamedTypeDeclarationAst> {
    yield* filterChildren(this.syntax, NamedTypeDeclarationAst.cast);
  }

  static cast(node: SyntaxNode): TypesBlockAst | undefined {
    return node.kind === 'TypesBlock' ? new TypesBlockAst(node) : undefined;
  }
}

export class GenericBlockDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): Token | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): Token | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): Token | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *entries(): Iterable<KeyValuePairAst> {
    yield* filterChildren(this.syntax, KeyValuePairAst.cast);
  }

  *attributes(): Iterable<ModelAttributeAst> {
    yield* filterChildren(this.syntax, ModelAttributeAst.cast);
  }

  static cast(node: SyntaxNode): GenericBlockDeclarationAst | undefined {
    return node.kind === 'GenericBlockDeclaration'
      ? new GenericBlockDeclarationAst(node)
      : undefined;
  }
}

export class KeyValuePairAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  key(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  equals(): Token | undefined {
    return findChildToken(this.syntax, 'Equals');
  }

  value(): ExpressionAst | undefined {
    let pastEquals = false;
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode)) {
        if (child.kind === 'Equals') pastEquals = true;
        continue;
      }
      if (pastEquals) {
        const expr = castExpression(child);
        if (expr) return expr;
      }
    }
    return undefined;
  }

  static cast(node: SyntaxNode): KeyValuePairAst | undefined {
    return node.kind === 'KeyValuePair' ? new KeyValuePairAst(node) : undefined;
  }
}

export class FieldDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  typeAnnotation(): TypeAnnotationAst | undefined {
    return findFirstChild(this.syntax, TypeAnnotationAst.cast);
  }

  *attributes(): Iterable<FieldAttributeAst> {
    yield* filterChildren(this.syntax, FieldAttributeAst.cast);
  }

  static cast(node: SyntaxNode): FieldDeclarationAst | undefined {
    return node.kind === 'FieldDeclaration' ? new FieldDeclarationAst(node) : undefined;
  }
}

export class NamedTypeDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  equals(): Token | undefined {
    return findChildToken(this.syntax, 'Equals');
  }

  typeAnnotation(): TypeAnnotationAst | undefined {
    return findFirstChild(this.syntax, TypeAnnotationAst.cast);
  }

  *attributes(): Iterable<FieldAttributeAst> {
    yield* filterChildren(this.syntax, FieldAttributeAst.cast);
  }

  static cast(node: SyntaxNode): NamedTypeDeclarationAst | undefined {
    return node.kind === 'NamedTypeDeclaration' ? new NamedTypeDeclarationAst(node) : undefined;
  }
}

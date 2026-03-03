import type { Token } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode } from '../red';
import { FieldAttributeAst, ModelAttributeAst } from './attributes';
import type { ExpressionAst } from './expressions';
import { castExpression } from './expressions';
import { IdentifierAst } from './identifier';
import { TypeAnnotationAst } from './type-annotation';

export class DocumentAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  *declarations(): Iterable<
    ModelDeclarationAst | EnumDeclarationAst | TypesBlockAst | BlockDeclarationAst
  > {
    yield* filterChildren(
      this.syntax,
      (node) =>
        ModelDeclarationAst.cast(node) ??
        EnumDeclarationAst.cast(node) ??
        TypesBlockAst.cast(node) ??
        BlockDeclarationAst.cast(node),
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

export class EnumDeclarationAst implements AstNode {
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

  *values(): Iterable<EnumValueDeclarationAst> {
    yield* filterChildren(this.syntax, EnumValueDeclarationAst.cast);
  }

  static cast(node: SyntaxNode): EnumDeclarationAst | undefined {
    return node.kind === 'EnumDeclaration' ? new EnumDeclarationAst(node) : undefined;
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

export class BlockDeclarationAst implements AstNode {
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

  static cast(node: SyntaxNode): BlockDeclarationAst | undefined {
    return node.kind === 'BlockDeclaration' ? new BlockDeclarationAst(node) : undefined;
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

export class EnumValueDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  static cast(node: SyntaxNode): EnumValueDeclarationAst | undefined {
    return node.kind === 'EnumValueDeclaration' ? new EnumValueDeclarationAst(node) : undefined;
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

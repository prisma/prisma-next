import { describe, expect, it } from 'vitest';
import {
  AttributeArgListAst,
  FieldAttributeAst,
  ModelAttributeAst,
} from '../../src/syntax/ast/attributes';
import {
  BlockDeclarationAst,
  DocumentAst,
  EnumDeclarationAst,
  EnumValueDeclarationAst,
  FieldDeclarationAst,
  KeyValuePairAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  TypesBlockAst,
} from '../../src/syntax/ast/declarations';
import {
  ArrayLiteralAst,
  AttributeArgAst,
  BooleanLiteralExprAst,
  FunctionCallAst,
  NumberLiteralExprAst,
  StringLiteralExprAst,
} from '../../src/syntax/ast/expressions';
import { IdentifierAst } from '../../src/syntax/ast/identifier';
import { TypeAnnotationAst } from '../../src/syntax/ast/type-annotation';
import { GreenNodeBuilder } from '../../src/syntax/green-builder';
import { createSyntaxTree, type SyntaxNode } from '../../src/syntax/red';
import type { SyntaxKind } from '../../src/syntax/syntax-kind';

function buildIdentifier(name: string) {
  const b = new GreenNodeBuilder();
  b.startNode('Identifier');
  b.token('Ident', name);
  return b.finishNode();
}

describe('IdentifierAst', () => {
  it('exposes token()', () => {
    const root = createSyntaxTree(buildIdentifier('User'));
    const id = IdentifierAst.cast(root);
    expect(id).toBeDefined();
    expect(id!.token()?.text).toBe('User');
  });

  it('returns syntax property', () => {
    const root = createSyntaxTree(buildIdentifier('User'));
    const id = IdentifierAst.cast(root);
    expect(id!.syntax).toBe(root);
  });

  it('cast returns undefined for non-matching kind', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const green = b.finishNode();
    const root = createSyntaxTree(green);
    expect(IdentifierAst.cast(root)).toBeUndefined();
  });
});

describe('static cast', () => {
  it('DocumentAst.cast matches Document kind', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const root = createSyntaxTree(b.finishNode());
    expect(DocumentAst.cast(root)).toBeDefined();
  });

  it('ModelDeclarationAst.cast returns undefined for wrong kind', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const root = createSyntaxTree(b.finishNode());
    expect(ModelDeclarationAst.cast(root)).toBeUndefined();
  });

  const castTests: Array<[string, (node: SyntaxNode) => unknown, SyntaxKind]> = [
    ['EnumDeclarationAst', EnumDeclarationAst.cast, 'EnumDeclaration'],
    ['TypesBlockAst', TypesBlockAst.cast, 'TypesBlock'],
    ['BlockDeclarationAst', BlockDeclarationAst.cast, 'BlockDeclaration'],
    ['KeyValuePairAst', KeyValuePairAst.cast, 'KeyValuePair'],
    ['FieldDeclarationAst', FieldDeclarationAst.cast, 'FieldDeclaration'],
    ['EnumValueDeclarationAst', EnumValueDeclarationAst.cast, 'EnumValueDeclaration'],
    ['NamedTypeDeclarationAst', NamedTypeDeclarationAst.cast, 'NamedTypeDeclaration'],
    ['TypeAnnotationAst', TypeAnnotationAst.cast, 'TypeAnnotation'],
    ['FieldAttributeAst', FieldAttributeAst.cast, 'FieldAttribute'],
    ['ModelAttributeAst', ModelAttributeAst.cast, 'ModelAttribute'],
    ['AttributeArgListAst', AttributeArgListAst.cast, 'AttributeArgList'],
    ['AttributeArgAst', AttributeArgAst.cast, 'AttributeArg'],
    ['FunctionCallAst', FunctionCallAst.cast, 'FunctionCall'],
    ['ArrayLiteralAst', ArrayLiteralAst.cast, 'ArrayLiteral'],
    ['StringLiteralExprAst', StringLiteralExprAst.cast, 'StringLiteralExpr'],
    ['NumberLiteralExprAst', NumberLiteralExprAst.cast, 'NumberLiteralExpr'],
    ['BooleanLiteralExprAst', BooleanLiteralExprAst.cast, 'BooleanLiteralExpr'],
  ];

  for (const [name, castFn, kind] of castTests) {
    it(`${name}.cast matches ${kind}`, () => {
      const b = new GreenNodeBuilder();
      b.startNode(kind);
      const root = createSyntaxTree(b.finishNode());
      expect(castFn(root)).toBeDefined();
    });

    it(`${name}.cast returns undefined for wrong kind`, () => {
      const b = new GreenNodeBuilder();
      b.startNode('Document');
      const root = createSyntaxTree(b.finishNode());
      expect(castFn(root)).toBeUndefined();
    });
  }
});

describe('accessors return undefined on missing children', () => {
  it('IdentifierAst.token() returns undefined when empty', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Identifier');
    const root = createSyntaxTree(b.finishNode());
    const id = IdentifierAst.cast(root)!;
    expect(id.token()).toBeUndefined();
  });

  it('ModelDeclarationAst.name() returns undefined when missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('ModelDeclaration');
    const root = createSyntaxTree(b.finishNode());
    const model = ModelDeclarationAst.cast(root)!;
    expect(model.name()).toBeUndefined();
    expect(model.keyword()).toBeUndefined();
    expect(model.lbrace()).toBeUndefined();
    expect(model.rbrace()).toBeUndefined();
  });

  it('FieldDeclarationAst accessors return undefined when missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FieldDeclaration');
    const root = createSyntaxTree(b.finishNode());
    const field = FieldDeclarationAst.cast(root)!;
    expect(field.name()).toBeUndefined();
    expect(field.typeAnnotation()).toBeUndefined();
  });

  it('TypeAnnotationAst accessors return undefined when missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.name()).toBeUndefined();
    expect(ta.lbracket()).toBeUndefined();
    expect(ta.rbracket()).toBeUndefined();
    expect(ta.questionMark()).toBeUndefined();
    expect(ta.isList()).toBe(false);
    expect(ta.isOptional()).toBe(false);
  });
});

describe('ModelDeclarationAst', () => {
  function buildModel() {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('ModelDeclaration');
    b.token('Ident', 'model');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('Newline', '\n');
    b.token('Whitespace', '  ');
    b.startNode('FieldDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.token('Ident', 'Int');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('Identifier');
    b.token('Ident', 'map');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    b.finishNode();
    return b.finishNode();
  }

  it('exposes keyword, name, braces', () => {
    const root = createSyntaxTree(buildModel());
    const doc = DocumentAst.cast(root)!;
    const model = Array.from(doc.declarations())[0] as ModelDeclarationAst;
    expect(model.keyword()?.text).toBe('model');
    expect(model.name()?.token()?.text).toBe('User');
    expect(model.lbrace()?.text).toBe('{');
    expect(model.rbrace()?.text).toBe('}');
  });

  it('iterates fields', () => {
    const root = createSyntaxTree(buildModel());
    const doc = DocumentAst.cast(root)!;
    const model = Array.from(doc.declarations())[0] as ModelDeclarationAst;
    const fields = Array.from(model.fields());
    expect(fields).toHaveLength(1);
    expect(fields[0]!.name()?.token()?.text).toBe('id');
  });

  it('iterates model attributes', () => {
    const root = createSyntaxTree(buildModel());
    const doc = DocumentAst.cast(root)!;
    const model = Array.from(doc.declarations())[0] as ModelDeclarationAst;
    const attrs = Array.from(model.attributes());
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.doubleAt()?.text).toBe('@@');
    expect(attrs[0]!.name()?.token()?.text).toBe('map');
  });
});

describe('TypeAnnotationAst', () => {
  it('detects list type', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.token('LBracket', '[');
    b.token('RBracket', ']');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isList()).toBe(true);
    expect(ta.isOptional()).toBe(false);
    expect(ta.name()?.token()?.text).toBe('String');
  });

  it('detects optional type', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'Int');
    b.finishNode();
    b.token('Question', '?');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isList()).toBe(false);
    expect(ta.isOptional()).toBe(true);
  });
});

describe('KeyValuePairAst', () => {
  it('exposes key, equals, and value', () => {
    const b = new GreenNodeBuilder();
    b.startNode('KeyValuePair');
    b.startNode('Identifier');
    b.token('Ident', 'provider');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"postgresql"');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const kv = KeyValuePairAst.cast(root)!;
    expect(kv.key()?.token()?.text).toBe('provider');
    expect(kv.equals()?.text).toBe('=');
    const val = kv.value();
    expect(val).toBeInstanceOf(StringLiteralExprAst);
  });
});

describe('FieldAttributeAst', () => {
  it('exposes at and name for simple attribute', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = FieldAttributeAst.cast(root)!;
    expect(attr.at()?.text).toBe('@');
    expect(attr.name()?.token()?.text).toBe('id');
    expect(attr.dot()).toBeUndefined();
    expect(attr.namespaceName()).toBeUndefined();
    expect(attr.argList()).toBeUndefined();
  });

  it('exposes namespaced attribute parts', () => {
    // @db.VarChar
    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'db');
    b.finishNode();
    b.token('Dot', '.');
    b.startNode('Identifier');
    b.token('Ident', 'VarChar');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = FieldAttributeAst.cast(root)!;
    expect(attr.dot()?.text).toBe('.');
    expect(attr.namespaceName()?.token()?.text).toBe('db');
    expect(attr.name()?.token()?.text).toBe('VarChar');
  });

  it('exposes argList', () => {
    // @default(autoincrement())
    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'default');
    b.finishNode();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('FunctionCall');
    b.startNode('Identifier');
    b.token('Ident', 'autoincrement');
    b.finishNode();
    b.token('LParen', '(');
    b.token('RParen', ')');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = FieldAttributeAst.cast(root)!;
    const argList = attr.argList();
    expect(argList).toBeDefined();
    expect(argList!.lparen()?.text).toBe('(');
    expect(argList!.rparen()?.text).toBe(')');
    const args = Array.from(argList!.args());
    expect(args).toHaveLength(1);
    const val = args[0]!.value();
    expect(val).toBeInstanceOf(FunctionCallAst);
  });
});

describe('StringLiteralExprAst', () => {
  it('returns unquoted string value', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"hello world"');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe('hello world');
  });

  it('unescapes escape sequences', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"line1\\nline2\\ttab"');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe('line1\nline2\ttab');
  });

  it('returns undefined when token missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.token()).toBeUndefined();
    expect(expr.value()).toBeUndefined();
  });
});

describe('NumberLiteralExprAst', () => {
  it('returns parsed integer', () => {
    const b = new GreenNodeBuilder();
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '42');
    const root = createSyntaxTree(b.finishNode());
    const expr = NumberLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(42);
  });

  it('returns parsed float', () => {
    const b = new GreenNodeBuilder();
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '3.14');
    const root = createSyntaxTree(b.finishNode());
    const expr = NumberLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(3.14);
  });

  it('returns undefined when token missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('NumberLiteralExpr');
    const root = createSyntaxTree(b.finishNode());
    const expr = NumberLiteralExprAst.cast(root)!;
    expect(expr.value()).toBeUndefined();
  });
});

describe('BooleanLiteralExprAst', () => {
  it('returns true', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    b.token('Ident', 'true');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(true);
  });

  it('returns false', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    b.token('Ident', 'false');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(false);
  });

  it('returns undefined for non-boolean ident', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    b.token('Ident', 'maybe');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBeUndefined();
  });

  it('returns undefined when token missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBeUndefined();
  });
});

describe('AttributeArgAst', () => {
  it('exposes positional arg value', () => {
    const b = new GreenNodeBuilder();
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const arg = AttributeArgAst.cast(root)!;
    expect(arg.name()).toBeUndefined(); // positional - no colon
    expect(arg.colon()).toBeUndefined();
    const val = arg.value();
    expect(val).toBeInstanceOf(IdentifierAst);
  });

  it('exposes named arg with colon', () => {
    const b = new GreenNodeBuilder();
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'fields');
    b.finishNode();
    b.token('Colon', ':');
    b.token('Whitespace', ' ');
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('RBracket', ']');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const arg = AttributeArgAst.cast(root)!;
    expect(arg.name()?.token()?.text).toBe('fields');
    expect(arg.colon()?.text).toBe(':');
    const val = arg.value();
    expect(val).toBeInstanceOf(ArrayLiteralAst);
  });
});

describe('ArrayLiteralAst', () => {
  it('exposes brackets and elements', () => {
    const b = new GreenNodeBuilder();
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('Comma', ',');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'name');
    b.finishNode();
    b.token('RBracket', ']');
    const root = createSyntaxTree(b.finishNode());
    const arr = ArrayLiteralAst.cast(root)!;
    expect(arr.lbracket()?.text).toBe('[');
    expect(arr.rbracket()?.text).toBe(']');
    const elements = Array.from(arr.elements());
    expect(elements).toHaveLength(2);
  });
});

describe('DocumentAst', () => {
  it('iterates mixed declarations', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('ModelDeclaration');
    b.token('Ident', 'model');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    b.token('Newline', '\n');
    b.startNode('EnumDeclaration');
    b.token('Ident', 'enum');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Role');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const doc = DocumentAst.cast(root)!;
    const decls = Array.from(doc.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[1]).toBeInstanceOf(EnumDeclarationAst);
  });
});

describe('EnumDeclarationAst', () => {
  function buildEnum() {
    const b = new GreenNodeBuilder();
    b.startNode('EnumDeclaration');
    b.token('Ident', 'enum');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Role');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('Newline', '\n');
    b.token('Whitespace', '  ');
    b.startNode('EnumValueDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'ADMIN');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('Whitespace', '  ');
    b.startNode('EnumValueDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'USER');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    return b.finishNode();
  }

  it('exposes keyword, name, braces', () => {
    const root = createSyntaxTree(buildEnum());
    const decl = EnumDeclarationAst.cast(root)!;
    expect(decl.keyword()?.text).toBe('enum');
    expect(decl.name()?.token()?.text).toBe('Role');
    expect(decl.lbrace()?.text).toBe('{');
    expect(decl.rbrace()?.text).toBe('}');
  });

  it('iterates values', () => {
    const root = createSyntaxTree(buildEnum());
    const decl = EnumDeclarationAst.cast(root)!;
    const values = Array.from(decl.values());
    expect(values).toHaveLength(2);
    expect(values[0]!.name()?.token()?.text).toBe('ADMIN');
    expect(values[1]!.name()?.token()?.text).toBe('USER');
  });
});

describe('TypesBlockAst', () => {
  function buildTypesBlock() {
    const b = new GreenNodeBuilder();
    b.startNode('TypesBlock');
    b.token('Ident', 'type');
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('Newline', '\n');
    b.token('Whitespace', '  ');
    b.startNode('NamedTypeDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'UserId');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.token('Ident', 'Int');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    return b.finishNode();
  }

  it('exposes keyword, braces', () => {
    const root = createSyntaxTree(buildTypesBlock());
    const decl = TypesBlockAst.cast(root)!;
    expect(decl.keyword()?.text).toBe('type');
    expect(decl.lbrace()?.text).toBe('{');
    expect(decl.rbrace()?.text).toBe('}');
  });

  it('iterates declarations', () => {
    const root = createSyntaxTree(buildTypesBlock());
    const decl = TypesBlockAst.cast(root)!;
    const namedTypes = Array.from(decl.declarations());
    expect(namedTypes).toHaveLength(1);
    expect(namedTypes[0]!.name()?.token()?.text).toBe('UserId');
  });
});

describe('NamedTypeDeclarationAst', () => {
  function buildNamedType() {
    const b = new GreenNodeBuilder();
    b.startNode('NamedTypeDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'UserId');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'Int');
    b.finishNode();
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'db');
    b.finishNode();
    b.finishNode();
    return b.finishNode();
  }

  it('exposes name, equals, typeAnnotation, attributes', () => {
    const root = createSyntaxTree(buildNamedType());
    const decl = NamedTypeDeclarationAst.cast(root)!;
    expect(decl.name()?.token()?.text).toBe('UserId');
    expect(decl.equals()?.text).toBe('=');
    expect(decl.typeAnnotation()?.name()?.token()?.text).toBe('Int');
    const attrs = Array.from(decl.attributes());
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.name()?.token()?.text).toBe('db');
  });
});

describe('BlockDeclarationAst', () => {
  function buildBlock() {
    const b = new GreenNodeBuilder();
    b.startNode('BlockDeclaration');
    b.token('Ident', 'datasource');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'db');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('Newline', '\n');
    b.token('Whitespace', '  ');
    b.startNode('KeyValuePair');
    b.startNode('Identifier');
    b.token('Ident', 'provider');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"postgresql"');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    return b.finishNode();
  }

  it('exposes keyword, name, braces', () => {
    const root = createSyntaxTree(buildBlock());
    const decl = BlockDeclarationAst.cast(root)!;
    expect(decl.keyword()?.text).toBe('datasource');
    expect(decl.name()?.token()?.text).toBe('db');
    expect(decl.lbrace()?.text).toBe('{');
    expect(decl.rbrace()?.text).toBe('}');
  });

  it('iterates entries', () => {
    const root = createSyntaxTree(buildBlock());
    const decl = BlockDeclarationAst.cast(root)!;
    const entries = Array.from(decl.entries());
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key()?.token()?.text).toBe('provider');
  });
});

describe('FieldDeclarationAst.attributes', () => {
  it('iterates field attributes', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FieldDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.token('Ident', 'Int');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const field = FieldDeclarationAst.cast(root)!;
    const attrs = Array.from(field.attributes());
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.name()?.token()?.text).toBe('id');
  });
});

describe('FunctionCallAst', () => {
  it('exposes name, parens, and args', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FunctionCall');
    b.startNode('Identifier');
    b.token('Ident', 'autoincrement');
    b.finishNode();
    b.token('LParen', '(');
    b.token('RParen', ')');
    const root = createSyntaxTree(b.finishNode());
    const fn = FunctionCallAst.cast(root)!;
    expect(fn.name()?.token()?.text).toBe('autoincrement');
    expect(fn.lparen()?.text).toBe('(');
    expect(fn.rparen()?.text).toBe(')');
    expect(Array.from(fn.args())).toHaveLength(0);
  });
});

describe('ModelAttributeAst.argList', () => {
  it('exposes argList with args', () => {
    // @@unique([email])
    const b = new GreenNodeBuilder();
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('Identifier');
    b.token('Ident', 'unique');
    b.finishNode();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'email');
    b.finishNode();
    b.token('RBracket', ']');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = ModelAttributeAst.cast(root)!;
    const argList = attr.argList();
    expect(argList).toBeDefined();
    expect(argList!.lparen()?.text).toBe('(');
    const args = Array.from(argList!.args());
    expect(args).toHaveLength(1);
  });
});

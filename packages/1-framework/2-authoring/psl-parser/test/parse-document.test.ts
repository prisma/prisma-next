import { describe, expect, it } from 'vitest';
import {
  Cursor,
  parse,
  parseBlockAttribute,
  parseEnum,
  parseEnumValue,
  parseField,
  parseGenericBlock,
  parseKeyValue,
  parseModel,
  parseNamedType,
  parseNamespace,
  parseTypeDeclaration,
} from '../src/parse';
import { AttributeArgListAst, FieldAttributeAst } from '../src/syntax/ast/attributes';
import {
  BlockDeclarationAst,
  CompositeTypeDeclarationAst,
  DocumentAst,
  EnumDeclarationAst,
  FieldDeclarationAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../src/syntax/ast/declarations';
import { ObjectLiteralExprAst } from '../src/syntax/ast/expressions';
import type { GreenElement, GreenNode } from '../src/syntax/green';
import { GreenNodeBuilder } from '../src/syntax/green-builder';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function greenRoot(source: string): GreenNode {
  return parse(source).document.syntax.green;
}

describe('parse() well-formed document conformance', () => {
  it('reproduces a model with a field and a field attribute', () => {
    const source = 'model User {\n  id Int @id\n}';
    const result = parse(source);

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
    b.startNode('Identifier');
    b.token('Ident', 'Int');
    b.finishNode();
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a model with a field and a block attribute', () => {
    const source = 'model User {\n  id Int\n@@map\n}';
    const result = parse(source);

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
    b.startNode('Identifier');
    b.token('Ident', 'Int');
    b.finishNode();
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
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces an enum with values', () => {
    const source = 'enum Role {\n  ADMIN\n  USER\n}';
    const result = parse(source);

    const b = new GreenNodeBuilder();
    b.startNode('Document');
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
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces an enum with value and block attributes', () => {
    const source = 'enum Role {ADMIN @map@@map}';
    const result = parse(source);

    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('EnumDeclaration');
    b.token('Ident', 'enum');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Role');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.startNode('EnumValueDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'ADMIN');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'map');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('Identifier');
    b.token('Ident', 'map');
    b.finishNode();
    b.finishNode();
    b.token('RBrace', '}');
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a types block with a named type', () => {
    const source = 'type {\n  UserId = Int\n}';
    const result = parse(source);

    const b = new GreenNodeBuilder();
    b.startNode('Document');
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
    b.startNode('Identifier');
    b.token('Ident', 'Int');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a named-type declaration with an attribute inside a types block', () => {
    const source = 'type {\n  UserId = Int @db\n}';
    const result = parse(source);

    const b = new GreenNodeBuilder();
    b.startNode('Document');
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
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a generic block declaration with a key-value entry', () => {
    const source = 'datasource db {\n  provider = "postgresql"\n}';
    const result = parse(source);

    const b = new GreenNodeBuilder();
    b.startNode('Document');
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
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a composite type declaration', () => {
    const source = 'type Address {street String@@map}';
    const result = parse(source);

    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('CompositeTypeDeclaration');
    b.token('Ident', 'type');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Address');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.startNode('FieldDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'street');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('Identifier');
    b.token('Ident', 'map');
    b.finishNode();
    b.finishNode();
    b.token('RBrace', '}');
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a namespace with nested declarations', () => {
    const source = 'namespace auth {model User{}enum Role{}extend Something{}}';
    const result = parse(source);

    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Namespace');
    b.token('Ident', 'namespace');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'auth');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.startNode('ModelDeclaration');
    b.token('Ident', 'model');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    b.startNode('EnumDeclaration');
    b.token('Ident', 'enum');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Role');
    b.finishNode();
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    b.startNode('BlockDeclaration');
    b.token('Ident', 'extend');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Something');
    b.finishNode();
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    b.token('RBrace', '}');
    b.finishNode();
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a document with mixed declarations', () => {
    const source = 'model User {}\nenum Role {}';
    const result = parse(source);

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
    const expected = b.finishNode();

    expect(result.document.syntax.green).toEqual(expected);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('preserves leading and trailing trivia losslessly', () => {
    const source = '\n// header\nmodel User {}\n';
    const result = parse(source);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
  });
});

describe('parse() representative multi-construct schema', () => {
  const source = [
    'datasource db {',
    '  provider = "postgresql"',
    '  url = env("DATABASE_URL")',
    '}',
    '',
    'type {',
    '  UserId = Int @id',
    '}',
    '',
    'model User {',
    '  id UserId @id',
    '  name String?',
    '  roles Role[]',
    '  posts auth.Post[]',
    '  vec Vector(1536)',
    '  org supabase:auth.Org',
    '  @@index([id, name])',
    '  @@map("users")',
    '}',
    '',
    'enum Role {',
    '  ADMIN @map("admin")',
    '  USER',
    '  @@map("roles")',
    '}',
    '',
    'namespace auth {',
    '  model Post {',
    '    id Int @id',
    '    tags String[] @db.Array',
    '  }',
    '  enum Visibility {',
    '    PUBLIC',
    '  }',
    '}',
    '',
    'type Address {',
    '  street String',
    '  @@map("addresses")',
    '}',
  ].join('\n');

  it('parses every construct with zero diagnostics and round-trips', () => {
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('exposes the top-level declarations in order', () => {
    const result = parse(source);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(6);
    expect(decls[0]).toBeInstanceOf(BlockDeclarationAst);
    expect(decls[1]).toBeInstanceOf(TypesBlockAst);
    expect(decls[2]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[3]).toBeInstanceOf(EnumDeclarationAst);
    expect(decls[4]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(decls[5]).toBeInstanceOf(CompositeTypeDeclarationAst);
  });

  it('exposes the namespace members', () => {
    const result = parse(source);
    const ns = Array.from(result.document.declarations()).find(
      (d): d is NamespaceDeclarationAst => d instanceof NamespaceDeclarationAst,
    );
    const members = Array.from(ns!.declarations());
    expect(members).toHaveLength(2);
    expect(members[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(members[1]).toBeInstanceOf(EnumDeclarationAst);
  });
});

describe('parse() round-trips lossless schemas', () => {
  it('parses an object-literal constructor argument into a queryable ObjectLiteralExpr node', () => {
    const source = 'model M {\n  id Json @default({ a: 1, nested: { b: 2 } })\n}';
    const result = parse(source);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    const model = decls[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (!(model instanceof ModelDeclarationAst)) return;
    const [field] = Array.from(model.fields());
    expect(field).toBeInstanceOf(FieldDeclarationAst);
    const [attr] = Array.from(field!.attributes());
    expect(attr).toBeInstanceOf(FieldAttributeAst);
    const argList = attr!.argList();
    expect(argList).toBeInstanceOf(AttributeArgListAst);
    const [arg] = Array.from(argList!.args());
    const obj = arg!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (!(obj instanceof ObjectLiteralExprAst)) return;
    const fields = Array.from(obj.fields());
    expect(fields.map((f) => f.key()?.token()?.text)).toEqual(['a', 'nested']);
    expect(fields[1]!.value()).toBeInstanceOf(ObjectLiteralExprAst);
  });

  it('round-trips a schema with CRLF newlines', () => {
    const source = 'model User {\r\n  id Int @id\r\n}\r\nenum Role {\r\n  ADMIN\r\n}\r\n';
    const result = parse(source);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[1]).toBeInstanceOf(EnumDeclarationAst);
  });
});

function codes(source: string): readonly string[] {
  return parse(source).diagnostics.map((d) => d.code);
}

describe('parse() declaration-level diagnostics', () => {
  it('flags an unterminated block but still returns a tree', () => {
    const source = 'model User {\n  id Int';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_UNTERMINATED_BLOCK');
    expect(result.document).toBeInstanceOf(DocumentAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
    const model = Array.from(result.document.declarations())[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
  });

  it('flags unsupported top-level content and keeps parsing later declarations', () => {
    const source = 'oops\nmodel User {}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
  });

  it('flags a reserved namespace name and keeps parsing', () => {
    const source = 'namespace __unspecified__ {\n}\nmodel User {}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_NAMESPACE_BLOCK');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(decls[1]).toBeInstanceOf(ModelDeclarationAst);
  });

  it('flags a recursive namespace block', () => {
    const source = 'namespace outer {\nnamespace inner {\n}\n}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_NAMESPACE_BLOCK');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('flags a types block nested inside a namespace', () => {
    const source = 'namespace outer {\ntype {\n}\n}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_NAMESPACE_BLOCK');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('flags a malformed model member and keeps parsing the valid field', () => {
    const source = 'model M {\n  123 bad\n  id Int\n}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_MODEL_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const model = Array.from(result.document.declarations())[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (model instanceof ModelDeclarationAst) {
      const fields = Array.from(model.fields());
      expect(fields).toHaveLength(1);
      expect(fields[0]!.name()?.token()?.text).toBe('id');
    }
  });

  it('flags a malformed enum member and keeps parsing the valid value', () => {
    const source = 'enum E {\n  123\n  OK\n}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_ENUM_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(EnumDeclarationAst);
    if (decl instanceof EnumDeclarationAst) {
      const values = Array.from(decl.values());
      expect(values).toHaveLength(1);
      expect(values[0]!.name()?.token()?.text).toBe('OK');
    }
  });

  it('flags a malformed types-block member and keeps parsing the valid named type', () => {
    const source = 'type {\n  123\n  Ok = Int\n}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_TYPES_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(TypesBlockAst);
    if (decl instanceof TypesBlockAst) {
      const named = Array.from(decl.declarations());
      expect(named).toHaveLength(1);
      expect(named[0]!.name()?.token()?.text).toBe('Ok');
    }
  });

  it('parses two top-level types blocks without a uniqueness diagnostic', () => {
    const source = 'type {\n}\ntype {\n}';
    expect(codes(source)).not.toContain('PSL_INVALID_TYPES_MEMBER');
    const decls = Array.from(parse(source).document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls.every((d) => d instanceof TypesBlockAst)).toBe(true);
    expect(greenText(greenRoot(source))).toBe(source);
  });

  it('flags a malformed generic-block entry and keeps parsing the valid entry', () => {
    const source = 'datasource db {\n  123\n  provider = "x"\n}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_EXTENSION_BLOCK_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(BlockDeclarationAst);
    if (decl instanceof BlockDeclarationAst) {
      const entries = Array.from(decl.entries());
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key()?.token()?.text).toBe('provider');
    }
  });

  it('never throws on adversarial input', () => {
    for (const source of ['', '{', '}', '@@@', 'model', 'type', 'namespace {', '== =']) {
      expect(() => parse(source)).not.toThrow();
    }
  });
});

/**
 * The ordered-alternative dispatch relies on every alternative being a no-op on
 * non-match: it must return `undefined` having consumed and mutated nothing, so
 * a rejected alternative leaves the forward-only cursor intact for the next one.
 * We assert this observationally with the existing cursor API — after the
 * rejection, draining the remaining stream must reproduce the whole source
 * byte-for-byte (nothing dropped) and no diagnostic may have been emitted.
 */
function expectNoOpReject(source: string, run: (cursor: Cursor) => GreenNode | undefined): void {
  const cursor = new Cursor(source);
  expect(run(cursor)).toBeUndefined();
  expect(cursor.diagnostics).toEqual([]);
  cursor.startNode('Document');
  while (cursor.peekKind() !== 'Eof') {
    cursor.bump();
  }
  cursor.flushTrivia();
  expect(greenText(cursor.finishNode())).toBe(source);
}

describe('ordered-alternative parsers are no-ops on non-match', () => {
  it('parseModel rejects a non-model keyword without consuming', () => {
    expectNoOpReject('enum Color {', parseModel);
  });

  it('parseEnum rejects a non-enum keyword without consuming', () => {
    expectNoOpReject('model User {', parseEnum);
  });

  it('parseNamespace rejects a non-namespace keyword without consuming', () => {
    expectNoOpReject('model User {', (cursor) => parseNamespace(cursor, false));
  });

  it('parseTypeDeclaration rejects a non-type keyword without consuming', () => {
    expectNoOpReject('model User {', (cursor) => parseTypeDeclaration(cursor, false));
  });

  it('parseGenericBlock rejects a reserved keyword so it falls through to recovery', () => {
    expectNoOpReject('model {', parseGenericBlock);
  });

  it('parseGenericBlock rejects an identifier with no following brace', () => {
    expectNoOpReject('solid plumber', parseGenericBlock);
  });

  it('parseBlockAttribute rejects a single-at attribute, preserving the @@-vs-@ split', () => {
    expectNoOpReject('@id', parseBlockAttribute);
  });

  it('parseField rejects a leading double-at member without consuming', () => {
    expectNoOpReject('@@map', parseField);
  });

  it('parseEnumValue rejects a leading double-at member without consuming', () => {
    expectNoOpReject('@@map', parseEnumValue);
  });

  it('parseNamedType rejects a non-identifier member without consuming', () => {
    expectNoOpReject('@@index', parseNamedType);
  });

  it('parseKeyValue rejects a non-identifier entry without consuming', () => {
    expectNoOpReject('42', parseKeyValue);
  });
});

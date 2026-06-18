import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import {
  CompositeTypeDeclarationAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
} from '../src/syntax/ast/declarations';

const SCALAR_TYPES = ['String', 'Int', 'Boolean', 'DateTime'] as const;

function build(source: string, scalarTypes: readonly string[] = SCALAR_TYPES) {
  const { document, sourceFile } = parse(source);
  return buildSymbolTable({ document, sourceFile, scalarTypes });
}

describe('buildSymbolTable() — AC1 fault tolerance', () => {
  it('never throws on malformed input and returns its own duplicate diagnostics', () => {
    const source = [
      'model User {',
      '  id Int',
      '}',
      'model User {',
      '  id Int',
      '}',
      'types {',
      '  Email = Mystery',
      '}',
      'model Dangling {',
      '  id Int',
    ].join('\n');

    const result = build(source);

    expect(result.diagnostics.every((d) => d.code === 'PSL_DUPLICATE_DECLARATION')).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(Object.keys(result.table.topLevel.models)).toEqual(['User', 'Dangling']);
    expect(result.table.topLevel.typeAliases.Email?.kind).toBe('typeAlias');
  });
});

describe('buildSymbolTable() — AC2 top-level kinds and scalar/alias classification', () => {
  it('classifies each top-level declaration by kind', () => {
    const source = [
      'model User {',
      '  id Int',
      '}',
      'type Address {',
      '  street String',
      '}',
      'policy Strict {',
      '  on = read',
      '}',
      'types {',
      '  Email = String',
      '  UserId = User',
      '}',
    ].join('\n');

    const result = build(source);
    const { topLevel } = result.table;

    expect(topLevel.models.User?.kind).toBe('model');
    expect(topLevel.models.User?.node).toBeInstanceOf(ModelDeclarationAst);
    expect(topLevel.compositeTypes.Address?.kind).toBe('compositeType');
    expect(topLevel.compositeTypes.Address?.node).toBeInstanceOf(CompositeTypeDeclarationAst);
    expect(topLevel.blocks.Strict?.kind).toBe('block');
    expect(topLevel.blocks.Strict?.keyword).toBe('policy');
    expect(topLevel.blocks.Strict?.node).toBeInstanceOf(GenericBlockDeclarationAst);

    expect(topLevel.scalars.Email?.kind).toBe('scalar');
    expect(topLevel.scalars.Email?.node).toBeInstanceOf(NamedTypeDeclarationAst);
    expect(topLevel.typeAliases.UserId?.kind).toBe('typeAlias');
    expect(topLevel.scalars.UserId).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });
});

describe('buildSymbolTable() — AC3 namespace nesting', () => {
  it('nests namespace members under the namespace, not at top level', () => {
    const source = ['namespace Foo {', '  model A {', '    id Int', '  }', '}'].join('\n');

    const result = build(source);
    const { topLevel } = result.table;

    expect(topLevel.namespaces.Foo?.kind).toBe('namespace');
    expect(topLevel.namespaces.Foo?.node).toBeInstanceOf(NamespaceDeclarationAst);
    expect(topLevel.namespaces.Foo?.models.A?.kind).toBe('model');
    expect(topLevel.models.A).toBeUndefined();
  });
});

describe('buildSymbolTable() — AC4 field nesting', () => {
  it('keys fields by name and back-references the FieldDeclarationAst', () => {
    const source = ['model User {', '  id Int', '  email String', '}'].join('\n');

    const result = build(source);
    const fields = result.table.topLevel.models.User?.fields ?? {};

    expect(Object.keys(fields)).toEqual(['id', 'email']);
    expect(fields.email?.kind).toBe('field');
    expect(fields.email?.name).toBe('email');
    expect(fields.email?.node).toBeInstanceOf(FieldDeclarationAst);
  });
});

describe('buildSymbolTable() — AC5 duplicate detection', () => {
  it('keeps the first top-level declaration and flags the later one', () => {
    const source = ['model User {', '  id Int', '}', 'model User {', '  other Int', '}'].join('\n');

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    const first = result.table.topLevel.models.User;
    expect(Object.keys(first?.fields ?? {})).toEqual(['id']);
  });

  it('detects duplicates within a single namespace body', () => {
    const source = [
      'namespace Foo {',
      '  model User {',
      '    id Int',
      '  }',
      '  model User {',
      '    other Int',
      '  }',
      '}',
    ].join('\n');

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    const nested = result.table.topLevel.namespaces.Foo?.models.User;
    expect(Object.keys(nested?.fields ?? {})).toEqual(['id']);
  });

  it('collides regardless of kind: model User + type User', () => {
    const source = ['model User {', '  id Int', '}', 'type User {', '  street String', '}'].join(
      '\n',
    );

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    expect(result.table.topLevel.models.User?.kind).toBe('model');
    expect(result.table.topLevel.compositeTypes.User).toBeUndefined();
  });

  it('anchors the duplicate diagnostic on the later declaration name span', () => {
    const source = ['model User {', '}', 'model User {', '}'].join('\n');

    const result = build(source);
    const diagnostic = result.diagnostics[0];

    expect(diagnostic?.code).toBe('PSL_DUPLICATE_DECLARATION');
    expect(diagnostic?.range.start.line).toBe(2);
    expect(diagnostic?.range.start.character).toBe(6);
    expect(diagnostic?.range.end.character).toBe(10);
  });
});

describe('buildSymbolTable() — pre-investigated edge cases', () => {
  it('classifies a constructor binding as typeAlias, never scalar', () => {
    const source = ['types {', '  Embedding = Vector(1536)', '}'].join('\n');

    const result = build(source, ['Vector', 'String']);

    expect(result.table.topLevel.typeAliases.Embedding?.kind).toBe('typeAlias');
    expect(result.table.topLevel.scalars.Embedding).toBeUndefined();
  });

  it('skips a nameless recovered declaration without diagnostic or throw', () => {
    const source = 'model {\n  id Int\n}';

    const result = build(source);

    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.table.topLevel.models)).toEqual([]);
  });
});

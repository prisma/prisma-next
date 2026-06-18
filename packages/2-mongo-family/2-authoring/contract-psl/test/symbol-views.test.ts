import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { buildCompositeTypeView, buildFieldView, buildModelView } from '../src/symbol-views';

const SCALAR_TYPES = ['String', 'Int', 'Boolean', 'ObjectId', 'DateTime'] as const;

function symbols(schema: string) {
  const { document, sourceFile } = parse(schema);
  const { table } = buildSymbolTable({ document, sourceFile, scalarTypes: SCALAR_TYPES });
  return { topLevel: table.topLevel, sourceFile };
}

describe('buildModelView', () => {
  it('builds a model view with fields keyed in source order and attributes', () => {
    const { topLevel, sourceFile } = symbols(
      `model User {
  id    Int    @id
  name  String
  tags  String[]
  @@map("users")
}`,
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const view = buildModelView(topLevel.models['User']!, sourceFile, 'schema.prisma', diagnostics);

    expect(diagnostics).toEqual([]);
    expect(view.name).toBe('User');
    expect(view.fields.map((f) => f.name)).toEqual(['id', 'name', 'tags']);
    expect(view.fields[0]).toMatchObject({ name: 'id', typeName: 'Int', optional: false });
    expect(view.fields[2]).toMatchObject({ name: 'tags', typeName: 'String', list: true });
    expect(view.attributes.map((a) => a.name)).toContain('map');
    expect(view.span.start.line).toBeGreaterThan(0);
  });

  it('carries field attributes onto the field views', () => {
    const { topLevel, sourceFile } = symbols(
      `model User {
  id Int @id @map("_id")
}`,
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const view = buildModelView(topLevel.models['User']!, sourceFile, 'schema.prisma', diagnostics);
    const id = view.fields[0]!;

    expect(id.attributes.map((a) => a.name)).toEqual(['id', 'map']);
    const map = id.attributes.find((a) => a.name === 'map');
    expect(map?.args[0]).toMatchObject({ kind: 'positional', value: '"_id"' });
  });
});

describe('buildCompositeTypeView', () => {
  it('builds a composite-type view from a `type` block', () => {
    const { topLevel, sourceFile } = symbols(
      `type Address {
  street String
  zip    String
}`,
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const view = buildCompositeTypeView(
      topLevel.compositeTypes['Address']!,
      sourceFile,
      'schema.prisma',
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(view.name).toBe('Address');
    expect(view.fields.map((f) => f.name)).toEqual(['street', 'zip']);
    expect(view.fields.every((f) => f.typeName === 'String')).toBe(true);
  });
});

describe('buildFieldView — over-qualified type', () => {
  it('emits PSL_INVALID_QUALIFIED_TYPE and marks the field already-reported', () => {
    const { topLevel, sourceFile } = symbols(
      `model User {
  bad a.b.c
}`,
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const field = topLevel.models['User']!.fields['bad']!;
    const view = buildFieldView(field, sourceFile, 'schema.prisma', diagnostics);

    expect(diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_QUALIFIED_TYPE']);
    expect(diagnostics[0]).toMatchObject({ sourceId: 'schema.prisma' });
    expect(view.typeAlreadyReported).toBe(true);
    expect(view.typeName).toBe('c');
  });

  it('reads a dot-qualified field type into namespace + name', () => {
    const { topLevel, sourceFile } = symbols(
      `model Post {
  author auth.User
}`,
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const field = topLevel.models['Post']!.fields['author']!;
    const view = buildFieldView(field, sourceFile, 'schema.prisma', diagnostics);

    expect(diagnostics).toEqual([]);
    expect(view).toMatchObject({ name: 'author', typeName: 'User', typeNamespaceId: 'auth' });
  });
});

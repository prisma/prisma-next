import type {
  DocumentAst,
  FieldDeclarationAst,
  ModelDeclarationAst,
} from '@prisma-next/psl-parser/syntax';
import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { readAttribute, readFieldTypeAnnotation } from '../src/cst-read';

function firstModel(document: DocumentAst): ModelDeclarationAst {
  for (const declaration of document.declarations()) {
    if ('fields' in declaration) {
      return declaration as ModelDeclarationAst;
    }
  }
  throw new Error('expected a model declaration');
}

function fieldsOf(model: ModelDeclarationAst): FieldDeclarationAst[] {
  return Array.from(model.fields());
}

function parseModelFields(body: string): {
  fields: FieldDeclarationAst[];
  document: DocumentAst;
  sourceFile: ReturnType<typeof parse>['sourceFile'];
} {
  const { document, sourceFile } = parse(`model M {\n${body}\n}`);
  const model = firstModel(document);
  return { fields: fieldsOf(model), document, sourceFile };
}

describe('readFieldTypeAnnotation — type splitting', () => {
  it('reads a bare required scalar type', () => {
    const { fields, sourceFile } = parseModelFields('  id Int');
    const result = readFieldTypeAnnotation(fields[0]!, sourceFile);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.annotation).toMatchObject({
      typeName: 'Int',
      typeNamespaceId: undefined,
      typeContractSpaceId: undefined,
      optional: false,
      list: false,
      isConstructor: false,
      path: ['Int'],
    });
  });

  it('reads an optional type', () => {
    const { fields, sourceFile } = parseModelFields('  nickname String?');
    const result = readFieldTypeAnnotation(fields[0]!, sourceFile);
    if (!result.ok) throw new Error('expected ok');
    expect(result.annotation.optional).toBe(true);
    expect(result.annotation.list).toBe(false);
    expect(result.annotation.typeName).toBe('String');
  });

  it('reads a list type', () => {
    const { fields, sourceFile } = parseModelFields('  tags String[]');
    const result = readFieldTypeAnnotation(fields[0]!, sourceFile);
    if (!result.ok) throw new Error('expected ok');
    expect(result.annotation.list).toBe(true);
    expect(result.annotation.optional).toBe(false);
    expect(result.annotation.typeName).toBe('String');
  });

  it('reads a dot-qualified namespace type', () => {
    const { fields, sourceFile } = parseModelFields('  user auth.User');
    const result = readFieldTypeAnnotation(fields[0]!, sourceFile);
    if (!result.ok) throw new Error('expected ok');
    expect(result.annotation).toMatchObject({
      typeName: 'User',
      typeNamespaceId: 'auth',
      typeContractSpaceId: undefined,
      path: ['auth', 'User'],
    });
  });

  it('reads a colon-qualified contract-space type', () => {
    const { fields, sourceFile } = parseModelFields('  user supabase:auth.User');
    const result = readFieldTypeAnnotation(fields[0]!, sourceFile);
    if (!result.ok) throw new Error('expected ok');
    expect(result.annotation).toMatchObject({
      typeName: 'User',
      typeNamespaceId: 'auth',
      typeContractSpaceId: 'supabase',
      path: ['supabase', 'auth', 'User'],
    });
  });

  it('signals a malformed over-qualified type without throwing', () => {
    const { fields, sourceFile } = parseModelFields('  bar a.b.c');
    const result = readFieldTypeAnnotation(fields[0]!, sourceFile);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected malformed');
    expect(result.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    expect(result.range.start.line).toBeGreaterThanOrEqual(0);
  });

  it('reads a constructor type', () => {
    const { fields, sourceFile } = parseModelFields('  embedding Vector(1536)');
    const result = readFieldTypeAnnotation(fields[0]!, sourceFile);
    if (!result.ok) throw new Error('expected ok');
    expect(result.annotation.isConstructor).toBe(true);
    expect(result.annotation.typeName).toBe('Vector');
  });
});

describe('readAttribute — name + argument rendering parity', () => {
  function fieldAttribute(body: string) {
    const { fields, sourceFile } = parseModelFields(`  ${body}`);
    const attr = Array.from(fields[0]!.attributes())[0]!;
    return readAttribute(attr, sourceFile);
  }

  function modelAttribute(decl: string) {
    const { document, sourceFile } = parse(`model M {\n  id Int @id\n${decl}\n}`);
    const model = firstModel(document);
    const attr = Array.from(model.attributes())[0]!;
    return readAttribute(attr, sourceFile);
  }

  it('renders a dotted attribute name without the @ prefix', () => {
    const attribute = fieldAttribute('value String @db.VarChar(255)');
    expect(attribute.name).toBe('db.VarChar');
  });

  it('renders a bare attribute name', () => {
    const attribute = fieldAttribute('id Int @id');
    expect(attribute.name).toBe('id');
    expect(attribute.args).toEqual([]);
  });

  it('renders a positional quoted-string argument verbatim with quotes', () => {
    const attribute = fieldAttribute('name String @map("user_name")');
    expect(attribute.args).toHaveLength(1);
    expect(attribute.args[0]).toMatchObject({ kind: 'positional', value: '"user_name"' });
  });

  it('renders a positional number argument verbatim', () => {
    const attribute = fieldAttribute('value String @db.VarChar(255)');
    expect(attribute.args[0]).toMatchObject({ kind: 'positional', value: '255' });
  });

  it('renders a named argument with its name and rendered value', () => {
    const attribute = modelAttribute('  @@index([id], map: "idx_id")');
    const named = attribute.args.find((arg) => arg.kind === 'named');
    expect(named).toMatchObject({ kind: 'named', name: 'map', value: '"idx_id"' });
  });

  it('renders a function-call argument verbatim', () => {
    const attribute = fieldAttribute('id String @default(uuid(7))');
    expect(attribute.args[0]).toMatchObject({ kind: 'positional', value: 'uuid(7)' });
  });

  it('renders an array-literal argument verbatim', () => {
    const attribute = modelAttribute('  @@index([firstName, lastName])');
    expect(attribute.args[0]).toMatchObject({
      kind: 'positional',
      value: '[firstName, lastName]',
    });
  });

  it('renders an object-literal argument verbatim', () => {
    const attribute = modelAttribute(
      '  @@index([title], type: BTree, options: { tokenizer: "ngram" })',
    );
    const options = attribute.args.find((arg) => arg.kind === 'named' && arg.name === 'options');
    expect(options).toMatchObject({
      kind: 'named',
      name: 'options',
      value: '{ tokenizer: "ngram" }',
    });
  });

  it('renders positional and named args together in order', () => {
    const attribute = modelAttribute('  @@index([id], map: "x")');
    expect(attribute.args.map((arg) => arg.kind)).toEqual(['positional', 'named']);
  });
});

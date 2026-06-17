import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { parse, resolve } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { fieldTypeName } from '../src/psl-resolved-reader';
import { sqlScalarTypes } from './fixtures';

function parseAndResolve(schema: string) {
  const { document, sourceFile } = parse(schema);
  return resolve(document, sourceFile, {
    scalarTypes: sqlScalarTypes,
    defaultNamespaceId: 'public',
  });
}

function field(schema: string, model: string, fieldName: string) {
  const resolved = parseAndResolve(schema);
  const ns = resolved.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID);
  const target = ns?.models.get(model)?.fields.get(fieldName);
  if (!target) throw new Error(`field ${model}.${fieldName} not found`);
  return target;
}

describe('fieldTypeName', () => {
  it('returns the scalar name for scalar fields', () => {
    const schema = 'model User { id Int @id name String }';
    expect(fieldTypeName(field(schema, 'User', 'name'))).toBe('String');
    expect(fieldTypeName(field(schema, 'User', 'id'))).toBe('Int');
  });

  it('returns the decl name for a ref field', () => {
    const schema = `
      model Post {
        id Int @id
        authorId Int
        author User @relation(fields: [authorId], references: [id])
      }
      model User { id Int @id posts Post[] }
    `;
    expect(fieldTypeName(field(schema, 'Post', 'author'))).toBe('User');
  });

  it('returns the written type name for an unresolved reference', () => {
    const schema = 'model User { id Int @id data Ghost }';
    expect(fieldTypeName(field(schema, 'User', 'data'))).toBe('Ghost');
  });

  it('returns the dot-joined path for a constructor reference', () => {
    const schema = 'model Embedding { id Int @id vec Vector(1536) }';
    expect(fieldTypeName(field(schema, 'Embedding', 'vec'))).toBe('Vector');
  });
});

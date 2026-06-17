import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { parse, resolve } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  argText,
  classifyTypeTarget,
  fieldTypeName,
  getAttribute,
  getNamedArgText,
  namedTypes,
  namespacesOf,
} from '../src/resolved-read-shims';

function parseAndResolve(schema: string) {
  const { document, sourceFile } = parse(schema);
  return resolve(document, sourceFile);
}

describe('namespacesOf', () => {
  it('returns a ReadonlyMap keyed by namespace id', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
      }
    `);
    const ns = namespacesOf(resolved);
    expect(ns).toBeInstanceOf(Map);
    expect(ns.has(UNSPECIFIED_PSL_NAMESPACE_ID)).toBe(true);
  });

  it('includes explicit namespace blocks', () => {
    const resolved = parseAndResolve(`
      namespace auth {
        model User {
          id Int @id
        }
      }
    `);
    const ns = namespacesOf(resolved);
    expect(ns.has('auth')).toBe(true);
  });

  it('includes models and compositeTypes maps within a namespace', () => {
    const resolved = parseAndResolve(`
      model Post {
        id Int @id
        title String
      }
      type Address {
        street String
      }
    `);
    const ns = namespacesOf(resolved);
    const unspecified = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(unspecified).toBeDefined();
    expect(unspecified?.models.has('Post')).toBe(true);
    expect(unspecified?.compositeTypes.has('Address')).toBe(true);
  });

  it('routes an enum block with no registered descriptor to an unsupported-block diagnostic', () => {
    const resolved = parseAndResolve(`
      enum Role {
        ADMIN
        USER
      }
    `);
    const unspecified = namespacesOf(resolved).get(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(unspecified?.enums.has('Role')).toBe(false);
    expect(unspecified?.extensionBlocks.has('Role')).toBe(false);
    expect(resolved.diagnostics.map((d) => d.code)).toContain('PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
  });
});

describe('namedTypes', () => {
  it('returns an empty map when no types block exists', () => {
    const resolved = parseAndResolve(`
      model User { id Int @id }
    `);
    expect(namedTypes(resolved).size).toBe(0);
  });

  it('returns entries for each named type declaration', () => {
    const resolved = parseAndResolve(`
      types {
        MyId String
      }
    `);
    const nt = namedTypes(resolved);
    expect(nt.has('MyId')).toBe(true);
  });
});

describe('classifyTypeTarget', () => {
  it('classifies a built-in scalar field', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
        name String
      }
    `);
    const ns = namespacesOf(resolved);
    const user = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('User')!;
    const nameField = user.fields.get('name')!;
    const result = classifyTypeTarget(nameField.type.target);
    expect(result).toEqual({ kind: 'scalar', name: 'String' });
  });

  it('classifies a same-namespace ref field', () => {
    const resolved = parseAndResolve(`
      model Post {
        id Int @id
        authorId Int
        author User @relation(fields: [authorId], references: [id])
      }
      model User {
        id Int @id
        posts Post[]
      }
    `);
    const ns = namespacesOf(resolved);
    const post = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('Post')!;
    const authorField = post.fields.get('author')!;
    const result = classifyTypeTarget(authorField.type.target);
    expect(result).toEqual({
      kind: 'ref',
      coord: { kind: 'model', namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID, name: 'User' },
    });
  });

  it('classifies a cross-namespace qualified ref field', () => {
    const resolved = parseAndResolve(`
      namespace auth {
        model User {
          id Int @id
        }
      }
      model Post {
        id Int @id
        authorId Int
        author auth.User @relation(fields: [authorId], references: [id])
      }
    `);
    const ns = namespacesOf(resolved);
    const post = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('Post')!;
    const authorField = post.fields.get('author')!;
    const result = classifyTypeTarget(authorField.type.target);
    expect(result).toEqual({
      kind: 'ref',
      coord: { kind: 'model', namespaceId: 'auth', name: 'User' },
    });
  });

  it('classifies a crossSpace type reference', () => {
    const resolved = parseAndResolve(`
      model Post {
        id Int @id
        authorId Int
        author supabase:auth.User @relation(fields: [authorId], references: [id])
      }
    `);
    const ns = namespacesOf(resolved);
    const post = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('Post')!;
    const authorField = post.fields.get('author')!;
    const result = classifyTypeTarget(authorField.type.target);
    expect(result).toEqual({
      kind: 'crossSpace',
      spaceId: 'supabase',
      namespaceId: 'auth',
      typeName: 'User',
    });
  });

  it('classifies a constructor type reference', () => {
    const resolved = parseAndResolve(`
      model Embedding {
        id Int @id
        vec Vector(1536)
      }
    `);
    const ns = namespacesOf(resolved);
    const embedding = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('Embedding')!;
    const vecField = embedding.fields.get('vec')!;
    const result = classifyTypeTarget(vecField.type.target);
    expect(result.kind).toBe('constructor');
    if (result.kind !== 'constructor') throw new Error('expected constructor');
    expect(result.path).toEqual(['Vector']);
  });

  it('classifies an unresolved type reference', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
        data UnknownType
      }
    `);
    const ns = namespacesOf(resolved);
    const user = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('User')!;
    const dataField = user.fields.get('data')!;
    const result = classifyTypeTarget(dataField.type.target);
    expect(result).toEqual({ kind: 'unresolved', typeName: 'UnknownType' });
  });
});

describe('fieldTypeName', () => {
  it('returns the scalar name for scalar fields', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
        name String
      }
    `);
    const ns = namespacesOf(resolved);
    const user = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('User')!;
    expect(fieldTypeName(user.fields.get('name')!)).toBe('String');
    expect(fieldTypeName(user.fields.get('id')!)).toBe('Int');
  });

  it('returns the decl name for a ref field', () => {
    const resolved = parseAndResolve(`
      model Post {
        id Int @id
        authorId Int
        author User @relation(fields: [authorId], references: [id])
      }
      model User {
        id Int @id
        posts Post[]
      }
    `);
    const ns = namespacesOf(resolved);
    const post = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('Post')!;
    expect(fieldTypeName(post.fields.get('author')!)).toBe('User');
  });

  it('returns the typeName for an unresolved reference', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
        data Ghost
      }
    `);
    const ns = namespacesOf(resolved);
    const user = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('User')!;
    expect(fieldTypeName(user.fields.get('data')!)).toBe('Ghost');
  });
});

describe('getAttribute', () => {
  it('returns undefined when the attribute does not exist', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
        name String
      }
    `);
    const ns = namespacesOf(resolved);
    const user = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('User')!;
    const nameField = user.fields.get('name')!;
    expect(getAttribute(nameField.attributes, 'map')).toBeUndefined();
  });

  it('finds an attribute by name', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
        name String @map("user_name")
      }
    `);
    const ns = namespacesOf(resolved);
    const user = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('User')!;
    const nameField = user.fields.get('name')!;
    const mapAttr = getAttribute(nameField.attributes, 'map');
    expect(mapAttr).toBeDefined();
    expect(mapAttr?.name).toBe('map');
  });
});

describe('argText', () => {
  it('returns the raw source text of a positional argument expression', () => {
    const resolved = parseAndResolve(`
      model User {
        id Int @id
        name String @map("user_name")
      }
    `);
    const ns = namespacesOf(resolved);
    const user = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('User')!;
    const nameField = user.fields.get('name')!;
    const mapAttr = getAttribute(nameField.attributes, 'map')!;
    const arg = mapAttr.positionalArg(0)!;
    expect(argText(arg)).toBe('"user_name"');
  });
});

describe('getNamedArgText', () => {
  it('returns undefined when the named arg is absent', () => {
    const resolved = parseAndResolve(`
      model Post {
        id Int @id
        authorId Int
        author User @relation(fields: [authorId], references: [id])
      }
      model User {
        id Int @id
        posts Post[]
      }
    `);
    const ns = namespacesOf(resolved);
    const post = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('Post')!;
    const authorField = post.fields.get('author')!;
    const relationAttr = getAttribute(authorField.attributes, 'relation')!;
    expect(getNamedArgText(relationAttr, 'name')).toBeUndefined();
  });

  it('returns raw text of a named argument', () => {
    const resolved = parseAndResolve(`
      model Post {
        id Int @id
        authorId Int
        author User @relation(name: "PostAuthor", fields: [authorId], references: [id])
      }
      model User {
        id Int @id
        posts Post[]
      }
    `);
    const ns = namespacesOf(resolved);
    const post = ns.get(UNSPECIFIED_PSL_NAMESPACE_ID)!.models.get('Post')!;
    const authorField = post.fields.get('author')!;
    const relationAttr = getAttribute(authorField.attributes, 'relation')!;
    expect(getNamedArgText(relationAttr, 'name')).toBe('"PostAuthor"');
  });
});

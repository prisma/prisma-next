import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  type ResolvedAttribute,
  type ResolvedDocument,
  type ResolvedFieldType,
  type ResolvedNamespace,
  resolve,
  type TypeTarget,
} from '../src/resolve';
import {
  CompositeTypeDeclarationAst,
  EnumDeclarationAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
} from '../src/syntax/ast/declarations';

function resolveSource(source: string): ResolvedDocument {
  return resolve(parse(source).document);
}

function namespace(doc: ResolvedDocument, id: string): ResolvedNamespace {
  const ns = doc.namespaces.get(id);
  if (!ns) throw new Error(`namespace ${id} not found`);
  return ns;
}

function fieldTarget(
  doc: ResolvedDocument,
  namespaceId: string,
  modelName: string,
  fieldName: string,
): TypeTarget {
  const model = namespace(doc, namespaceId).models.get(modelName);
  const field = model?.fields.get(fieldName);
  if (!field) throw new Error(`field ${modelName}.${fieldName} not found`);
  return field.type.target;
}

function fieldType(
  doc: ResolvedDocument,
  namespaceId: string,
  modelName: string,
  fieldName: string,
): ResolvedFieldType {
  const model = namespace(doc, namespaceId).models.get(modelName);
  const field = model?.fields.get(fieldName);
  if (!field) throw new Error(`field ${modelName}.${fieldName} not found`);
  return field.type;
}

describe('resolve', () => {
  describe('whole resolved shape over a representative schema', () => {
    const source = `
namespace auth {
  model User {
    id    String @id
    email Email
    posts blog.Post[]
  }

  enum Role {
    ADMIN
    MEMBER
  }
}

namespace blog {
  model Post {
    id       String @id
    author   auth.User @relation(fields: [authorId], references: [id])
    authorId String
    owner    space:auth.User
    vec      Vector(1536)
    ghost    Mystery
  }

  type Metadata {
    slug String
  }
}

types {
  Email = String
}
`;

    it('keys declarations by name within each namespace in source order', () => {
      const doc = resolveSource(source);
      expect([...doc.namespaces.keys()]).toEqual(['auth', 'blog']);
      expect([...namespace(doc, 'auth').models.keys()]).toEqual(['User']);
      expect([...namespace(doc, 'auth').enums.keys()]).toEqual(['Role']);
      expect([...namespace(doc, 'blog').models.keys()]).toEqual(['Post']);
      expect([...namespace(doc, 'blog').compositeTypes.keys()]).toEqual(['Metadata']);
      expect([...doc.namedTypes.keys()]).toEqual(['Email']);
    });

    it('preserves field/value insertion order', () => {
      const doc = resolveSource(source);
      expect([...namespace(doc, 'blog').models.get('Post')!.fields.keys()]).toEqual([
        'id',
        'author',
        'authorId',
        'owner',
        'vec',
        'ghost',
      ]);
      expect([...namespace(doc, 'auth').enums.get('Role')!.values.keys()]).toEqual([
        'ADMIN',
        'MEMBER',
      ]);
    });

    it('resolves a scalar field to a scalar target', () => {
      expect(fieldTarget(resolveSource(source), 'auth', 'User', 'id')).toEqual({
        kind: 'scalar',
        name: 'String',
      });
    });

    it('resolves a named-type alias reference to a namedType ref coordinate', () => {
      expect(fieldTarget(resolveSource(source), 'auth', 'User', 'email')).toEqual({
        kind: 'ref',
        coord: { kind: 'namedType', namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID, name: 'Email' },
      });
    });

    it('records the named-type alias target without inlining it', () => {
      const alias = resolveSource(source).namedTypes.get('Email');
      expect(alias?.target).toEqual({ kind: 'scalar', name: 'String' });
    });

    it('resolves a qualified cross-namespace model reference to its declaring namespace', () => {
      expect(fieldTarget(resolveSource(source), 'blog', 'Post', 'author')).toEqual({
        kind: 'ref',
        coord: { kind: 'model', namespaceId: 'auth', name: 'User' },
      });
    });

    it('resolves a cross-space reference to a crossSpace target carrying no DeclKind', () => {
      const target = fieldTarget(resolveSource(source), 'blog', 'Post', 'owner');
      expect(target).toEqual({
        kind: 'crossSpace',
        spaceId: 'space',
        namespaceId: 'auth',
        typeName: 'User',
      });
      expect(target).not.toHaveProperty('coord');
    });

    it('resolves a constructor type to a constructor target', () => {
      const target = fieldTarget(resolveSource(source), 'blog', 'Post', 'vec');
      expect(target.kind).toBe('constructor');
      if (target.kind !== 'constructor') throw new Error('expected constructor');
      expect(target.path).toEqual(['Vector']);
      expect(target.args).toHaveLength(1);
      expect(target.args[0]?.syntax.kind).toBe('NumberLiteralExpr');
    });

    it('resolves a dangling reference to an unresolved target plus a diagnostic', () => {
      const doc = resolveSource(source);
      expect(fieldTarget(doc, 'blog', 'Post', 'ghost')).toEqual({
        kind: 'unresolved',
        typeName: 'Mystery',
      });
      expect(doc.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_TYPE_REFERENCE',
          message: 'Type "Mystery" does not resolve to a known declaration',
        }),
      );
    });

    it('does not flag the cross-space reference as unresolved', () => {
      const doc = resolveSource(source);
      for (const diagnostic of doc.diagnostics) {
        expect(diagnostic.message).not.toContain('User');
      }
    });

    it('carries list and optional modifiers on the field type', () => {
      const postsType = fieldType(resolveSource(source), 'auth', 'User', 'posts');
      expect(postsType.list).toBe(true);
      expect(postsType.optional).toBe(false);
      expect(postsType.target).toEqual({
        kind: 'ref',
        coord: { kind: 'model', namespaceId: 'blog', name: 'Post' },
      });
    });

    it('keeps CST back-pointers on resolved entities', () => {
      const doc = resolveSource(source);
      expect(namespace(doc, 'auth').models.get('User')!.syntax).toBeInstanceOf(ModelDeclarationAst);
      expect(namespace(doc, 'auth').enums.get('Role')!.syntax).toBeInstanceOf(EnumDeclarationAst);
      expect(namespace(doc, 'blog').compositeTypes.get('Metadata')!.syntax).toBeInstanceOf(
        CompositeTypeDeclarationAst,
      );
      expect(doc.namedTypes.get('Email')!.syntax).toBeInstanceOf(NamedTypeDeclarationAst);
    });

    it('never throws on this schema', () => {
      expect(() => resolveSource(source)).not.toThrow();
    });
  });

  describe('bare-name resolution is scoped to the referrer and ambient namespaces', () => {
    const source = `
namespace auth {
  model Token {
    id String @id
  }

  model Session {
    id String @id
  }
}

namespace billing {
  model Token {
    id String @id
  }

  model Invoice {
    id      String @id
    token   Token
    session Session
  }
}
`;

    it('resolves a bare reference to a same-named declaration in the referrer namespace, not the first document-wide match', () => {
      expect(fieldTarget(resolveSource(source), 'billing', 'Invoice', 'token')).toEqual({
        kind: 'ref',
        coord: { kind: 'model', namespaceId: 'billing', name: 'Token' },
      });
    });

    it('does not resolve a bare reference into another named namespace; it is unresolved with a qualify hint', () => {
      const doc = resolveSource(source);
      expect(fieldTarget(doc, 'billing', 'Invoice', 'session')).toEqual({
        kind: 'unresolved',
        typeName: 'Session',
      });
      expect(doc.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_TYPE_REFERENCE',
          message:
            'Type "Session" does not resolve to a known declaration; did you mean "auth.Session"?',
        }),
      );
    });

    it('resolves a bare reference into another named namespace once it is qualified', () => {
      const qualified = source.replace('session Session', 'session auth.Session');
      expect(fieldTarget(resolveSource(qualified), 'billing', 'Invoice', 'session')).toEqual({
        kind: 'ref',
        coord: { kind: 'model', namespaceId: 'auth', name: 'Session' },
      });
    });
  });

  describe('bare-name resolution reaches the ambient top-level namespace', () => {
    const source = `
model AuditLog {
  id String @id
}

namespace billing {
  model Invoice {
    id    String @id
    audit AuditLog
  }
}
`;

    it('resolves a namespaced bare reference to a top-level un-namespaced declaration', () => {
      expect(fieldTarget(resolveSource(source), 'billing', 'Invoice', 'audit')).toEqual({
        kind: 'ref',
        coord: { kind: 'model', namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID, name: 'AuditLog' },
      });
    });
  });

  describe('bare-name require-qualification error', () => {
    const source = `
namespace auth {
  model Account {
    id String @id
  }
}

namespace billing {
  model Invoice {
    id      String @id
    account Account
  }
}
`;

    it('leaves a bare reference to an only-other-named-namespace declaration unresolved', () => {
      const doc = resolveSource(source);
      expect(fieldTarget(doc, 'billing', 'Invoice', 'account')).toEqual({
        kind: 'unresolved',
        typeName: 'Account',
      });
    });

    it('hints at the qualified spelling that would resolve', () => {
      const doc = resolveSource(source);
      expect(doc.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_TYPE_REFERENCE',
          message:
            'Type "Account" does not resolve to a known declaration; did you mean "auth.Account"?',
        }),
      );
    });
  });

  describe('attribute accessors', () => {
    const source = `
model User {
  id   String @id
  name String @map("user_name")
  tag  String @db.VarChar(255)
}
`;

    function attr(name: string): ResolvedAttribute {
      const doc = resolve(parse(source).document);
      const field = namespace(doc, UNSPECIFIED_PSL_NAMESPACE_ID)
        .models.get('User')!
        .fields.get('name')!;
      const found = field.attributes.find((a) => a.name === name);
      if (!found) throw new Error(`attribute ${name} not found`);
      return found;
    }

    it('exposes the attribute name and a positional-arg accessor over CST expressions', () => {
      const map = attr('map');
      expect(map.name).toBe('map');
      expect(map.positionalArg(0)?.syntax.kind).toBe('StringLiteralExpr');
      expect(map.positionalArg(1)).toBeUndefined();
    });

    it('reads a positional string-literal argument as its unquoted value', () => {
      expect(attr('map').stringArg(0)).toBe('user_name');
    });

    it('exposes dotted attribute names structurally', () => {
      const doc = resolve(parse(source).document);
      const tag = namespace(doc, UNSPECIFIED_PSL_NAMESPACE_ID)
        .models.get('User')!
        .fields.get('tag')!;
      const dbAttr = tag.attributes.find((a) => a.name === 'db.VarChar');
      expect(dbAttr).toBeDefined();
      expect(dbAttr!.stringArg(0)).toBeUndefined();
    });
  });

  describe('duplicate declaration collision', () => {
    const source = `
model User {
  id String @id
}

model User {
  id String @id
}

model Account {
  owner User @relation(fields: [ownerId], references: [id])
  ownerId String
}
`;

    it('keeps the first declaration in the namespace map', () => {
      const doc = resolveSource(source);
      expect([...namespace(doc, UNSPECIFIED_PSL_NAMESPACE_ID).models.keys()]).toEqual([
        'User',
        'Account',
      ]);
    });

    it('emits a collision diagnostic for the duplicate', () => {
      const doc = resolveSource(source);
      expect(doc.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: 'Duplicate declaration "User" in this scope; the first declaration is used',
        }),
      );
    });

    it('still resolves a reference to the surviving declaration', () => {
      expect(
        fieldTarget(resolveSource(source), UNSPECIFIED_PSL_NAMESPACE_ID, 'Account', 'owner'),
      ).toEqual({
        kind: 'ref',
        coord: { kind: 'model', namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID, name: 'User' },
      });
    });

    it('never throws on duplicate declarations', () => {
      expect(() => resolveSource(source)).not.toThrow();
    });
  });

  describe('non-throwing on malformed input', () => {
    it('returns a ResolvedDocument for a broken schema', () => {
      const doc = resolve(parse('model {').document);
      expect(doc).toBeDefined();
      expect(doc.namespaces).toBeInstanceOf(Map);
    });

    it('resolves an empty document to an empty resolved view', () => {
      const doc = resolve(parse('').document);
      expect(doc.namespaces.size).toBe(0);
      expect(doc.namedTypes.size).toBe(0);
    });
  });
});

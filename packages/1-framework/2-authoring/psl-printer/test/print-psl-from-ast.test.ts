import type {
  PslAttribute,
  PslDocumentAst,
  PslEnum,
  PslNamedTypeDeclaration,
  PslSpan,
  PslTypesBlock,
} from '@prisma-next/framework-components/psl-ast';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';

function span(off: number): PslSpan {
  return {
    start: { offset: off, line: 1, column: off + 1 },
    end: { offset: off + 1, line: 1, column: off + 2 },
  };
}

function attr(
  target: PslAttribute['target'],
  name: string,
  args: PslAttribute['args'],
  off: number,
): PslAttribute {
  return { kind: 'attribute', target, name, args, span: span(off) };
}

describe('printPslFromAst', () => {
  it('prints model with @id field', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'X',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('model X {\n  id Int @id');
  });

  it('prints @@map on model', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'Foo',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
          ],
          attributes: [
            attr('model', 'map', [{ kind: 'positional', value: '"foo"', span: span(1) }], 2),
          ],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('@@map("foo")');
  });

  it('prints enum and field referencing enum type', () => {
    const roleEnum: PslEnum = {
      kind: 'enum',
      name: 'Role',
      values: [
        { kind: 'enumValue', name: 'Admin', span: span(0) },
        { kind: 'enumValue', name: 'User', span: span(1) },
      ],
      attributes: [],
      span: span(0),
    };

    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'User',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
            {
              kind: 'field',
              name: 'role',
              typeName: 'Role',
              optional: false,
              list: false,
              attributes: [],
              span: span(1),
            },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      enums: [roleEnum],
      compositeTypes: [],
      span: span(0),
    };

    const out = printPslFromAst(ast);
    expect(out).toContain('enum Role {');
    expect(out).toContain('role Role');
  });

  it('prints types block', () => {
    const named: PslNamedTypeDeclaration = {
      kind: 'namedType',
      name: 'Money',
      baseType: 'Decimal',
      attributes: [],
      span: span(0),
    };
    const typesBlock: PslTypesBlock = {
      kind: 'types',
      declarations: [named],
      span: span(0),
    };
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [],
      enums: [],
      compositeTypes: [],
      types: typesBlock,
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('types {\n  Money = Decimal');
  });

  it('prints relation field with @relation', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'Post',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
            {
              kind: 'field',
              name: 'authorId',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [],
              span: span(1),
            },
            {
              kind: 'field',
              name: 'author',
              typeName: 'User',
              optional: false,
              list: false,
              attributes: [
                attr(
                  'field',
                  'relation',
                  [
                    {
                      kind: 'named',
                      name: 'fields',
                      value: '[authorId]',
                      span: span(2),
                    },
                    {
                      kind: 'named',
                      name: 'references',
                      value: '[id]',
                      span: span(3),
                    },
                  ],
                  4,
                ),
              ],
              span: span(5),
            },
          ],
          attributes: [],
          span: span(0),
        },
        {
          kind: 'model',
          name: 'User',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
            {
              kind: 'field',
              name: 'posts',
              typeName: 'Post',
              optional: false,
              list: true,
              attributes: [],
              span: span(1),
            },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };

    expect(printPslFromAst(ast)).toContain('@relation(fields: [authorId], references: [id])');
  });

  it('prints empty model', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [{ kind: 'model', name: 'Empty', fields: [], attributes: [], span: span(0) }],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toMatch(/model Empty \{\s*\}/s);
  });

  it('prints model with only model-level attributes', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'OnlyAttrs',
          fields: [],
          attributes: [
            attr('model', 'index', [{ kind: 'positional', value: '[a]', span: span(0) }], 1),
          ],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('@@index([a])');
  });

  it('handles multiple enums with overlapping member display names via parser normalisation', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [],
      enums: [
        {
          kind: 'enum',
          name: 'StatusA',
          values: [{ kind: 'enumValue', name: 'ok', span: span(0) }],
          attributes: [],
          span: span(0),
        },
        {
          kind: 'enum',
          name: 'StatusB',
          values: [{ kind: 'enumValue', name: 'ok', span: span(1) }],
          attributes: [],
          span: span(0),
        },
      ],
      compositeTypes: [],
      span: span(0),
    };
    const text = printPslFromAst(ast);
    expect(text).toContain('enum StatusA');
    expect(text).toContain('enum StatusB');
  });

  it('renders @@map on enum', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [],
      enums: [
        {
          kind: 'enum',
          name: 'Status',
          values: [{ kind: 'enumValue', name: 'Ok', span: span(0) }],
          attributes: [
            attr('enum', 'map', [{ kind: 'positional', value: '"db_status"', span: span(1) }], 2),
          ],
          span: span(0),
        },
      ],
      compositeTypes: [],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('enum Status');
    expect(out).toContain('@@map("db_status")');
  });

  it('normalises enum members with non-identifier characters and reserved words', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [],
      enums: [
        {
          kind: 'enum',
          name: 'Mixed',
          values: [
            { kind: 'enumValue', name: 'in-progress', span: span(0) },
            { kind: 'enumValue', name: '123leading', span: span(1) },
            { kind: 'enumValue', name: 'enum', span: span(2) },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      compositeTypes: [],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('inProgress');
    expect(out).toContain('_123leading');
    expect(out).toContain('_enum');
  });

  it('appends a numeric suffix to duplicate normalised enum member names', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [],
      enums: [
        {
          kind: 'enum',
          name: 'Dupes',
          values: [
            { kind: 'enumValue', name: 'foo bar', span: span(0) },
            { kind: 'enumValue', name: 'foo-bar', span: span(1) },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      compositeTypes: [],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toMatch(/fooBar\b/);
    expect(out).toMatch(/fooBar2\b/);
  });

  it('renders optional and list type modifiers, plus @map on field', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'Doc',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
            {
              kind: 'field',
              name: 'nickname',
              typeName: 'String',
              optional: true,
              list: false,
              attributes: [
                attr(
                  'field',
                  'map',
                  [{ kind: 'positional', value: '"nick_name"', span: span(1) }],
                  2,
                ),
              ],
              span: span(0),
            },
            {
              kind: 'field',
              name: 'tags',
              typeName: 'String',
              optional: false,
              list: true,
              attributes: [],
              span: span(0),
            },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toMatch(/nickname String\?\s+@map\("nick_name"\)/);
    expect(out).toMatch(/tags\s+String\[\]/);
  });

  it('renders model with both fields and model-level attributes (separator blank line)', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'WithAttrs',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
          ],
          attributes: [
            attr('model', 'index', [{ kind: 'positional', value: '[id]', span: span(1) }], 2),
          ],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('  id Int @id');
    expect(out).toContain('  @@index([id])');
    expect(out).toMatch(/ {2}id Int @id\n\n {2}@@index/);
  });

  it('renders model with leading comment and per-field comment', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'Audit',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [attr('field', 'id', [], 0)],
              span: span(0),
            },
          ],
          attributes: [],
          span: span(0),
          comment: '// WARNING: legacy table',
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('// WARNING: legacy table');
    expect(out).toMatch(/\/\/ WARNING: legacy table\nmodel Audit \{/);
  });

  it('renders types block with attributes on a named type', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [],
      enums: [],
      compositeTypes: [],
      types: {
        kind: 'types',
        declarations: [
          {
            kind: 'namedType',
            name: 'Email',
            baseType: 'String',
            attributes: [
              attr(
                'namedType',
                'check',
                [{ kind: 'positional', value: '"len > 0"', span: span(0) }],
                1,
              ),
            ],
            span: span(0),
          },
        ],
        span: span(0),
      },
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('Email = String @check("len > 0")');
  });

  it('renders field type with a typeConstructor (e.g. Money(2))', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'Account',
          fields: [
            {
              kind: 'field',
              name: 'balance',
              typeName: 'Decimal',
              typeConstructor: {
                kind: 'typeConstructor',
                path: ['Money'],
                args: [{ kind: 'positional', value: '2', span: span(0) }],
                span: span(0),
              },
              optional: false,
              list: false,
              attributes: [],
              span: span(0),
            },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('balance Money(2)');
  });

  it('renders typeConstructor with no arguments (just a path)', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [],
      enums: [],
      compositeTypes: [],
      types: {
        kind: 'types',
        declarations: [
          {
            kind: 'namedType',
            name: 'Plain',
            typeConstructor: {
              kind: 'typeConstructor',
              path: ['Json'],
              args: [],
              span: span(0),
            },
            attributes: [],
            span: span(0),
          },
        ],
        span: span(0),
      },
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('Plain = Json');
  });

  it('does not treat empty type-name strings as relations during topological sort', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      models: [
        {
          kind: 'model',
          name: 'Edge',
          fields: [
            {
              kind: 'field',
              name: 'phantom',
              typeName: '',
              optional: false,
              list: false,
              attributes: [],
              span: span(0),
            },
          ],
          attributes: [],
          span: span(0),
        },
      ],
      enums: [],
      compositeTypes: [],
      span: span(0),
    };
    expect(() => printPslFromAst(ast)).not.toThrow();
  });

  it('parser → printer → parser round-trip for a small schema', () => {
    const source = `// This file was introspected from the database. Do not edit manually.

model User {
  id    Int    @id
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
}`;
    const parsed1 = parsePslDocument({ schema: source, sourceId: 'r' });
    expect(parsed1.ok).toBe(true);
    const printed = printPslFromAst(parsed1.ast);
    const parsed2 = parsePslDocument({ schema: printed, sourceId: 'r2' });
    expect(parsed2.ok).toBe(true);
    expect(parsed2.ast.models.length).toBe(parsed1.ast.models.length);
    expect(parsed2.ast.models.map((m) => m.name).sort()).toEqual(
      parsed1.ast.models.map((m) => m.name).sort(),
    );
  });
});

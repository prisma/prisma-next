import { parsePslDocument } from '@prisma-next/psl-parser';
import type {
  PslAttribute,
  PslDocumentAst,
  PslEnum,
  PslNamedTypeDeclaration,
  PslSpan,
  PslTypesBlock,
} from '@prisma-next/psl-types';
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

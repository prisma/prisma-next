import type {
  PslAttribute,
  PslDocumentAst,
  PslEnum,
  PslNamedTypeDeclaration,
  PslSpan,
  PslTypesBlock,
} from '@prisma-next/framework-components/psl-ast';
import {
  flatPslEnums,
  flatPslModels,
  UNSPECIFIED_PSL_NAMESPACE_ID,
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('model X {\n  id Int @id');
  });

  it('prints @@map on model', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
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
      namespaces: [],
      types: typesBlock,
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('types {\n  Money = Decimal');
  });

  it('prints relation field with @relation', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };

    expect(printPslFromAst(ast)).toContain('@relation(fields: [authorId], references: [id])');
  });

  it('prints empty model', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
          models: [{ kind: 'model', name: 'Empty', fields: [], attributes: [], span: span(0) }],
          enums: [],
          compositeTypes: [],
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toMatch(/model Empty \{\s*\}/s);
  });

  it('prints model with only model-level attributes', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('@@index([a])');
  });

  it('handles multiple enums with overlapping member display names via parser normalisation', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
          models: [],
          enums: [
            {
              kind: 'enum',
              name: 'Status',
              values: [{ kind: 'enumValue', name: 'Ok', span: span(0) }],
              attributes: [
                attr(
                  'enum',
                  'map',
                  [{ kind: 'positional', value: '"db_status"', span: span(1) }],
                  2,
                ),
              ],
              span: span(0),
            },
          ],
          compositeTypes: [],
          packBlocks: [],
          span: span(0),
        },
      ],
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    // Each normalised member preserves the original storage label via
    // `@map(...)` so the round-trip (parse → print → parse) does not lose
    // the database-side spelling — see the dedicated round-trip test below.
    expect(out).toContain('inProgress @map("in-progress")');
    expect(out).toContain('_123leading @map("123leading")');
    expect(out).toContain('_enum @map("enum")');
  });

  it('appends a numeric suffix to duplicate normalised enum member names', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    // The first member keeps the camelCased identifier; the colliding second
    // member is suffixed with `2`. Both carry an `@map(...)` to preserve their
    // distinct original storage labels.
    expect(out).toContain('fooBar @map("foo bar")');
    expect(out).toContain('fooBar2 @map("foo-bar")');
  });

  it('preserves normalised enum members across a parser → printer → parser round-trip', () => {
    // Regression for the previously-lossy `serializeEnum` codepath. Postgres
    // enum labels often contain hyphens (`'in-progress'`), reserved PSL words
    // (`'enum'`), or leading digits (`'2x'`) — all of which the printer
    // normalises into a valid PSL identifier on emission. Without the
    // per-member `@map(...)`, parsing the emitted PSL would lose the original
    // storage label and a subsequent `contract emit` would talk to the wrong
    // value in the live database.
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
          models: [],
          enums: [
            {
              kind: 'enum',
              name: 'Status',
              values: [
                { kind: 'enumValue', name: 'in-progress', span: span(0) },
                { kind: 'enumValue', name: 'enum', span: span(1) },
                { kind: 'enumValue', name: 'done', span: span(2) },
              ],
              attributes: [],
              span: span(0),
            },
          ],
          compositeTypes: [],
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };

    const printed1 = printPslFromAst(ast);
    const parsed = parsePslDocument({ schema: printed1, sourceId: 'r' });
    expect(parsed.ok).toBe(true);

    const enumNode = flatPslEnums(parsed.ast).find((e) => e.name === 'Status');
    expect(enumNode).toBeDefined();
    const valueShapes = enumNode?.values.map((v) => ({ name: v.name, mapName: v.mapName }));
    expect(valueShapes).toEqual([
      { name: 'inProgress', mapName: 'in-progress' },
      { name: '_enum', mapName: 'enum' },
      { name: 'done', mapName: undefined },
    ]);

    // Printing the parsed AST again must produce identical output: the parser
    // captured `mapName`, the printer re-emits it verbatim.
    const printed2 = printPslFromAst(parsed.ast);
    expect(printed2).toBe(printed1);
  });

  it('renders optional and list type modifiers, plus @map on field', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
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
      namespaces: [],
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('balance Money(2)');
  });

  it('renders typeConstructor with no arguments (just a path)', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [],
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
      namespaces: [
        {
          kind: 'namespace',
          name: UNSPECIFIED_PSL_NAMESPACE_ID,
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
          packBlocks: [],
          span: span(0),
        },
      ],
      span: span(0),
    };
    expect(() => printPslFromAst(ast)).not.toThrow();
  });

  it('preserves @map values containing PSL escape sequences across parse → print round-trip', () => {
    // Regression for double-escape in `getPositionalStringArg`. The parser stores
    // a quoted-literal argument with PSL escape sequences (`\\`, `\"`, `\n`,
    // `\r`) intact; we must decode them once on extraction so that the printer's
    // `escapePslString` does not re-escape them on output.
    const source = `model Doc {
  id   Int    @id
  body String @map("with \\"quote\\" and \\\\backslash and \\nnewline")
}
`;
    const parsed1 = parsePslDocument({ schema: source, sourceId: 'r' });
    expect(parsed1.ok).toBe(true);
    const printed = printPslFromAst(parsed1.ast);
    const parsed2 = parsePslDocument({ schema: printed, sourceId: 'r2' });
    expect(parsed2.ok).toBe(true);

    const findMap = (ast: typeof parsed1.ast): string | undefined => {
      const model = flatPslModels(ast).find((m) => m.name === 'Doc');
      const field = model?.fields.find((f) => f.name === 'body');
      const mapAttr = field?.attributes.find((a) => a.name === 'map' && a.target === 'field');
      const positional = mapAttr?.args.find((a) => a.kind === 'positional');
      return positional?.value;
    };

    expect(findMap(parsed2.ast)).toBe(findMap(parsed1.ast));
  });

  it('parser → printer → parser round-trip for a small schema', () => {
    const source = `// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

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
    const models1 = flatPslModels(parsed1.ast);
    const models2 = flatPslModels(parsed2.ast);
    expect(models2.length).toBe(models1.length);
    expect(models2.map((m) => m.name).sort()).toEqual(models1.map((m) => m.name).sort());
  });

  describe('namespace blocks', () => {
    it('emits top-level declarations from the synthesised __unspecified__ bucket without a namespace wrapper', () => {
      const source = `model A {
  id Int @id
}
`;
      const parsed = parsePslDocument({ schema: source, sourceId: 'r' });
      expect(parsed.ok).toBe(true);
      const printed = printPslFromAst(parsed.ast);
      expect(printed).not.toMatch(/namespace\s+\w+\s*\{/);
      expect(printed).toContain('model A {');
    });

    it('emits a named namespace block wrapping its declarations', () => {
      const source = `namespace auth {
  model User {
    id Int @id
  }

  enum Role {
    ADMIN
    MEMBER
  }
}
`;
      const parsed = parsePslDocument({ schema: source, sourceId: 'r' });
      expect(parsed.ok).toBe(true);
      const printed = printPslFromAst(parsed.ast);
      expect(printed).toMatch(/namespace auth \{/);
      expect(printed).toMatch(/^ {2}model User \{/m);
      expect(printed).toMatch(/^ {2}enum Role \{/m);
      expect(printed.trimEnd().endsWith('}')).toBe(true);
    });

    it('round-trips a mixed top-level + namespaced schema through parser → printer → parser', () => {
      const source = `model TopLevel {
  id Int @id
}

namespace auth {
  model User {
    id Int @id
  }
}
`;
      const parsed1 = parsePslDocument({ schema: source, sourceId: 'r' });
      expect(parsed1.ok).toBe(true);
      const printed = printPslFromAst(parsed1.ast);
      const parsed2 = parsePslDocument({ schema: printed, sourceId: 'r2' });
      expect(parsed2.ok).toBe(true);
      expect(parsed2.ast.namespaces.map((ns) => ns.name).sort()).toEqual(
        parsed1.ast.namespaces.map((ns) => ns.name).sort(),
      );
      expect(
        flatPslModels(parsed2.ast)
          .map((m) => m.name)
          .sort(),
      ).toEqual(
        flatPslModels(parsed1.ast)
          .map((m) => m.name)
          .sort(),
      );
    });
  });

  describe('namespace ordering and escape handling', () => {
    it('sorts non-unspecified namespaces alphabetically', () => {
      const source =
        'namespace billing {\n  model Invoice {\n    id Int @id\n  }\n}\n\nnamespace auth {\n  model User {\n    id Int @id\n  }\n}\n';
      const parsed = parsePslDocument({ schema: source, sourceId: 't' });
      expect(parsed.ok).toBe(true);
      const printed = printPslFromAst(parsed.ast);
      expect(printed.indexOf('namespace auth')).toBeLessThan(printed.indexOf('namespace billing'));
    });

    it('decodes carriage-return and preserves unknown escape sequences in enum @@map values', () => {
      const source = `enum Status {\n  active\n  inactive\n\n  @@map("a\\rb\\zc")\n}\n`;
      const parsed = parsePslDocument({ schema: source, sourceId: 't' });
      expect(parsed.ok).toBe(true);
      const printed = printPslFromAst(parsed.ast);
      // Carriage return decodes to a literal CR (re-escapes to \r); the
      // unrecognised \z escape is preserved verbatim then re-escaped (so the
      // single backslash becomes \\). The exact bytes matter less than
      // exercising both branches of unescapePslString.
      expect(printed).toMatch(/@@map\("a\\rb\\\\zc"\)/);
    });
  });
});

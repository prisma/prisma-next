import type {
  PslAttribute,
  PslCompositeType,
  PslDocumentAst,
  PslModel,
  PslNamedTypeDeclaration,
  PslNamespace,
  PslSpan,
  PslTypesBlock,
} from '@prisma-next/framework-components/psl-ast';
import {
  flatPslModels,
  makePslNamespace,
  makePslNamespaceEntries,
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

function makeNs(
  name: string,
  models: PslModel[],
  compositeTypes: PslCompositeType[],
  off: number,
): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name,
    entries: makePslNamespaceEntries(models, compositeTypes, []),
    span: span(off),
  });
}

describe('printPslFromAst', () => {
  it('prints model with @id field', () => {
    const models: PslModel[] = [
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('model X {\n  id Int @id');
  });

  it('prints @@map on model', () => {
    const models: PslModel[] = [
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('@@map("foo")');
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

  it('preserves Prisma schema blocks and workflow member order', () => {
    const parsed = parsePslDocument({
      sourceId: 'schema.prisma',
      schema: `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

workflow OrderedReview {
  step draft {
    run = "./draft.ts"
  }

  approval approve {
    onApprove = submit
  }

  step submit {
    run = "./submit.ts"
  }
}
`,
    });

    expect(parsed.ok).toBe(true);

    const printed = printPslFromAst(parsed.ast);
    expect(printed).toContain('generator client {\n  provider = "prisma-client-js"\n}');
    expect(printed).toContain(
      'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}',
    );
    expect(printed.indexOf('step draft')).toBeLessThan(printed.indexOf('approval approve'));
    expect(printed.indexOf('approval approve')).toBeLessThan(printed.indexOf('step submit'));

    const reparsed = parsePslDocument({ sourceId: 'schema.prisma', schema: printed });
    expect(reparsed.ok).toBe(true);
    expect(reparsed.ast.workflows?.[0]?.members.map((member) => member.name)).toEqual([
      'draft',
      'approve',
      'submit',
    ]);
  });

  it('prints relation field with @relation', () => {
    const models: PslModel[] = [
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
                  { kind: 'named', name: 'fields', value: '[authorId]', span: span(2) },
                  { kind: 'named', name: 'references', value: '[id]', span: span(3) },
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };

    expect(printPslFromAst(ast)).toContain('@relation(fields: [authorId], references: [id])');
  });

  it('prints empty model', () => {
    const models: PslModel[] = [
      { kind: 'model', name: 'Empty', fields: [], attributes: [], span: span(0) },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toMatch(/model Empty \{\s*\}/s);
  });

  it('prints model with only model-level attributes', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'OnlyAttrs',
        fields: [],
        attributes: [
          attr('model', 'index', [{ kind: 'positional', value: '[a]', span: span(0) }], 1),
        ],
        span: span(0),
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('@@index([a])');
  });

  it('renders optional and list type modifiers, plus @map on field', () => {
    const models: PslModel[] = [
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toMatch(/nickname String\?\s+@map\("nick_name"\)/);
    expect(out).toMatch(/tags\s+String\[\]/);
  });

  it('renders model with both fields and model-level attributes (separator blank line)', () => {
    const models: PslModel[] = [
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('  id Int @id');
    expect(out).toContain('  @@index([id])');
    expect(out).toMatch(/ {2}id Int @id\n\n {2}@@index/);
  });

  it('renders model with leading comment and per-field comment', () => {
    const models: PslModel[] = [
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
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
    const models: PslModel[] = [
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
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
    const models: PslModel[] = [
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
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
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
    const source = `// use prisma-next
// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

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
  });

  describe('qualified field-type rendering', () => {
    // Helper: build a minimal AST with a single model containing one field.
    function astWithField(field: {
      name: string;
      typeName: string;
      typeNamespaceId?: string;
      typeContractSpaceId?: string;
    }): PslDocumentAst {
      return {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          makeNs(
            UNSPECIFIED_PSL_NAMESPACE_ID,
            [
              {
                kind: 'model',
                name: 'Profile',
                fields: [
                  {
                    kind: 'field',
                    name: field.name,
                    typeName: field.typeName,
                    typeNamespaceId: field.typeNamespaceId,
                    typeContractSpaceId: field.typeContractSpaceId,
                    optional: true,
                    list: false,
                    attributes: [],
                    span: span(0),
                  },
                ],
                attributes: [],
                span: span(0),
              },
            ],
            [],
            0,
          ),
        ],
        span: span(0),
      };
    }

    it('renders a bare typeName without any qualifier (no regression)', () => {
      const out = printPslFromAst(astWithField({ name: 'user', typeName: 'User' }));
      // The field line must not contain a colon-prefix or dot qualifier.
      const fieldLine = out.split('\n').find((l) => l.includes('user') && l.includes('User'));
      expect(fieldLine).toBeDefined();
      expect(fieldLine).not.toContain(':');
      expect(fieldLine).not.toContain('.');
    });

    it('renders typeNamespaceId + typeName as ns.Name — TML-2459 gap fix', () => {
      // Before the fix, auth.User round-tripped back to bare User (the namespace was dropped).
      const out = printPslFromAst(
        astWithField({ name: 'user', typeName: 'User', typeNamespaceId: 'auth' }),
      );
      expect(out).toMatch(/user\s+auth\.User\?/);
    });

    it('renders typeContractSpaceId + typeNamespaceId + typeName as space:ns.Name', () => {
      const out = printPslFromAst(
        astWithField({
          name: 'user',
          typeName: 'User',
          typeNamespaceId: 'auth',
          typeContractSpaceId: 'supabase',
        }),
      );
      expect(out).toMatch(/user\s+supabase:auth\.User\?/);
    });

    it('renders typeContractSpaceId + typeName (no namespace) as space:Name', () => {
      const out = printPslFromAst(
        astWithField({ name: 'user', typeName: 'User', typeContractSpaceId: 'supabase' }),
      );
      expect(out).toMatch(/user\s+supabase:User\?/);
    });

    it('does not affect typeConstructor rendering', () => {
      const ast: PslDocumentAst = {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          makeNs(
            UNSPECIFIED_PSL_NAMESPACE_ID,
            [
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
            [],
            0,
          ),
        ],
        span: span(0),
      };
      expect(printPslFromAst(ast)).toContain('balance Money(2)');
    });

    it('parser → printer → parser round-trip for a cross-space colon-prefix field', () => {
      // AC2: a field authored as `supabase:auth.User` must survive a full
      // text→parse→print→text round-trip with the colon-prefix intact.
      const source = `// use prisma-next
// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

model Profile {
  id     Int             @id
  userId Int
  user   supabase:auth.User? @relation(fields: [userId], references: [id])
}`;
      const parsed1 = parsePslDocument({ schema: source, sourceId: 'r' });
      expect(parsed1.ok).toBe(true);
      const printed = printPslFromAst(parsed1.ast);
      expect(printed).toContain('supabase:auth.User?');
      const parsed2 = parsePslDocument({ schema: printed, sourceId: 'r2' });
      expect(parsed2.ok).toBe(true);
      const profile = flatPslModels(parsed2.ast).find((m) => m.name === 'Profile');
      const userField = profile?.fields.find((f) => f.name === 'user');
      expect(userField?.typeContractSpaceId).toBe('supabase');
      expect(userField?.typeNamespaceId).toBe('auth');
      expect(userField?.typeName).toBe('User');
    });
  });

  describe('workflow rendering', () => {
    it('round-trips native workflow blocks without extension descriptors', () => {
      const source = `model Customer {
  id String @id
}

workflow StripeDisputeResponse {
  trigger stripeDisputeCreated {
    source = stripe
    event = "charge.dispute.created"
  }

  state DisputeCase {
    disputeId String @id
    amount Int
  }

  step submitEvidence {
    run = "./submit-evidence.ts"
  }

  approval approveEvidence {
    when = "state.amount > 500"
  }
}`;

      const parsed = parsePslDocument({ schema: source, sourceId: 'workflow.prisma' });
      expect(parsed.ok).toBe(true);

      const printed = printPslFromAst(parsed.ast);
      expect(printed).toContain('workflow StripeDisputeResponse');
      expect(printed).toContain('trigger stripeDisputeCreated');
      expect(printed).toContain('state DisputeCase');
      expect(printed).toContain('approval approveEvidence');

      const reparsed = parsePslDocument({ schema: printed, sourceId: 'workflow.reprinted.prisma' });
      expect(reparsed.ok).toBe(true);
      expect(reparsed.ast.workflows?.[0]?.name).toBe('StripeDisputeResponse');
    });
  });
});

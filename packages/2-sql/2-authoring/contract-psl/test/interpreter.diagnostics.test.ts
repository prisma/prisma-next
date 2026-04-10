import type { ParsePslDocumentResult, PslSpan } from '@prisma-next/psl-parser';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
} as const;

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
const testSpan: PslSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 7, offset: 6 },
};

describe('interpretPslDocumentToSqlContract diagnostics', () => {
  it('returns diagnostics when target context is missing', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
}`,
      sourceId: 'schema.prisma',
    });

    // Intentionally bypasses strict input typing to verify missing target diagnostics.
    const result = interpretPslDocumentToSqlContract({
      document,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
    } as unknown as InterpretPslDocumentToSqlContractInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_TARGET_CONTEXT_REQUIRED',
        }),
      ]),
    );
  });

  it('guards against named type declarations missing both base type and constructor', () => {
    const document = {
      ok: true,
      diagnostics: [],
      ast: {
        kind: 'document',
        sourceId: 'schema.prisma',
        models: [],
        enums: [],
        compositeTypes: [],
        types: {
          kind: 'types',
          declarations: [
            {
              kind: 'namedType',
              name: 'Broken',
              attributes: [],
              span: testSpan,
            },
          ],
          span: testSpan,
        },
        span: testSpan,
      },
    } satisfies ParsePslDocumentResult;

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message: 'Named type "Broken" must declare a base type or constructor',
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported named types, field lists, missing keys, and invalid relation targets', () => {
    const document = parsePslDocument({
      schema: `types {
  DisplayName = String @db.VarChar(191)
  Weird = Unsupported
}

model Team {
  name String
}

model User {
  id Int @id
  tags String[]
  ghost Ghost @relation(fields: [ghostId], references: [id])
  ghostId Int
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        'PSL_MISSING_PRIMARY_KEY',
        'PSL_UNSUPPORTED_FIELD_TYPE',
        'PSL_INVALID_RELATION_TARGET',
      ]),
    );
  });

  it('returns diagnostics when @map and @@map arguments are not quoted string literals', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id @map(team_id)
  @@map(org_team)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('Field "Team.id" @map requires'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('Model "Team" @map requires'),
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported model attributes', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id
  @@unsupported([id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
          message: 'Model "Team" uses unsupported attribute "@@unsupported"',
        }),
      ]),
    );
  });

  it('returns diagnostics for model attributes with unrecognized extension namespace', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id
  @@pgvector.index(length: 3)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message: expect.stringContaining('uses unrecognized namespace "pgvector"'),
        }),
      ]),
    );
  });

  it('returns diagnostics when namespace is unrecognized', () => {
    const document = parsePslDocument({
      schema: `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3 }),
          }),
          data: { namespace: 'pgvector', suggestedPack: 'pgvector' },
        }),
      ]),
    );
  });

  it('returns diagnostics for list fields with unknown types', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  things Unknown[]
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: expect.stringContaining('Unknown'),
        }),
      ]),
    );
  });

  it('returns diagnostics for invalid Postgres native type attribute usage', () => {
    const document = parsePslDocument({
      schema: `types {
  BadChar = Int @db.Char(10)
  BadReal = Float @db.Real(1)
  BadTimestamp = DateTime @db.Timestamp(-1)
}

model InvalidNativeTypes {
  id Int @id
  badChar BadChar
  badReal BadReal
  badTimestamp BadTimestamp
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Named type "BadChar" uses @db.Char on unsupported base type "Int". Expected "String"',
          ),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Named type "BadReal" @db.Real does not accept arguments',
          ),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Named type "BadTimestamp" @db.Timestamp requires a non-negative integer precision',
          ),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation fields and references lengths differ', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  authorId Int
  reviewerId Int
  user User @relation(fields: [authorId, reviewerId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: expect.stringContaining('must provide the same number of fields and references'),
        }),
      ]),
    );
  });

  it('returns diagnostics when navigation list fields use unsupported attributes', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[] @unique
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: 'Field "User.posts" uses unsupported attribute "@unique"',
        }),
      ]),
    );
  });

  it('returns diagnostics when backrelation list declares FK-side relation arguments', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[] @relation(fields: [id], references: [userId])
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: expect.stringContaining('cannot declare fields/references'),
        }),
      ]),
    );
  });

  it('returns diagnostics for orphaned backrelation list fields', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ORPHANED_BACKRELATION_LIST',
          message: expect.stringContaining('User.posts'),
        }),
      ]),
    );
  });

  it('returns diagnostics for ambiguous backrelation list matches', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  primaryUserId Int
  secondaryUserId Int
  primaryUser User @relation(fields: [primaryUserId], references: [id])
  secondaryUser User @relation(fields: [secondaryUserId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
          message: expect.stringContaining('User.posts'),
        }),
      ]),
    );
  });

  it('preserves parser diagnostics with source spans', () => {
    const document = parsePslDocument({
      schema: `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 1, column: 1 }),
            end: expect.objectContaining({ line: 1 }),
          }),
        }),
      ]),
    );
  });

  it('rejects named types that declare multiple @db.* attributes', () => {
    const document = parsePslDocument({
      schema: `types {
  Email = String @db.VarChar(10) @db.Char(2)
}

model User {
  id Int @id
  email Email
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('at most one @db.* attribute'),
        }),
      ]),
    );
  });

  it('does not report family/target namespaces as uncomposed attribute namespaces', () => {
    const document = parsePslDocument({
      schema: `model User {
  id    Int    @id
  name  String @sql.foo
  email String @postgres.bar
  @@sql.qux("x")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.failure.diagnostics.map((d) => d.code);
    expect(codes).not.toContain('PSL_EXTENSION_NAMESPACE_NOT_COMPOSED');
    expect(codes).toEqual(
      expect.arrayContaining([
        'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
      ]),
    );
  });

  it('does not report db.* constructors as uncomposed namespace', () => {
    const document = parsePslDocument({
      schema: `types {
  Short = String @db.VarChar(35)
}

model User {
  id Int @id
  short Short
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({ types: { Short: expect.any(Object) } });
  });

  it('surfaces value-object field errors through the diagnostics gate', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  bogus  Missing
}

model User {
  id      Int     @id
  address Address
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('emits distinct diagnostic codes for malformed versus uncomposed constructor calls', () => {
    const malformed = parsePslDocument({
      schema: `model User {
  id Int @id
  name sql.String(
}
`,
      sourceId: 'schema.prisma',
    });

    const malformedResult = interpretPslDocumentToSqlContract({
      ...baseInput,
      document: malformed,
      composedExtensionPacks: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(malformedResult.ok).toBe(false);
    if (malformedResult.ok) return;
    const malformedCodes = malformedResult.failure.diagnostics.map((d) => d.code);
    expect(malformedCodes).not.toContain('PSL_EXTENSION_NAMESPACE_NOT_COMPOSED');

    const uncomposed = parsePslDocument({
      schema: `model User {
  id        Int @id
  embedding pgvector.Vector(1536)
}
`,
      sourceId: 'schema.prisma',
    });

    const uncomposedResult = interpretPslDocumentToSqlContract({
      ...baseInput,
      document: uncomposed,
      composedExtensionPacks: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(uncomposedResult.ok).toBe(false);
    if (uncomposedResult.ok) return;
    expect(uncomposedResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          data: { namespace: 'pgvector', suggestedPack: 'pgvector' },
        }),
      ]),
    );
  });
});

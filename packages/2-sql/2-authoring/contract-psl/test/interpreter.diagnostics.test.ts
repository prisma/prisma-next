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
        'PSL_UNSUPPORTED_FIELD_LIST',
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
          message: expect.stringContaining(
            '@map requires a positional quoted string literal argument',
          ),
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
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported list fields', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  tags String[]
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
          code: 'PSL_UNSUPPORTED_FIELD_LIST',
          message: expect.stringContaining('scalar/storage list type'),
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
});

import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContractIR } from '../src/interpreter';
import { postgresScalarTypeDescriptors, postgresTarget } from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
} as const;

describe('interpretPslDocumentToSqlContractIR diagnostics', () => {
  it('maps pgvector attributes on named types and fields to vector descriptor shape', () => {
    const namedTypeDocument = parsePslDocument({
      schema: `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const namedTypeResult = interpretPslDocumentToSqlContractIR({
      ...baseInput,
      document: namedTypeDocument,
      composedExtensionPacks: ['pgvector'],
    });
    expect(namedTypeResult.ok).toBe(true);
    if (!namedTypeResult.ok) return;
    expect(namedTypeResult.value.storage).toMatchObject({
      types: {
        Embedding1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector(1536)',
          typeParams: { length: 1536 },
        },
      },
    });

    const fieldDocument = parsePslDocument({
      schema: `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
}
`,
      sourceId: 'schema.prisma',
    });
    const fieldResult = interpretPslDocumentToSqlContractIR({
      ...baseInput,
      document: fieldDocument,
      composedExtensionPacks: ['pgvector'],
    });
    expect(fieldResult.ok).toBe(true);
    if (!fieldResult.ok) return;
    expect(fieldResult.value.storage).toMatchObject({
      tables: {
        document: {
          columns: {
            embedding: {
              codecId: 'pg/vector@1',
              nativeType: 'vector(1536)',
              typeParams: { length: 1536 },
            },
          },
        },
      },
    });
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

    const result = interpretPslDocumentToSqlContractIR({
      ...baseInput,
      document,
      composedExtensionPacks: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
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

    const result = interpretPslDocumentToSqlContractIR({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_LIST',
          message: expect.stringContaining('scalar/storage list type'),
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

    const result = interpretPslDocumentToSqlContractIR({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
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

    const result = interpretPslDocumentToSqlContractIR({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
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

    const result = interpretPslDocumentToSqlContractIR({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
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

    const result = interpretPslDocumentToSqlContractIR({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
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

    const result = interpretPslDocumentToSqlContractIR({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
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

    const result = interpretPslDocumentToSqlContractIR({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
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

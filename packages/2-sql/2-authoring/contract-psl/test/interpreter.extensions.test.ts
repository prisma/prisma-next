import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { pgvectorExtensionPack, postgresScalarTypeDescriptors, postgresTarget } from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
} as const;

describe('interpretPslDocumentToSqlContract extensions', () => {
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

    const namedTypeResult = interpretPslDocumentToSqlContract({
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
          nativeType: 'vector',
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
    const fieldResult = interpretPslDocumentToSqlContract({
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
              nativeType: 'vector',
              typeParams: { length: 1536 },
            },
          },
        },
      },
    });
  });

  it('preserves composed extension pack versions when refs are provided', () => {
    const document = parsePslDocument({
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

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['pgvector'],
      composedExtensionPackRefs: [pgvectorExtensionPack],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extensionPacks).toMatchObject({
      pgvector: {
        version: pgvectorExtensionPack.version,
      },
    });
  });

  it('instantiates enum and pgvector descriptors from shared authoring contributions', () => {
    const document = parsePslDocument({
      schema: `enum Role {
  USER
  ADMIN
}

types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  role Role
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['pgvector'],
      authoringContributions: {
        type: {
          enum: {
            kind: 'typeConstructor',
            args: [{ kind: 'string' }, { kind: 'stringArray' }],
            output: {
              codecId: 'custom/enum@1',
              nativeType: { kind: 'arg', index: 0 },
              typeParams: {
                values: { kind: 'arg', index: 1 },
              },
            },
          },
          pgvector: {
            vector: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', integer: true, minimum: 1, maximum: 2000 }],
              output: {
                codecId: 'custom/vector@1',
                nativeType: 'vector',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      types: {
        Role: {
          codecId: 'custom/enum@1',
          nativeType: 'Role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
        Embedding1536: {
          codecId: 'custom/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
      tables: {
        document: {
          columns: {
            role: {
              codecId: 'custom/enum@1',
              nativeType: 'Role',
              typeRef: 'Role',
            },
            embedding: {
              codecId: 'custom/vector@1',
              nativeType: 'vector',
              typeRef: 'Embedding1536',
            },
          },
        },
      },
    });
  });
});

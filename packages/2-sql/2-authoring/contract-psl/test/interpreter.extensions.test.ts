import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  pgvectorAuthoringContributions,
  pgvectorExtensionPack,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
} as const;

describe('interpretPslDocumentToSqlContract extensions', () => {
  it('rejects legacy pgvector.column attributes even when the extension is composed', () => {
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
      authoringContributions: pgvectorAuthoringContributions,
    });
    expect(namedTypeResult.ok).toBe(false);
    if (namedTypeResult.ok) return;
    expect(namedTypeResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
          message: expect.stringContaining('pgvector.column'),
        }),
      ]),
    );

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
      authoringContributions: pgvectorAuthoringContributions,
    });
    expect(fieldResult.ok).toBe(false);
    if (fieldResult.ok) return;
    expect(fieldResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: expect.stringContaining('pgvector.column'),
        }),
      ]),
    );
  });

  it('rejects attributes attached to constructor-based named types', () => {
    const document = parsePslDocument({
      schema: `types {
  Embedding1536 = pgvector.Vector(1536) @db.VarChar(191)
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
      authoringContributions: pgvectorAuthoringContributions,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
          message: expect.stringContaining('db.VarChar'),
        }),
      ]),
    );
  });

  it('preserves composed extension pack versions when refs are provided', () => {
    const document = parsePslDocument({
      schema: `types {
  Embedding1536 = pgvector.Vector(1536)
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
      authoringContributions: pgvectorAuthoringContributions,
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
  Embedding1536 = pgvector.Vector(1536)
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
            Vector: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
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

  it('instantiates family-owned and extension-owned constructor expressions from shared authoring contributions', () => {
    const document = parsePslDocument({
      schema: `types {
  ShortName = sql.String(length: 35)
  Embedding1536 = pgvector.Vector(1536)
}

model Document {
  id Int @id
  shortName ShortName
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
          sql: {
            String: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
              output: {
                codecId: 'custom/varchar@1',
                nativeType: 'character varying',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
          pgvector: {
            Vector: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
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
        ShortName: {
          codecId: 'custom/varchar@1',
          nativeType: 'character varying',
          typeParams: { length: 35 },
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
            shortName: {
              codecId: 'custom/varchar@1',
              nativeType: 'character varying',
              typeRef: 'ShortName',
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

  it('instantiates inline field constructor expressions from shared authoring contributions', () => {
    const document = parsePslDocument({
      schema: `model Document {
  id Int @id
  shortName sql.String(length: 35)
  embedding pgvector.Vector(length: 1536)?
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
          sql: {
            String: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
              output: {
                codecId: 'custom/varchar@1',
                nativeType: 'character varying',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
          pgvector: {
            Vector: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
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
    const storage = result.value.storage as {
      readonly types?: Record<string, unknown>;
    };
    expect(storage.types).toEqual({});
    expect(result.value.storage).toMatchObject({
      tables: {
        document: {
          columns: {
            shortName: {
              codecId: 'custom/varchar@1',
              nativeType: 'character varying',
              nullable: false,
            },
            embedding: {
              codecId: 'custom/vector@1',
              nativeType: 'vector',
              nullable: true,
            },
          },
        },
      },
    });
  });

  it('instantiates constructor expressions with JS-like object literal arguments', () => {
    const document = parsePslDocument({
      schema: `types {
  ShortName = sql.String({ length: 35, label: 'short' })
}

model Document {
  id Int @id
  shortName ShortName
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      authoringContributions: {
        type: {
          sql: {
            String: {
              kind: 'typeConstructor',
              args: [
                {
                  kind: 'object',
                  properties: {
                    length: { kind: 'number', integer: true, minimum: 1 },
                    label: { kind: 'string', optional: true },
                  },
                },
              ],
              output: {
                codecId: 'custom/varchar@1',
                nativeType: 'character varying',
                typeParams: {
                  length: { kind: 'arg', index: 0, path: ['length'] },
                  label: { kind: 'arg', index: 0, path: ['label'] },
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
        ShortName: {
          codecId: 'custom/varchar@1',
          nativeType: 'character varying',
          typeParams: {
            length: 35,
            label: 'short',
          },
        },
      },
      tables: {
        document: {
          columns: {
            shortName: {
              codecId: 'custom/varchar@1',
              nativeType: 'character varying',
              typeRef: 'ShortName',
            },
          },
        },
      },
    });
  });

  describe('object literal constructor arguments', () => {
    const objectArgContributions = {
      type: {
        sql: {
          String: {
            kind: 'typeConstructor' as const,
            args: [
              {
                kind: 'object' as const,
                properties: {
                  length: { kind: 'number' as const, integer: true, minimum: 1 },
                  label: { kind: 'string' as const, optional: true },
                },
              },
            ],
            output: {
              codecId: 'custom/varchar@1',
              nativeType: 'character varying',
              typeParams: {
                length: { kind: 'arg' as const, index: 0, path: ['length'] },
                label: { kind: 'arg' as const, index: 0, path: ['label'] },
              },
            },
          },
        },
      },
    };

    const interpretWith = (schema: string) =>
      interpretPslDocumentToSqlContract({
        ...baseInput,
        document: parsePslDocument({ schema, sourceId: 'schema.prisma' }),
        authoringContributions: objectArgContributions,
      });

    it('accepts strict JSON with double-quoted keys', () => {
      const result = interpretWith(`types {
  Short = sql.String({ "length": 35, "label": "short" })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.storage).toMatchObject({
        types: { Short: { typeParams: { length: 35, label: 'short' } } },
      });
    });

    it('rejects an object literal that is missing a required property', () => {
      const result = interpretWith(`types {
  Short = sql.String({ label: 'short' })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });

    it('rejects an object literal with an unknown property', () => {
      const result = interpretWith(`types {
  Short = sql.String({ length: 35, bogus: 'x' })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });

    it('rejects an object literal with a wrong-typed property', () => {
      const result = interpretWith(`types {
  Short = sql.String({ length: 'not a number' })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });

    it('rejects malformed object literal syntax (unclosed brace)', () => {
      const result = interpretWith(`types {
  Short = sql.String({ length: 35 )
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
    });

    it('rejects a top-level non-object literal', () => {
      const result = interpretWith(`types {
  Short = sql.String([1, 2, 3])
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });
  });
});

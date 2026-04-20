import postgresAdapter from '@prisma-next/adapter-postgres/control';
import pgvectorControl from '@prisma-next/extension-pgvector/control';
import pgvectorPack from '@prisma-next/extension-pgvector/pack';
import sqlFamilyControl from '@prisma-next/family-sql/control';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { createControlStack } from '@prisma-next/framework-components/control';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresControl from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { describe, expect, it } from 'vitest';

const int4Column = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const;

const stack = createControlStack({
  family: sqlFamilyControl,
  target: postgresControl,
  adapter: postgresAdapter,
  extensionPacks: [pgvectorControl],
});

function buildColumnDescriptorMap() {
  const result = new Map<string, { codecId: string; nativeType: string }>();
  for (const [typeName, codecId] of stack.scalarTypeDescriptors) {
    const codec = stack.codecLookup.get(codecId);
    const nativeType = codec?.targetTypes[0] ?? codecId;
    result.set(typeName, { codecId, nativeType });
  }
  return result;
}

function interpretWithRealPacks(schema: string) {
  return interpretPslDocumentToSqlContract({
    document: parsePslDocument({ schema, sourceId: 'schema.prisma' }),
    target: postgresPack,
    scalarTypeDescriptors: buildColumnDescriptorMap(),
    controlMutationDefaults: stack.controlMutationDefaults,
    authoringContributions: stack.authoringContributions,
    composedExtensionPacks: [pgvectorControl.id],
    composedExtensionPackRefs: [pgvectorPack],
  });
}

describe('TS and PSL authoring parity with real packs', () => {
  it('lowers family-owned and extension-owned type constructors to identical output', () => {
    const tsContract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresPack,
        extensionPacks: { pgvector: pgvectorPack },
      },
      ({ type, field, model }) => {
        const types = {
          ShortName: type.sql.String(35),
          Embedding1536: type.pgvector.Vector(1536),
        } as const;

        return {
          types,
          models: {
            Document: model('Document', {
              fields: {
                id: field.column(int4Column).id({ name: 'document_pkey' }),
                shortName: field.namedType(types.ShortName).unique({
                  name: 'document_short_name_key',
                }),
                embedding: field.namedType(types.Embedding1536).optional(),
              },
            }).sql({
              table: 'document',
            }),
          },
        };
      },
    );

    const interpreted = interpretWithRealPacks(`types {
  ShortName = sql.String(length: 35)
  Embedding1536 = pgvector.Vector(1536)
}

model Document {
  id Int @id(map: "document_pkey")
  shortName ShortName @unique(map: "document_short_name_key")
  embedding Embedding1536?
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('lowers inline field constructor expressions to the same output as direct TS column descriptors', () => {
    const tsContract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresPack,
        extensionPacks: { pgvector: pgvectorPack },
      },
      ({ type, field, model }) => ({
        models: {
          Document: model('Document', {
            fields: {
              id: field.column(int4Column).id({ name: 'document_pkey' }),
              shortName: field.column(type.sql.String(35)).unique({
                name: 'document_short_name_key',
              }),
              embedding: field.column(type.pgvector.Vector(1536)).optional(),
            },
          }).sql({
            table: 'document',
          }),
        },
      }),
    );

    const interpreted = interpretWithRealPacks(`model Document {
  id Int @id(map: "document_pkey")
  shortName sql.String(length: 35) @unique(map: "document_short_name_key")
  embedding pgvector.Vector(length: 1536)?
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });
});

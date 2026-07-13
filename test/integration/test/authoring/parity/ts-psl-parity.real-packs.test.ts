import postgresAdapter from '@prisma-next/adapter-postgres/control';
import pgvectorControl from '@prisma-next/extension-pgvector/control';
import pgvectorPack from '@prisma-next/extension-pgvector/pack';
import sqlFamilyControl from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  defineContract,
  field,
  model,
  nativeEnum,
  pg,
} from '@prisma-next/postgres/contract-builder';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import postgresControl from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
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
    const targetTypes = stack.codecLookup.targetTypesFor(codecId);
    const nativeType = targetTypes?.[0] ?? codecId;
    result.set(typeName, { codecId, nativeType });
  }
  return result;
}

function interpretWithRealPacks(schema: string) {
  const scalarTypeDescriptors = buildColumnDescriptorMap();
  const { document, sourceFile } = parse(schema);
  const { table } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarTypeDescriptors.keys()],
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable: table,
    sourceFile,
    sourceId: 'schema.prisma',
    target: postgresPack,
    scalarTypeDescriptors,
    controlMutationDefaults: stack.controlMutationDefaults,
    authoringContributions: stack.authoringContributions,
    composedExtensionContracts: new Map(),
    composedExtensionPacks: [pgvectorControl.id],
    composedExtensionPackRefs: [pgvectorPack],
    createNamespace: postgresCreateNamespace,
    capabilities: stack.capabilities,
    codecLookup: stack.codecLookup,
  });
}

describe('TS and PSL authoring parity with real packs', () => {
  it('lowers family-owned and extension-owned type constructors to identical output', () => {
    const tsContract = defineContract(
      {
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

  it('lowers a native_enum + pg.enum column to the same output in the default schema', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const tsContract = defineContract({
      extensionPacks: { pgvector: pgvectorPack },
      models: {
        Session: model('Session', {
          fields: {
            id: field.column(int4Column).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'session' }),
      },
    });

    const interpreted = interpretWithRealPacks(`namespace public {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model Session {
    id Int @id
    aal pg.enum(AalLevel)?
  }
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('lowers a native_enum + pg.enum column to the same output in a named schema (auth)', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const tsContract = defineContract({
      extensionPacks: { pgvector: pgvectorPack },
      namespaces: ['auth'],
      models: {
        Session: model('Session', {
          namespace: 'auth',
          fields: {
            id: field.column(int4Column).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'session' }),
      },
    });

    const interpreted = interpretWithRealPacks(`namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model Session {
    id Int @id
    aal pg.enum(AalLevel)?
  }
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });
});

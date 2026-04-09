import { parsePslDocument } from '@prisma-next/psl-parser';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import pgvectorControl from '../../../3-extensions/pgvector/src/exports/control';
import pgvectorPack from '../../../3-extensions/pgvector/src/exports/pack';
import postgresControl from '../../../3-targets/3-targets/postgres/src/exports/control';
import postgresPack from '../../../3-targets/3-targets/postgres/src/exports/pack';
import postgresAdapter from '../../../3-targets/6-adapters/postgres/src/exports/control';
import sqlFamilyControl, {
  assembleAuthoringContributions,
  assemblePslInterpretationContributions,
} from '../src/exports/control';
import sqlFamilyPack from '../src/exports/pack';

const int4Column = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const;

const representativePslSchema = `types {
  ShortName = sql.String(length: 35)
  Embedding1536 = pgvector.Vector(1536)
}

model Document {
  id Int @id(map: "document_pkey")
  shortName ShortName @unique(map: "document_short_name_key")
  embedding Embedding1536?
}
`;

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

    const document = parsePslDocument({
      schema: representativePslSchema,
      sourceId: 'schema.prisma',
    });

    const authoringContributions = assembleAuthoringContributions([
      sqlFamilyControl,
      postgresControl,
      postgresAdapter,
      pgvectorControl,
    ]);
    const pslInputs = assemblePslInterpretationContributions([
      sqlFamilyControl,
      postgresControl,
      postgresAdapter,
      pgvectorControl,
    ]);

    const interpreted = interpretPslDocumentToSqlContract({
      document,
      target: postgresPack,
      scalarTypeDescriptors: pslInputs.scalarTypeDescriptors,
      controlMutationDefaults: {
        defaultFunctionRegistry: pslInputs.defaultFunctionRegistry,
        generatorDescriptors: pslInputs.generatorDescriptors,
      },
      authoringContributions,
      composedExtensionPacks: [pgvectorControl.id],
      composedExtensionPackRefs: [pgvectorPack],
    });

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

    const document = parsePslDocument({
      schema: `model Document {
  id Int @id(map: "document_pkey")
  shortName sql.String(length: 35) @unique(map: "document_short_name_key")
  embedding pgvector.Vector(length: 1536)?
}
`,
      sourceId: 'schema.prisma',
    });

    const authoringContributions = assembleAuthoringContributions([
      sqlFamilyControl,
      postgresControl,
      postgresAdapter,
      pgvectorControl,
    ]);
    const pslInputs = assemblePslInterpretationContributions([
      sqlFamilyControl,
      postgresControl,
      postgresAdapter,
      pgvectorControl,
    ]);

    const interpreted = interpretPslDocumentToSqlContract({
      document,
      target: postgresPack,
      scalarTypeDescriptors: pslInputs.scalarTypeDescriptors,
      controlMutationDefaults: {
        defaultFunctionRegistry: pslInputs.defaultFunctionRegistry,
        generatorDescriptors: pslInputs.generatorDescriptors,
      },
      authoringContributions,
      composedExtensionPacks: [pgvectorControl.id],
      composedExtensionPackRefs: [pgvectorPack],
    });

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });
});

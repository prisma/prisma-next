import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import type { CodecTypes } from '../types/codec-types';
import { pgvectorAuthoringTypes } from './authoring';
import { codecDefinitions } from './codecs';

const pgvectorTypeId = 'pg/vector@1' as const;

export const pgvectorQueryOperations: readonly SqlOperationDescriptor[] = [
  {
    method: 'cosineDistance',
    args: [
      { codecId: pgvectorTypeId, nullable: false },
      { codecId: pgvectorTypeId, nullable: false },
    ],
    returns: { codecId: 'pg/float8@1', nullable: false },
    lowering: {
      targetFamily: 'sql',
      strategy: 'function',
      template: '{{self}} <=> {{arg0}}',
    },
  },
  {
    method: 'cosineSimilarity',
    args: [
      { codecId: pgvectorTypeId, nullable: false },
      { codecId: pgvectorTypeId, nullable: false },
    ],
    returns: { codecId: 'pg/float8@1', nullable: false },
    lowering: {
      targetFamily: 'sql',
      strategy: 'function',
      template: '1 - ({{self}} <=> {{arg0}})',
    },
  },
];

const pgvectorPackMetaBase = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'pgvector.cosine': true,
    },
  },
  authoring: {
    type: pgvectorAuthoringTypes,
  },
  types: {
    codecTypes: {
      codecInstances: Object.values(codecDefinitions).map((def) => def.codec),
      import: {
        package: '@prisma-next/extension-pgvector/codec-types',
        named: 'CodecTypes',
        alias: 'PgVectorTypes',
      },
      typeImports: [
        {
          package: '@prisma-next/extension-pgvector/codec-types',
          named: 'Vector',
          alias: 'Vector',
        },
      ],
    },
    operationTypes: {
      import: {
        package: '@prisma-next/extension-pgvector/operation-types',
        named: 'OperationTypes',
        alias: 'PgVectorOperationTypes',
      },
    },
    queryOperationTypes: {
      import: {
        package: '@prisma-next/extension-pgvector/operation-types',
        named: 'QueryOperationTypes',
        alias: 'PgVectorQueryOperationTypes',
      },
    },
    storage: [
      { typeId: pgvectorTypeId, familyId: 'sql', targetId: 'postgres', nativeType: 'vector' },
    ],
  },
} as const;

export const pgvectorPackMeta: typeof pgvectorPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = pgvectorPackMetaBase;

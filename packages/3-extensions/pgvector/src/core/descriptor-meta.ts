import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { QueryOperationDescriptor } from '@prisma-next/sql-relational-core/query-operations';

const pgvectorTypeId = 'pg/vector@1' as const;

const cosineLowering = {
  targetFamily: 'sql',
  strategy: 'function',
  template: '1 - ({{self}} <=> {{arg0}})',
} as const;

const cosineDistanceOperation = Object.freeze({
  method: 'cosineDistance',
  args: [{ kind: 'param' }],
  returns: { kind: 'builtin', type: 'number' },
  lowering: cosineLowering,
} as const);

export const pgvectorOperationSignature: SqlOperationSignature = {
  forTypeId: pgvectorTypeId,
  ...cosineDistanceOperation,
};

export const pgvectorQueryOperations: readonly QueryOperationDescriptor[] = [
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
      template: '1 - ({{self}} <=> {{arg0}})',
    },
  },
];

export const pgvectorPackMeta = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'pgvector/cosine': true,
    },
  },
  types: {
    codecTypes: {
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
      parameterized: {
        [pgvectorTypeId]: 'Vector<{{length}}>',
      },
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

import type { ExtensionPackRef } from '@prisma-next/sql-contract/pack-types';

const pgvectorPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  targets: {
    postgres: { minVersion: '12' },
  },
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
    },
    operationTypes: {
      import: {
        package: '@prisma-next/extension-pgvector/operation-types',
        named: 'OperationTypes',
        alias: 'PgVectorOperationTypes',
      },
    },
    storage: [
      { typeId: 'pg/vector@1', familyId: 'sql', targetId: 'postgres', nativeType: 'vector' },
    ],
  },
  operations: [
    {
      for: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: '1 - ({{self}} <=> {{arg0}})',
      },
    },
  ],
};

export default pgvectorPack;

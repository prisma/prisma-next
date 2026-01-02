import type { ExtensionPackRef } from '@prisma-next/sql-contract/pack-types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';

const pgvectorTypeId = 'pg/vector@1' as const;

const cosineLowering = {
  targetFamily: 'sql',
  strategy: 'function',
  template: '1 - ({{self}} <=> {{arg0}})',
} as const;

export const pgvectorPackMeta = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
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
      { typeId: pgvectorTypeId, familyId: 'sql', targetId: 'postgres', nativeType: 'vector' },
    ],
  },
  operations: [
    {
      for: pgvectorTypeId,
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: cosineLowering,
    },
  ],
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

export const pgvectorRuntimeOperation: SqlOperationSignature = {
  forTypeId: pgvectorTypeId,
  method: 'cosineDistance',
  args: [{ kind: 'param' }],
  returns: { kind: 'builtin', type: 'number' },
  lowering: cosineLowering,
};

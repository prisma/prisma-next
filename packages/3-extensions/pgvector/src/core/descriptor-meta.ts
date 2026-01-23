import type { SqlOperationSignature } from '@prisma-next/sql-operations';

const pgvectorTypeId = 'pg/vector@1' as const;

const cosineLowering = {
  targetFamily: 'sql',
  strategy: 'function',
  template: '1 - ({{self}} <=> {{arg0}})',
} as const;

/**
 * Shared operation definition used by both control-plane and runtime descriptors.
 * Frozen to prevent accidental mutation.
 */
const cosineDistanceOperation = Object.freeze({
  method: 'cosineDistance',
  args: [{ kind: 'param' }],
  returns: { kind: 'builtin', type: 'number' },
  lowering: cosineLowering,
} as const);

/**
 * The canonical pgvector operation signature.
 * Used by both control-plane and runtime descriptors via operationSignatures().
 */
export const pgvectorOperationSignature: SqlOperationSignature = {
  forTypeId: pgvectorTypeId,
  ...cosineDistanceOperation,
};

/**
 * Shared descriptor metadata for pgvector extension.
 * Contains identity, capabilities, and type information.
 *
 * Note: Operations are NOT included here. Descriptors must implement
 * operationSignatures() method to contribute operations to the registry.
 */
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
    storage: [
      { typeId: pgvectorTypeId, familyId: 'sql', targetId: 'postgres', nativeType: 'vector' },
    ],
  },
} as const;

/**
 * @deprecated Use pgvectorOperationSignature instead.
 */
export const pgvectorRuntimeOperation = pgvectorOperationSignature;

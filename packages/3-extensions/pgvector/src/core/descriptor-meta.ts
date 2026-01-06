import type { ExtensionPackRef } from '@prisma-next/contract/framework-components';
import type { ParameterizedCodecDescriptor } from '@prisma-next/contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';

const pgvectorTypeId = 'pg/vector@1' as const;

/**
 * Parameterized codec descriptor for the vector type.
 * Enables precise TypeScript types like `Vector<1536>` for vector columns
 * when they have typeParams with a `length` property.
 */
const vectorCodecDescriptor: ParameterizedCodecDescriptor = {
  codecId: pgvectorTypeId,
  outputTypeRenderer: 'Vector<{{length}}>',
  typesImport: {
    package: '@prisma-next/extension-pgvector/vector-types',
    named: 'Vector',
    alias: 'Vector',
  },
};

const cosineLowering = {
  targetFamily: 'sql',
  strategy: 'function',
  template: '1 - ({{self}} <=> {{arg0}})',
} as const;

/**
 * Shared operation definition used by both pack metadata and runtime descriptor.
 * Frozen to prevent accidental mutation.
 */
const cosineDistanceOperation = Object.freeze({
  method: 'cosineDistance',
  args: [{ kind: 'param' }],
  returns: { kind: 'builtin', type: 'number' },
  lowering: cosineLowering,
} as const);

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
    parameterizedCodecs: [vectorCodecDescriptor],
  },
  operations: [
    {
      for: pgvectorTypeId,
      ...cosineDistanceOperation,
    },
  ],
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

export const pgvectorRuntimeOperation: SqlOperationSignature = {
  forTypeId: pgvectorTypeId,
  ...cosineDistanceOperation,
};

import type { ExtensionPackRef } from '@prisma-next/contract/framework-components';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';

const sqliteVectorTypeId = 'sqlite/vector@1' as const;

const cosineLowering = {
  targetFamily: 'sql',
  strategy: 'function',
  // Pure SQL implementation to avoid requiring a custom SQLite UDF.
  //
  // This assumes both vectors are JSON arrays (stored as TEXT) and uses JSON1 + math functions.
  template: `(
    SELECT
      CASE
        WHEN denom IS NULL OR denom = 0 THEN NULL
        ELSE 1.0 - (dot / denom)
      END
    FROM (
      SELECT
        SUM(CAST(a.value AS REAL) * CAST(b.value AS REAL)) AS dot,
        (SQRT(SUM(CAST(a.value AS REAL) * CAST(a.value AS REAL))) *
          SQRT(SUM(CAST(b.value AS REAL) * CAST(b.value AS REAL)))) AS denom
      FROM json_each({{self}}) AS a
      JOIN json_each({{arg0}}) AS b
        ON a.key = b.key
    )
  )`,
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

export const sqliteVectorPackMeta = {
  kind: 'extension',
  id: 'sqlitevector',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
  capabilities: {
    sqlite: {
      'sqlitevector/cosine': true,
    },
  },
  types: {
    codecTypes: {
      import: {
        package: '@prisma-next/extension-sqlite-vector/codec-types',
        named: 'CodecTypes',
        alias: 'SqliteVectorTypes',
      },
      typeImports: [
        {
          package: '@prisma-next/extension-sqlite-vector/codec-types',
          named: 'Vector',
          alias: 'Vector',
        },
      ],
    },
    operationTypes: {
      import: {
        package: '@prisma-next/extension-sqlite-vector/operation-types',
        named: 'OperationTypes',
        alias: 'SqliteVectorOperationTypes',
      },
    },
    storage: [
      { typeId: sqliteVectorTypeId, familyId: 'sql', targetId: 'sqlite', nativeType: 'text' },
    ],
  },
  operations: [
    {
      for: sqliteVectorTypeId,
      ...cosineDistanceOperation,
    },
  ],
} as const satisfies ExtensionPackRef<'sql', 'sqlite'>;

export const sqliteVectorRuntimeOperation: SqlOperationSignature = {
  forTypeId: sqliteVectorTypeId,
  ...cosineDistanceOperation,
};

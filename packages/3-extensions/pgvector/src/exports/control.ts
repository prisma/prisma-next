import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type {
  CodecControlHooks,
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { pgvectorOperationSignature, pgvectorPackMeta } from '../core/descriptor-meta';

const PGVECTOR_CODEC_ID = 'pg/vector@1' as const;

const vectorControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType, typeParams }) => {
    const length = typeParams?.['length'];
    if (typeof length === 'number' && Number.isInteger(length) && length > 0) {
      return `${nativeType}(${length})`;
    }
    return nativeType;
  },
};

function verifyVectorExtensionInstalled(schema: SqlSchemaIR): readonly SchemaIssue[] {
  if (!schema.extensions.includes('vector')) {
    return [
      {
        kind: 'extension_missing',
        table: '',
        message: 'Extension "vector" is missing from database (required by pgvector)',
      },
    ];
  }
  return [];
}

const pgvectorDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [
    {
      id: 'postgres.extension.vector',
      label: 'Enable vector extension',
      install: [
        {
          id: 'extension.vector',
          label: 'Enable extension "vector"',
          summary: 'Ensures the vector extension is available for pgvector operations',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify extension "vector" is not already enabled',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
          execute: [
            {
              description: 'create extension "vector"',
              sql: 'CREATE EXTENSION IF NOT EXISTS vector',
            },
          ],
          postcheck: [
            {
              description: 'confirm extension "vector" is enabled',
              sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
        },
      ],
      verifyDatabaseDependencyInstalled: verifyVectorExtensionInstalled,
    },
  ],
};

const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...pgvectorPackMeta,
  types: {
    ...pgvectorPackMeta.types,
    codecTypes: {
      ...pgvectorPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [PGVECTOR_CODEC_ID]: vectorControlPlaneHooks,
      },
    },
  },
  operationSignatures: () => [pgvectorOperationSignature],
  databaseDependencies: pgvectorDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { pgvectorExtensionDescriptor };
export default pgvectorExtensionDescriptor;

import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type {
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { manifest } from '../core/manifest';

/**
 * Pure verification hook: checks whether the 'vector' extension is installed
 * based on the in-memory schema IR (no DB I/O).
 */
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

/**
 * Database dependencies for the pgvector extension.
 * Declares the 'vector' Postgres extension as a required dependency.
 */
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

/**
 * pgvector extension descriptor for CLI config.
 * Declares database dependencies for the 'vector' Postgres extension.
 */
const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  familyId: 'sql',
  targetId: 'postgres', // pgvector is postgres-specific
  id: 'pgvector',
  manifest,
  databaseDependencies: pgvectorDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export default pgvectorExtensionDescriptor;

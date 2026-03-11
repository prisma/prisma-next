import type {
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { pgvectorOperationSignature, pgvectorPackMeta } from '../core/descriptor-meta';

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
    },
  ],
};

const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...pgvectorPackMeta,
  operationSignatures: () => [pgvectorOperationSignature],
  databaseDependencies: pgvectorDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { pgvectorExtensionDescriptor };
export default pgvectorExtensionDescriptor;

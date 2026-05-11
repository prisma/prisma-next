import type {
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { paradedbPackMeta, paradedbQueryOperations } from '../core/descriptor-meta';

const paradedbDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [
    {
      id: 'postgres.extension.pg_search',
      label: 'Enable pg_search extension',
      install: [
        {
          id: 'extension.pg_search',
          label: 'Enable extension "pg_search"',
          summary: 'Ensures the pg_search extension is available for ParadeDB BM25 operations',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify extension "pg_search" is not already enabled',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_search')",
            },
          ],
          execute: [
            {
              description: 'create extension "pg_search"',
              sql: 'CREATE EXTENSION IF NOT EXISTS pg_search',
            },
          ],
          postcheck: [
            {
              description: 'confirm extension "pg_search" is enabled',
              sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_search')",
            },
          ],
        },
      ],
    },
  ],
};

const paradedbExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...paradedbPackMeta,
  queryOperations: () => paradedbQueryOperations(),
  databaseDependencies: paradedbDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { paradedbExtensionDescriptor, paradedbPackMeta };
export default paradedbExtensionDescriptor;

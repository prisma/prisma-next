/**
 * Extension exports for schema-verify tests.
 * Separated to avoid circular imports in helpers.
 *
 * `pgvector` exposes the real package descriptor. After the
 * extension-contract-spaces project / M4 migrated pgvector off
 * `databaseDependencies.init`, the descriptor no longer participates
 * in the legacy `dependency_missing` schemaVerify path. The
 * `legacyDatabaseDependencyExtension` synthetic below preserves the
 * `databaseDependencies` shape so the existing `dependency missing`
 * tests still cover the schemaVerify code path that handles missing
 * declared dependencies. The whole `databaseDependencies` mechanism
 * is removed in M5; this synthetic + its consumers go away with it.
 */
export { default as pgvector } from '@prisma-next/extension-pgvector/control';

import type {
  ComponentDatabaseDependency,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';

const legacyVectorDependency: ComponentDatabaseDependency<unknown> = {
  id: 'postgres.extension.legacy-vector',
  label: 'Enable extension "legacy_vector"',
  install: [
    {
      id: 'extension.legacy-vector',
      label: 'Enable extension "legacy_vector"',
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: { schema: 'public', objectType: 'extension', name: 'legacy_vector' },
      },
      precheck: [
        {
          description: 'check legacy_vector extension is not already installed',
          sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'legacy_vector')",
        },
      ],
      execute: [
        {
          description: 'install legacy_vector extension',
          sql: 'CREATE EXTENSION IF NOT EXISTS legacy_vector',
        },
      ],
      postcheck: [
        {
          description: 'verify legacy_vector extension is installed',
          sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'legacy_vector')",
        },
      ],
    },
  ],
};

export const legacyDatabaseDependencyExtension: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'legacy-vector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.0-test',
  databaseDependencies: { init: [legacyVectorDependency] },
  create: () => ({ familyId: 'sql', targetId: 'postgres' }) as never,
};

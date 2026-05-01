/**
 * SQL control extension descriptor for cipherstash.
 *
 * Mirrors `packages/3-extensions/pgvector/src/exports/control.ts` —
 * `databaseDependencies.init` declares the EQL extension install so
 * the framework's `dbInit` runs the bundle (idempotent via the
 * precheck) before any cipherstash-bound migration executes.
 *
 * **AC-INSTALL1** is satisfied at the *shape* level in M2.a; the
 * placeholder install SQL points at the M2.c bundle vendor task.
 * **AC-INSTALL2** (live-Postgres `dbInit` succeeds) and
 * **AC-INSTALL3** (idempotency) require the real bundle and live a
 * Postgres harness — both deferred to M2.c.
 */

import type {
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { EQL_INSTALL_SQL } from '../core/eql-bundle';

export const CIPHERSTASH_EXTENSION_ID = 'cipherstash' as const;
export const CIPHERSTASH_EXTENSION_VERSION = '0.0.1' as const;

const cipherstashDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [
    {
      id: 'postgres.extension.eql',
      label: 'Install EQL extension',
      install: [
        {
          id: 'eql.install',
          label: 'Install EQL bundle',
          summary:
            'Installs the EQL Postgres extension bundle (encrypted-aware operators + cs_configuration_v2)',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify EQL is not already installed',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cs_configuration_v2')",
            },
          ],
          execute: [
            {
              description: 'install EQL bundle',
              sql: EQL_INSTALL_SQL,
            },
          ],
          postcheck: [
            {
              description: 'confirm EQL is installed',
              sql: "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'eql_v2')",
            },
          ],
        },
      ],
    },
  ],
};

export const cipherstashControlDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: CIPHERSTASH_EXTENSION_ID,
  version: CIPHERSTASH_EXTENSION_VERSION,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  databaseDependencies: cipherstashDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export default cipherstashControlDescriptor;

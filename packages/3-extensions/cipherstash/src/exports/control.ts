/**
 * SQL control extension descriptor for cipherstash.
 *
 * Spreads `cipherstashPackMeta` (authoring contributions, capabilities,
 * storage type registration, codec metadata) and adds the
 * `databaseDependencies.init` block that installs the EQL Postgres
 * extension before any cipherstash-bound migration executes.
 *
 * **AC-INSTALL1** is satisfied at the *shape* level in M2.a; the
 * placeholder install SQL points at the M2.c bundle vendor task.
 * **AC-INSTALL2** (live-Postgres `dbInit` succeeds) and
 * **AC-INSTALL3** (idempotency) require the real bundle and a live
 * Postgres harness — both deferred to M2.c.
 */

import type {
  CodecControlHooks,
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { CIPHERSTASH_STRING_CODEC_ID } from '../core/codecs';
import { cipherstashPackMeta } from '../core/descriptor-meta';
import { EQL_INSTALL_SQL } from '../core/eql-bundle';

/**
 * Cipherstash columns carry search-mode `typeParams` (`equality`,
 * `freeTextSearch`) that govern *operator* lowering at runtime —
 * they are not part of the column's SQL DDL signature, which is
 * always the bare `eql_v2_encrypted` Postgres native type. The
 * framework's DDL builder requires every typeParam-carrying column
 * to declare an `expandNativeType` hook to make the "no parameters
 * affect DDL" decision explicit; this hook records that decision.
 */
const cipherstashStringControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType }) => nativeType,
};

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
  ...cipherstashPackMeta,
  types: {
    ...cipherstashPackMeta.types,
    codecTypes: {
      ...cipherstashPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [CIPHERSTASH_STRING_CODEC_ID]: cipherstashStringControlPlaneHooks,
      },
    },
  },
  databaseDependencies: cipherstashDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export default cipherstashControlDescriptor;

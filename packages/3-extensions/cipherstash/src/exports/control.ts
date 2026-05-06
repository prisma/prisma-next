/**
 * SQL control extension descriptor for cipherstash.
 *
 * Spreads `cipherstashPackMeta` (authoring contributions, capabilities,
 * storage type registration, codec metadata) and adds the
 * `databaseDependencies.init` block that installs the EQL Postgres
 * extension before any cipherstash-bound migration executes.
 *
 * - **AC-INSTALL1** — descriptor shape and live SQL bundle (M2.c).
 * - **AC-INSTALL2** — `dbInit` against a fresh Postgres database
 *   creates the `eql_v2` schema (verified by the integration test).
 * - **AC-INSTALL3** — idempotency: the precheck short-circuits when
 *   `public.eql_v2_configuration` already exists, so a repeat
 *   `dbInit` skips the install step.
 *
 * Note: the spec text predates the upstream `encrypt-query-language`
 * rename of `cs_configuration_v2` to `eql_v2_configuration`; the
 * implementation tracks the upstream bundle. The spec acceptance
 * criteria (AC-INSTALL2/3) target "the EQL configuration table" — the
 * upstream rename is the source of truth for the table identifier.
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
      id: 'postgres.extension.pgcrypto',
      label: 'Install EQL extension',
      install: [
        {
          // The op id must start with `extension.` for the postgres
          // migration planner to classify it as a dependency op (runs
          // before table creates). See
          // `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts`
          // `classifyCall(...)` for the rawSql / id-prefix rule.
          id: 'extension.eql.install',
          label: 'Install EQL bundle',
          summary:
            'Installs the EQL Postgres extension bundle (encrypted-aware operators + eql_v2_configuration)',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify EQL is not already installed',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'eql_v2_configuration')",
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

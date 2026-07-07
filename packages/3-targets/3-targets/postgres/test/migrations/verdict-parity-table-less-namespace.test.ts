import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { computeSqlDiffVerdict, computeStorageTypeVerdict } from '@prisma-next/family-sql/diff';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  diffPostgresSchemaForVerdict,
  verifyPostgresDatabaseSchema,
} from '../../src/core/migrations/diff-database-schema';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

/**
 * Table-less contract namespaces (e.g. an enums-only schema) were invisible
 * to the legacy relational walk — it skipped contract namespaces with zero
 * tables before pairing. The verdict diff must reproduce that: a table-less
 * namespace contributes nothing to the expected tree and does not claim its
 * DDL schema for ownership, so neither the schema's absence nor its live
 * contents can flip the verdict. Pinned here as legacy-vs-differ verdict
 * parity over Postgres TREES (the flat parity suite cannot see namespaces).
 */

function makeContract(): Contract<SqlStorage> {
  const publicSchema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        profiles: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
    },
  });
  const enumsOnlySchema = new PostgresSchema({ id: 'enums', entries: { table: {} } });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:table-less-ns-parity'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:table-less-ns-parity'),
      namespaces: { public: publicSchema, enums: enumsOnlySchema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function profilesTable(options?: { readonly idNullable?: boolean }): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'profiles',
    columns: {
      id: {
        name: 'id',
        nativeType: 'int4',
        nullable: options?.idNullable ?? false,
        resolvedNativeType: 'int4',
      },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
  });
}

function publicNamespace(options?: { readonly idNullable?: boolean }): PostgresNamespaceSchemaNode {
  return new PostgresNamespaceSchemaNode({
    schemaName: 'public',
    tables: { profiles: profilesTable(options) },
    nativeEnumTypeNames: [],
  });
}

function rootOf(
  namespaces: Readonly<Record<string, PostgresNamespaceSchemaNode>>,
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [],
    existingSchemas: Object.keys(namespaces),
    pgVersion: 'unknown',
  });
}

function runBothPipelines(
  contract: Contract<SqlStorage>,
  actual: PostgresDatabaseSchemaNode,
  strict: boolean,
): { readonly legacyOk: boolean; readonly differOk: boolean } {
  const legacy = verifyPostgresDatabaseSchema({
    contract,
    actualSchema: actual,
    strict,
    typeMetadataRegistry: new Map(),
    frameworkComponents: [],
  });
  const legacyOk = legacy.ok && legacy.schema.schemaDiffIssues.length === 0;

  const verdictDiff = diffPostgresSchemaForVerdict({
    contract,
    schema: actual,
    frameworkComponents: [],
  });
  const diffVerdict = computeSqlDiffVerdict({
    issues: verdictDiff.issues,
    expectedRoot: verdictDiff.expectedRoot,
    strict,
    defaultControlPolicy: contract.defaultControlPolicy,
  });
  const storageTypeVerdict = computeStorageTypeVerdict({
    contract,
    namespacePairs: verdictDiff.namespacePairs,
    codecHooks: new Map(),
  });
  const differOk = diffVerdict.failures.length === 0 && storageTypeVerdict.failures.length === 0;
  return { legacyOk, differOk };
}

function assertParity(
  contract: Contract<SqlStorage>,
  actual: PostgresDatabaseSchemaNode,
  expectedOk: boolean,
): void {
  for (const strict of [true, false]) {
    const { legacyOk, differOk } = runBothPipelines(contract, actual, strict);
    expect({ strict, legacyOk, differOk }).toEqual({
      strict,
      legacyOk: expectedOk,
      differOk: expectedOk,
    });
  }
}

describe('verdict parity: table-less contract namespaces (Postgres tree)', () => {
  it('DDL schema of an enums-only namespace absent from the DB verifies clean', () => {
    assertParity(makeContract(), rootOf({ public: publicNamespace() }), true);
  });

  it('DDL schema of an enums-only namespace holding live tables verifies clean', () => {
    const actual = rootOf({
      public: publicNamespace(),
      enums: new PostgresNamespaceSchemaNode({
        schemaName: 'enums',
        tables: {
          audit_log: new PostgresTableSchemaNode({
            name: 'audit_log',
            columns: {
              id: {
                name: 'id',
                nativeType: 'int4',
                nullable: false,
                resolvedNativeType: 'int4',
              },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
          }),
        },
        nativeEnumTypeNames: [],
      }),
    });
    assertParity(makeContract(), actual, true);
  });

  it('drift inside the table-bearing namespace still fails both pipelines', () => {
    assertParity(makeContract(), rootOf({ public: publicNamespace({ idNullable: true }) }), false);
  });
});

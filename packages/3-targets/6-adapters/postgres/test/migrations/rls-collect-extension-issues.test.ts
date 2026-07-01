import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { diffPostgresDatabaseSchema } from '@prisma-next/target-postgres/planner';
import {
  computeContentHash,
  normalizePredicate,
} from '@prisma-next/target-postgres/rls-canonicalize';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresPolicySchemaNode,
  PostgresRlsPolicy,
  PostgresSchema,
  PostgresTableSchemaNode,
} from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

const TABLE_NAME = 'items';
const USING = '(owner_id = current_user_id())';
const PREFIX = 'read_own';
const HASH = computeContentHash({
  using: normalizePredicate(USING),
  roles: ['app_user'],
  operation: 'select',
  permissive: true,
});
const WIRE_NAME = `${PREFIX}_${HASH}`;

function managedPolicy(): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name: WIRE_NAME,
    prefix: PREFIX,
    tableName: TABLE_NAME,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: USING,
    permissive: true,
  });
}

function externalPolicy(): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name: 'legacy_admin_policy',
    prefix: 'legacy_admin_policy',
    tableName: TABLE_NAME,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: USING,
    permissive: true,
  });
}

function toPolicyNode(p: PostgresRlsPolicy): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    name: p.name,
    prefix: p.prefix,
    tableName: p.tableName,
    namespaceId: p.namespaceId,
    operation: p.operation,
    roles: [...p.roles],
    ...(p.using !== undefined ? { using: p.using } : {}),
    ...(p.withCheck !== undefined ? { withCheck: p.withCheck } : {}),
    permissive: p.permissive,
  });
}

function schemaWithPolicies(policies: PostgresRlsPolicy[]): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [TABLE_NAME]: new PostgresTableSchemaNode({
            name: TABLE_NAME,
            columns: {},
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: policies.map(toPolicyNode),
          }),
        },
        nativeEnumTypeNames: [],
      }),
    },
    pgVersion: 'unknown',
    roles: [],
    existingSchemas: ['public'],
  });
}

function emptyContractNoPolicies(): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: {}, policy: {} },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:collect-ext-no-policy'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:collect-ext-no-policy'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function contractWithPolicy(): Contract<SqlStorage> {
  const policy = managedPolicy();
  const schema = new PostgresSchema({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {},
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: { [WIRE_NAME]: policy },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:collect-ext-with-policy'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:collect-ext-with-policy'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

/**
 * Runs the combined database-schema diff and returns only the policy
 * (`schemaDiffIssues`) findings — the RLS drift these tests assert on.
 */
function policyDiffIssues(contract: Contract<SqlStorage>, schema: PostgresDatabaseSchemaNode) {
  return diffPostgresDatabaseSchema({
    contract,
    actualSchema: schema,
    strict: false,
    typeMetadataRegistry: new Map(),
    frameworkComponents: [],
  }).schema.schemaDiffIssues;
}

describe('diffDatabaseSchema — RLS drift detection', () => {
  it('no contract policy + Prisma-managed DB policy → one extra diff issue', () => {
    const issues = policyDiffIssues(
      emptyContractNoPolicies(),
      schemaWithPolicies([managedPolicy()]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.outcome).toBe('extra');
    expect(issues[0]?.actual).toMatchObject({ name: WIRE_NAME });
  });

  it('no contract policy + external DB policy → one extra diff issue', () => {
    const issues = policyDiffIssues(
      emptyContractNoPolicies(),
      schemaWithPolicies([externalPolicy()]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.outcome).toBe('extra');
    expect(issues[0]?.actual).toMatchObject({ name: 'legacy_admin_policy' });
  });

  it('matching contract + DB policy → no issues', () => {
    const issues = policyDiffIssues(contractWithPolicy(), schemaWithPolicies([managedPolicy()]));

    expect(issues).toHaveLength(0);
  });
});

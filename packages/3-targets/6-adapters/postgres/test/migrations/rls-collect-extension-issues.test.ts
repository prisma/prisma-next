import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import {
  computeContentHash,
  normalizePredicate,
} from '@prisma-next/target-postgres/rls-canonicalize';
import {
  PostgresRlsPolicy,
  PostgresSchema,
  PostgresSchemaIR,
  PostgresTableIR,
} from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { controlAdapter } from './fixtures/runner-fixtures';

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

function schemaWithPolicies(policies: PostgresRlsPolicy[]): PostgresSchemaIR {
  return new PostgresSchemaIR({
    tables: {
      [TABLE_NAME]: new PostgresTableIR({
        name: TABLE_NAME,
        columns: {},
        foreignKeys: [],
        uniques: [],
        indexes: [],
        rlsPolicies: policies,
      }),
    },
    pgSchemaName: 'public',
    pgVersion: 'unknown',
    roles: [],
    existingSchemas: ['public'],
    nativeEnumTypeNames: [],
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

describe('collectSchemaDiffIssues — RLS drift detection', () => {
  it('no contract policy + Prisma-managed DB policy → one extra diff issue', () => {
    const issues = controlAdapter.collectSchemaDiffIssues!(
      emptyContractNoPolicies(),
      schemaWithPolicies([managedPolicy()]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.outcome).toBe('extra');
    expect(issues[0]?.actual).toMatchObject({ name: WIRE_NAME });
  });

  it('no contract policy + external DB policy → one extra diff issue', () => {
    const issues = controlAdapter.collectSchemaDiffIssues!(
      emptyContractNoPolicies(),
      schemaWithPolicies([externalPolicy()]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.outcome).toBe('extra');
    expect(issues[0]?.actual).toMatchObject({ name: 'legacy_admin_policy' });
  });

  it('matching contract + DB policy → no issues', () => {
    const issues = controlAdapter.collectSchemaDiffIssues!(
      contractWithPolicy(),
      schemaWithPolicies([managedPolicy()]),
    );

    expect(issues).toHaveLength(0);
  });
});

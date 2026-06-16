import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { BaseSchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { verifyPostgresRlsPolicies } from '../../src/core/migrations/verify-postgres-rls-policies';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';

const TABLE_NAME = 'profiles';

function makePolicy(name: string, tableName = TABLE_NAME): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name,
    prefix: name.replace(/_[0-9a-f]{8}$/, ''),
    tableName,
    namespaceId: UNBOUND_NAMESPACE_ID,
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
  });
}

function makeContract(policies: readonly PostgresRlsPolicy[]): Contract<SqlStorage> {
  const policyEntries: Record<string, PostgresRlsPolicy> = {};
  for (const p of policies) {
    policyEntries[p.name] = p;
  }
  const schema = new PostgresSchema({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: policyEntries,
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:rls-verify-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:rls-verify-test'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeSchema(actualPolicies: readonly PostgresRlsPolicy[]): SqlSchemaIR {
  return {
    tables: {
      [TABLE_NAME]: {
        name: TABLE_NAME,
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    },
    annotations: {
      pg: {
        rlsPolicies: actualPolicies,
      },
    },
  };
}

describe('verifyPostgresRlsPolicies', () => {
  it('emits missing_rls_policy when a contract policy is absent from the DB', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const schema = makeSchema([]);

    const issues = verifyPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'missing_rls_policy',
      namespaceId: UNBOUND_NAMESPACE_ID,
      table: TABLE_NAME,
      message: expect.stringContaining('read_own_profiles_a1b2c3d4'),
    });
  });

  it('emits extra_rls_policy when a DB policy is absent from the contract', () => {
    const actualPolicy = makePolicy('read_own_profiles_deadbeef');
    const contract = makeContract([]);
    const schema = makeSchema([actualPolicy]);

    const issues = verifyPostgresRlsPolicies({ contract, schema, strict: true });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'extra_rls_policy',
      namespaceId: UNBOUND_NAMESPACE_ID,
      table: TABLE_NAME,
      message: expect.stringContaining('read_own_profiles_deadbeef'),
    });
  });

  it('emits no issues when contract and DB policy sets match exactly', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const schema = makeSchema([
      new PostgresRlsPolicy({
        name: 'read_own_profiles_a1b2c3d4',
        prefix: 'read_own_profiles',
        tableName: TABLE_NAME,
        namespaceId: UNBOUND_NAMESPACE_ID,
        operation: 'select',
        roles: ['authenticated'],
        using: '(auth.uid() = user_id)',
        permissive: true,
      }),
    ]);

    const issues = verifyPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('emits missing + extra for an edit (same prefix, different hash)', () => {
    const newPolicy = makePolicy('read_own_profiles_11111111');
    const oldPolicy = makePolicy('read_own_profiles_00000000');
    const contract = makeContract([newPolicy]);
    const schema = makeSchema([oldPolicy]);

    const issues = verifyPostgresRlsPolicies({ contract, schema, strict: true });

    expect(issues).toHaveLength(2);
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain('missing_rls_policy');
    expect(kinds).toContain('extra_rls_policy');
  });

  it('carries namespaceId and table on both missing and extra issues', () => {
    const contractPolicy = makePolicy('rp_a1b2c3d4');
    const actualPolicy = makePolicy('rp_deadbeef');
    const contract = makeContract([contractPolicy]);
    const schema = makeSchema([actualPolicy]);

    const issues = verifyPostgresRlsPolicies({ contract, schema, strict: true });

    for (const issue of issues as readonly BaseSchemaIssue[]) {
      expect(issue.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
      expect(issue.table).toBe(TABLE_NAME);
    }
  });

  it('returns empty when contract has no policies and DB has no policies', () => {
    const contract = makeContract([]);
    const schema = makeSchema([]);

    const issues = verifyPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('ignores DB policies on tables not in the schema IR (out-of-scope)', () => {
    const outsidePolicy = makePolicy('some_policy_aaaabbbb', 'other_table');
    const contract = makeContract([]);
    const schema = makeSchema([outsidePolicy]);

    const issues = verifyPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(0);
  });
});

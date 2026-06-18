import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { diffPostgresRlsPolicies } from '../../src/core/migrations/verify-postgres-rls-policies';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresSchemaIR } from '../../src/core/postgres-schema-ir';

const TABLE_NAME = 'profiles';
const SCHEMA_NAME = 'public';

function makePolicy(name: string, tableName = TABLE_NAME): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name,
    prefix: name.replace(/_[0-9a-f]{8}$/, ''),
    tableName,
    namespaceId: SCHEMA_NAME,
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
    id: SCHEMA_NAME,
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
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeSchema(actualPolicies: readonly PostgresRlsPolicy[]): PostgresSchemaIR {
  return new PostgresSchemaIR({
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
    pgSchemaName: 'public',
    pgVersion: 'unknown',
    rlsPolicies: actualPolicies,
    roles: [],
    existingSchemas: ['public'],
    nativeEnumTypeNames: [],
  });
}

describe('diffPostgresRlsPolicies', () => {
  it('emits missing outcome when a contract policy is absent from the DB', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const schema = makeSchema([]);

    const issues = diffPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'missing',
      coordinate: expect.objectContaining({ entityName: 'read_own_profiles_a1b2c3d4' }),
    });
  });

  it('emits extra outcome when a DB policy is absent from the contract', () => {
    const actualPolicy = makePolicy('read_own_profiles_deadbeef');
    const contract = makeContract([]);
    const schema = makeSchema([actualPolicy]);

    const issues = diffPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'extra',
      coordinate: expect.objectContaining({ entityName: 'read_own_profiles_deadbeef' }),
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
        namespaceId: SCHEMA_NAME,
        operation: 'select',
        roles: ['authenticated'],
        using: '(auth.uid() = user_id)',
        permissive: true,
      }),
    ]);

    const issues = diffPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('emits missing + extra for a name change (same prefix, different hash)', () => {
    const newPolicy = makePolicy('read_own_profiles_11111111');
    const oldPolicy = makePolicy('read_own_profiles_00000000');
    const contract = makeContract([newPolicy]);
    const schema = makeSchema([oldPolicy]);

    const issues = diffPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(2);
    const outcomes = issues.map((i) => i.outcome);
    expect(outcomes).toContain('missing');
    expect(outcomes).toContain('extra');
  });

  it('carries namespaceId on both missing and extra issues via coordinate', () => {
    const contractPolicy = makePolicy('rp_a1b2c3d4');
    const actualPolicy = makePolicy('rp_deadbeef');
    const contract = makeContract([contractPolicy]);
    const schema = makeSchema([actualPolicy]);

    const issues = diffPostgresRlsPolicies({ contract, schema });

    for (const issue of issues) {
      expect(issue.coordinate.namespaceId).toBe(SCHEMA_NAME);
    }
  });

  it('returns empty when contract has no policies and DB has no policies', () => {
    const contract = makeContract([]);
    const schema = makeSchema([]);

    const issues = diffPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('emits extra for a DB policy on a table not in the contract (strict drop)', () => {
    const outsidePolicy = makePolicy('some_policy_aaaabbbb', 'other_table');
    const contract = makeContract([]);
    const schema = makeSchema([outsidePolicy]);

    const issues = diffPostgresRlsPolicies({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'extra' });
  });
});

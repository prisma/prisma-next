import { coreHash, profileHash } from '@prisma-next/contract/types';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { collectContractRlsPolicies } from '../../src/core/migrations/collect-contract-postgres-nodes';
import { contractToPostgresSchemaIR } from '../../src/core/migrations/contract-to-postgres-schema-ir';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { isPostgresSchemaIR } from '../../src/core/postgres-schema-ir';
import { postgresRenderDefault } from '../../src/exports/control';

const TABLE_NAME = 'profiles';
const SCHEMA_NAME = 'public';

function makePolicy(name: string): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name,
    prefix: name.replace(/_[0-9a-f]{8}$/, ''),
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
  });
}

function makeContract(policies: readonly PostgresRlsPolicy[]): PostgresContract {
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
    profileHash: profileHash('sha256:project-from-contract-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:project-from-contract-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const projectionOptions = {
  annotationNamespace: 'pg',
  renderDefault: postgresRenderDefault,
} as const;

describe('contractToPostgresSchemaIR', () => {
  it('projects a SELECT policy into rlsPolicies and tables matching contractToSchemaIR', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);

    const ir = contractToPostgresSchemaIR(contract, projectionOptions);

    expect(isPostgresSchemaIR(ir)).toBe(true);
    expect(ir.rlsPolicies).toContainEqual(policy);
    expect(ir.tables).toEqual(contractToSchemaIR(contract, projectionOptions).tables);
  });

  it('returns no policies for a null contract', () => {
    const ir = contractToPostgresSchemaIR(null, projectionOptions);
    expect(ir.rlsPolicies).toEqual([]);
    expect(ir.tables).toEqual({});
    expect(isPostgresSchemaIR(ir)).toBe(true);
  });

  it('collectContractRlsPolicies returns the contract policies', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    expect(collectContractRlsPolicies(contract)).toEqual([policy]);
  });

  it('collectContractRlsPolicies returns empty for null', () => {
    expect(collectContractRlsPolicies(null)).toEqual([]);
  });
});

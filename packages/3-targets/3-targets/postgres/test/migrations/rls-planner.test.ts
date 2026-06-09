/**
 * Snapshot test: a contract with one table and one RLS policy, against an
 * empty introspected schema, produces an ordered plan: CREATE TABLE first,
 * then ENABLE ROW LEVEL SECURITY, then CREATE POLICY.
 *
 * The RLS calls are produced by the diffNodes path in planSql(), not by
 * mapIssueToCall().
 */

import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { Lowerer } from '@prisma-next/family-sql/control-adapter';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';

/** Minimal lowerer that produces stub SQL for `createTable` DDL nodes. */
const stubLowerer: Lowerer = {
  lower(_ast, _ctx) {
    return { sql: 'CREATE TABLE stub', params: [] };
  },
};

const TABLE_NAME = 'profiles';
const SCHEMA_NAME = UNBOUND_NAMESPACE_ID;

function buildContractWithPolicy(): Contract<SqlStorage> {
  const policy = new PostgresRlsPolicy({
    name: 'read_own_profiles_a1b2c3d4',
    prefix: 'read_own_profiles',
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
  });

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
      type: {},
      rlsPolicy: { [policy.name]: policy },
    },
  });

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:rls-planner-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:rls-planner-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const emptySchema = { tables: {} };

describe('RLS planner diff-wiring', () => {
  it('produces CREATE TABLE → ENABLE ROW LEVEL SECURITY → CREATE POLICY for a fresh contract', () => {
    const contract = buildContractWithPolicy();
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const opIds = result.plan.operations.map((op) => op.id);

    const createTableIdx = opIds.findIndex((id) => id.startsWith('table.'));
    const enableRlsIdx = opIds.findIndex((id) => id.startsWith('rowLevelSecurity.'));
    const createPolicyIdx = opIds.findIndex((id) => id.startsWith('rlsPolicy.'));

    expect(createTableIdx).toBeGreaterThanOrEqual(0);
    expect(enableRlsIdx).toBeGreaterThanOrEqual(0);
    expect(createPolicyIdx).toBeGreaterThanOrEqual(0);

    expect(createTableIdx).toBeLessThan(enableRlsIdx);
    expect(enableRlsIdx).toBeLessThan(createPolicyIdx);
  });

  it('emits ENABLE ROW LEVEL SECURITY with ALTER TABLE DDL', () => {
    const contract = buildContractWithPolicy();
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const allExecuteSql = result.plan.operations.flatMap((op) =>
      op.execute.map((step) => step.sql),
    );
    const enableRlsSql = allExecuteSql.find((s) => s.includes('ENABLE ROW LEVEL SECURITY'));
    expect(enableRlsSql).toContain(TABLE_NAME);
  });

  it('emits CREATE POLICY with the correct wire name and USING clause', () => {
    const contract = buildContractWithPolicy();
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const allExecuteSql = result.plan.operations.flatMap((op) =>
      op.execute.map((step) => step.sql),
    );
    const createPolicySql = allExecuteSql.find((s) => s.includes('CREATE POLICY'));
    expect(createPolicySql).toContain('read_own_profiles_a1b2c3d4');
    expect(createPolicySql).toContain('auth.uid()');
  });

  it('does not emit RLS ops when the policy already exists in the introspected schema', () => {
    const contract = buildContractWithPolicy();
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const existingPolicy = new PostgresRlsPolicy({
      name: 'read_own_profiles_a1b2c3d4',
      prefix: 'read_own_profiles',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = user_id)',
      permissive: true,
    });

    const schemaWithPolicy = {
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
          rlsPolicies: [existingPolicy],
          rlsEnabledByTable: { [TABLE_NAME]: true },
        },
      },
    };

    const result = planner.plan({
      contract,
      schema: schemaWithPolicy,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const opIds = result.plan.operations.map((op) => op.id);
    expect(opIds.some((id) => id.startsWith('rlsPolicy.'))).toBe(false);
    expect(opIds.some((id) => id.startsWith('rowLevelSecurity.'))).toBe(false);
  });
});

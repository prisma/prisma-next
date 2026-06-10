/**
 * Unit tests for the RLS planner diff path in planSql():
 * - Fresh contract → CREATE TABLE + ENABLE RLS + CREATE POLICY ordering
 * - Edit (same-prefix, different hash) → CREATE new + DROP old
 * - Different-prefix actual policy → not dropped
 * - Same-prefix sibling still in contract → not dropped when the other sibling is created
 * - F06: additive-only policy filters the replace-drop but keeps create/enable
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

describe('RLS planner same-prefix replace', () => {
  // Contract has p_read_NEW; DB has p_read_OLD (same prefix, different hash).
  // Edit case: plan must contain a CREATE for NEW and a DROP for OLD.
  it('emits CREATE new + DROP old when same-prefix policy is superseded', () => {
    const newPolicy = new PostgresRlsPolicy({
      name: 'p_read_11111111',
      prefix: 'p_read',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = user_id)',
      permissive: true,
    });

    const contract = buildContractWith([newPolicy]);
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const oldPolicy = new PostgresRlsPolicy({
      name: 'p_read_00000000',
      prefix: 'p_read',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = old_user_id)',
      permissive: true,
    });

    const schema = schemaWith([oldPolicy], true);
    const DB_UPDATE_POLICY = {
      allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
    };

    const result = planner.plan({
      contract,
      schema,
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const opIds = result.plan.operations.map((op) => op.id);
    expect(opIds).toContain(`rlsPolicy.${TABLE_NAME}.p_read_11111111`);
    expect(opIds).toContain(`rlsPolicy.${TABLE_NAME}.p_read_00000000.drop`);
  });

  it('does not drop a different-prefix actual policy when creating a new one', () => {
    const newPolicy = new PostgresRlsPolicy({
      name: 'p_read_11111111',
      prefix: 'p_read',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = user_id)',
      permissive: true,
    });

    const contract = buildContractWith([newPolicy]);
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const externalPolicy = new PostgresRlsPolicy({
      name: 'other_aaaabbbb',
      prefix: 'other',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: 'true',
      permissive: true,
    });

    const schema = schemaWith([externalPolicy], true);
    const DB_UPDATE_POLICY = {
      allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
    };

    const result = planner.plan({
      contract,
      schema,
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const opIds = result.plan.operations.map((op) => op.id);
    expect(opIds).toContain(`rlsPolicy.${TABLE_NAME}.p_read_11111111`);
    expect(opIds).not.toContain(`rlsPolicy.${TABLE_NAME}.other_aaaabbbb.drop`);
  });

  it('does not drop a same-prefix sibling that is still in the contract', () => {
    // Contract has both policyA and policyB (same prefix).
    // DB only has policyA — so policyB is `missing` and triggers a CREATE.
    // During same-prefix drop scanning for policyB's CREATE, policyA matches
    // the prefix but IS in expectedNames — the !expectedNames guard must
    // protect it from being dropped.
    const policyA = new PostgresRlsPolicy({
      name: 'p_read_aaaaaaaa',
      prefix: 'p_read',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = user_id)',
      permissive: true,
    });
    const policyB = new PostgresRlsPolicy({
      name: 'p_read_bbbbbbbb',
      prefix: 'p_read',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['service_role'],
      using: 'true',
      permissive: true,
    });

    const contract = buildContractWith([policyA, policyB]);
    const planner = createPostgresMigrationPlanner(stubLowerer);

    // Only policyA is in the DB — policyB is missing, so the drop loop runs.
    const schema = schemaWith([policyA], true);
    const DB_UPDATE_POLICY = {
      allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
    };

    const result = planner.plan({
      contract,
      schema,
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const opIds = result.plan.operations.map((op) => op.id);
    // policyB is missing — a CREATE must be emitted
    expect(opIds).toContain(`rlsPolicy.${TABLE_NAME}.p_read_bbbbbbbb`);
    // policyA shares the same prefix but is still in the contract — must not be dropped
    expect(opIds).not.toContain(`rlsPolicy.${TABLE_NAME}.p_read_aaaaaaaa.drop`);
  });

  it('F06: additive-only policy passes create/enable but filters the replace-drop', () => {
    const newPolicy = new PostgresRlsPolicy({
      name: 'p_read_11111111',
      prefix: 'p_read',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = user_id)',
      permissive: true,
    });

    const contract = buildContractWith([newPolicy]);
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const oldPolicy = new PostgresRlsPolicy({
      name: 'p_read_00000000',
      prefix: 'p_read',
      tableName: TABLE_NAME,
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = old_user_id)',
      permissive: true,
    });

    const schema = schemaWith([oldPolicy], true);

    // INIT_ADDITIVE_POLICY allows only 'additive' — the drop is 'destructive'.
    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const opIds = result.plan.operations.map((op) => op.id);
    // CREATE new: additive — allowed
    expect(opIds).toContain(`rlsPolicy.${TABLE_NAME}.p_read_11111111`);
    // DROP old: destructive — filtered
    expect(opIds).not.toContain(`rlsPolicy.${TABLE_NAME}.p_read_00000000.drop`);
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildContractWith(policies: readonly PostgresRlsPolicy[]): Contract<SqlStorage> {
  const rlsPolicy: Record<string, PostgresRlsPolicy> = {};
  for (const p of policies) {
    rlsPolicy[p.name] = p;
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
      type: {},
      rlsPolicy,
    },
  });

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:rls-planner-replace-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:rls-planner-replace-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function schemaWith(policies: readonly PostgresRlsPolicy[], rlsEnabled: boolean) {
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
        rlsPolicies: policies,
        ...(rlsEnabled ? { rlsEnabledByTable: { [TABLE_NAME]: true } } : {}),
      },
    },
  };
}

/**
 * Unit tests for the RLS planner — verifyPostgresRlsPolicies feeds SchemaIssue[]
 * through the generic pipeline (collectSchemaIssues → planIssues → mapIssueToCall).
 *
 * - Fresh contract → CREATE TABLE + ENABLE RLS + CREATE POLICY ordering
 * - Edit (same prefix, different hash) → CREATE new + DROP old via missing+extra issues
 * - Policy already present → no RLS ops emitted
 * - Extra policy on managed table with destructive policy → DROP emitted
 * - Additive-only policy → DROP filtered, CREATE emitted
 * - Multiple policies on the same table → only one ENABLE RLS emitted
 */

import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresSchemaIR } from '../../src/core/postgres-schema-ir';
import { PostgresCreatePolicy } from '../../src/exports/ddl';

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'CREATE TABLE stub', params: [] };
  },
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'CREATE TABLE stub', params: [] };
  },
};

const TABLE_NAME = 'profiles';
const SCHEMA_NAME = UNBOUND_NAMESPACE_ID;

function makePolicy(
  name: string,
  tableName = TABLE_NAME,
  using = '(auth.uid() = user_id)',
): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name,
    prefix: name.replace(/_[0-9a-f]{8}$/, ''),
    tableName,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['authenticated'],
    using,
    permissive: true,
  });
}

function buildContractWithPolicy(
  policy: PostgresRlsPolicy = makePolicy('read_own_profiles_a1b2c3d4'),
): Contract<SqlStorage> {
  return buildContractWith([policy]);
}

function buildContractWith(policies: readonly PostgresRlsPolicy[]): Contract<SqlStorage> {
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

function schemaWith(policies: readonly PostgresRlsPolicy[]): PostgresSchemaIR {
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
    rlsPolicies: policies,
    roles: [],
    existingSchemas: ['public'],
    nativeEnumTypeNames: [],
  });
}

const emptySchema = new PostgresSchemaIR({
  tables: {},
  pgSchemaName: 'public',
  pgVersion: 'unknown',
  rlsPolicies: [],
  roles: [],
  existingSchemas: ['public'],
  nativeEnumTypeNames: [],
});
const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

describe('RLS planner diff-wiring', () => {
  it('produces CREATE TABLE → ENABLE ROW LEVEL SECURITY → CREATE POLICY for a fresh contract', async () => {
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

    const ops = await Promise.all(result.plan.operations);
    const opIds = ops.map((op) => op.id);

    const createTableIdx = opIds.findIndex((id) => id.startsWith('table.'));
    const enableRlsIdx = opIds.findIndex((id) => id.startsWith('rowLevelSecurity.'));
    const createPolicyIdx = opIds.findIndex((id) => id.startsWith('rlsPolicy.'));

    expect(createTableIdx).toBeGreaterThanOrEqual(0);
    expect(enableRlsIdx).toBeGreaterThanOrEqual(0);
    expect(createPolicyIdx).toBeGreaterThanOrEqual(0);

    expect(createTableIdx).toBeLessThan(enableRlsIdx);
    expect(enableRlsIdx).toBeLessThan(createPolicyIdx);
  });

  it('emits ENABLE ROW LEVEL SECURITY with ALTER TABLE DDL', async () => {
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

    const ops = await Promise.all(result.plan.operations);
    const allExecuteSql = ops.flatMap((op) => op.execute.map((step) => step.sql));
    const enableRlsSql = allExecuteSql.find((s) => s.includes('ENABLE ROW LEVEL SECURITY'));
    expect(enableRlsSql).toContain(TABLE_NAME);
  });

  it('emits CREATE POLICY with the correct wire name and USING clause', async () => {
    const contract = buildContractWithPolicy();
    const received: unknown[] = [];
    const recordingLowerer: ExecuteRequestLowerer = {
      lower: stubLowerer.lower,
      lowerToExecuteRequest: async (ast) => {
        received.push(ast);
        return { sql: 'stub', params: [] };
      },
    };
    const planner = createPostgresMigrationPlanner(recordingLowerer);

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

    await Promise.all(result.plan.operations);
    const createPolicyNode = received.find((n) => n instanceof PostgresCreatePolicy) as
      | PostgresCreatePolicy
      | undefined;
    expect(createPolicyNode).toBeDefined();
    expect(createPolicyNode?.name).toContain('read_own_profiles_a1b2c3d4');
    expect(createPolicyNode?.using).toContain('auth.uid()');
  });

  it('does not emit RLS ops when the policy already exists in the introspected schema', async () => {
    const contract = buildContractWithPolicy();
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const existingPolicy = makePolicy('read_own_profiles_a1b2c3d4');
    const schema = schemaWith([existingPolicy]);

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

    const ops = await Promise.all(result.plan.operations);
    const opIds = ops.map((op) => op.id);
    expect(opIds.some((id) => id.startsWith('rlsPolicy.'))).toBe(false);
    expect(opIds.some((id) => id.startsWith('rowLevelSecurity.'))).toBe(false);
  });

  it('emits only one ENABLE RLS even when two policies on the same table are both missing', async () => {
    const policy1 = makePolicy('read_own_11111111');
    const policy2 = makePolicy('write_own_22222222');
    const contract = buildContractWith([policy1, policy2]);
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

    const ops = await Promise.all(result.plan.operations);
    const enableRlsOps = ops.filter((op) => op.id.startsWith('rowLevelSecurity.'));
    expect(enableRlsOps).toHaveLength(1);
  });
});

describe('RLS planner policy edit (missing + extra via generic pipeline)', () => {
  it('emits CREATE new + DROP old when same-prefix policy is superseded', async () => {
    const newPolicy = makePolicy('p_read_11111111');
    const contract = buildContractWith([newPolicy]);
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const oldPolicy = makePolicy('p_read_00000000', TABLE_NAME, '(auth.uid() = old_user_id)');
    const schema = schemaWith([oldPolicy]);

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

    const ops = await Promise.all(result.plan.operations);
    const opIds = ops.map((op) => op.id);
    expect(opIds).toContain(`rlsPolicy.public.${TABLE_NAME}.p_read_11111111`);
    expect(opIds).toContain(`rlsPolicy.public.${TABLE_NAME}.p_read_00000000.drop`);
  });

  it('additive-only policy passes create/enable but filters the extra-policy drop', async () => {
    const newPolicy = makePolicy('p_read_11111111');
    const contract = buildContractWith([newPolicy]);
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const oldPolicy = makePolicy('p_read_00000000', TABLE_NAME, '(auth.uid() = old_user_id)');
    const schema = schemaWith([oldPolicy]);

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

    const ops = await Promise.all(result.plan.operations);
    const opIds = ops.map((op) => op.id);
    expect(opIds).toContain(`rlsPolicy.public.${TABLE_NAME}.p_read_11111111`);
    expect(opIds).not.toContain(`rlsPolicy.public.${TABLE_NAME}.p_read_00000000.drop`);
  });
});

// On the `migration plan` path the planner receives a SqlSchemaIR derived from the
// "from" contract (not a live-introspected PostgresSchemaIR). RLS policies cannot
// be correctly reconciled without a live schema, so the planner must fail loudly
// instead of silently emitting no RLS DDL when the contract declares policies.
const derivedSchema = new SqlSchemaIR({
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
});

describe('migration plan path (non-PostgresSchemaIR schema)', () => {
  it('returns unsupportedOperation failure when the contract declares RLS policies', () => {
    const contract = buildContractWithPolicy();
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract,
      schema: derivedSchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.kind).toBe('unsupportedOperation');
    expect(result.conflicts[0]!.summary).toContain('RLS');
  });

  it('succeeds when the contract declares no RLS policies', () => {
    const contractWithNoRls = buildContractWith([]);
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: contractWithNoRls,
      schema: derivedSchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
  });
});

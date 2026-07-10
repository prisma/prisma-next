/**
 * Unit tests for the RLS planner — the one-differ tree diff feeds node-typed
 * `SchemaDiffIssue`s through the generic pipeline (`planIssues` → the node
 * issue-to-call mapper).
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
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
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
const RESOLVED_SCHEMA = 'public';

function makePolicy(
  name: string,
  tableName = TABLE_NAME,
  using = '(auth.uid() = user_id)',
  namespaceId: string = SCHEMA_NAME,
): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name,
    prefix: name.replace(/_[0-9a-f]{8}$/, ''),
    tableName,
    namespaceId,
    operation: 'select',
    roles: ['authenticated'],
    using,
    permissive: true,
  });
}

function makeActualPolicy(
  name: string,
  tableName = TABLE_NAME,
  using = '(auth.uid() = user_id)',
): PostgresRlsPolicy {
  return makePolicy(name, tableName, using, RESOLVED_SCHEMA);
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

function policyNode(policy: PostgresRlsPolicy): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    name: policy.name,
    prefix: policy.prefix,
    tableName: policy.tableName,
    namespaceId: policy.namespaceId,
    operation: policy.operation,
    roles: [...policy.roles],
    ...(policy.using !== undefined ? { using: policy.using } : {}),
    ...(policy.withCheck !== undefined ? { withCheck: policy.withCheck } : {}),
    permissive: policy.permissive,
  });
}

function schemaWith(policies: readonly PostgresRlsPolicy[]): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [TABLE_NAME]: new PostgresTableSchemaNode({
            name: TABLE_NAME,
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: policies.map(policyNode),
          }),
        },
        nativeEnumTypeNames: [],
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
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

    const existingPolicy = makeActualPolicy('read_own_profiles_a1b2c3d4');
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

    const oldPolicy = makeActualPolicy('p_read_00000000', TABLE_NAME, '(auth.uid() = old_user_id)');
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

    const oldPolicy = makeActualPolicy('p_read_00000000', TABLE_NAME, '(auth.uid() = old_user_id)');
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

// `migration plan` derives a contract-backed PostgresDatabaseSchemaNode (the
// `contractToPostgresDatabaseSchemaNode` projection) and emits CREATE POLICY
// through the same diff pipeline as the live paths. A non-database-root schema
// is rejected; the `migration plan` e2e proves the emission end-to-end.

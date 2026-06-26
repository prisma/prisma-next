import { asNamespaceId, type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { contractToSchemaIR, INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import { PostgresSchemaIR, postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

function createFkTestContract(fkConfig: {
  constraint: boolean;
  index: boolean;
  includeUserIndex?: boolean;
}): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:contract'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  userId: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: (fkConfig.includeUserIndex ?? true) ? [{ columns: ['userId'] }] : [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'post',
                      columns: ['userId'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'user',
                      columns: ['id'],
                    },
                    constraint: fkConfig.constraint,
                    index: fkConfig.index,
                  },
                ],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const emptySchema = new PostgresSchemaIR({
  tables: {},
  pgSchemaName: 'public',
  pgVersion: '',
  rlsPolicies: [],
  roles: [],
  existingSchemas: [],
  nativeEnumTypeNames: [],
});

const MIGRATION_PLAN_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
} as const;

describe('PostgresMigrationPlanner - per-FK config combinations', () => {
  const planner = createPostgresMigrationPlanner(
    new PostgresControlAdapter(createPostgresBuiltinCodecLookup()),
  );

  it('emits both FK constraints and FK indexes when constraint=true, index=true', async () => {
    const contract = createFkTestContract({ constraint: true, index: true });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('emits FK constraint and user-declared index when constraint=true, index=false (user-declared index survives)', async () => {
    const contract = createFkTestContract({ constraint: true, index: false });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    // User-declared index is always emitted regardless of FK index flag
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('omits FK constraints but emits FK indexes when constraint=false, index=true', async () => {
    const contract = createFkTestContract({ constraint: false, index: true });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).not.toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('omits FK constraints but user-declared index survives when constraint=false, index=false', async () => {
    const contract = createFkTestContract({ constraint: false, index: false });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).not.toContain('foreignKey.post.post_userId_fkey');
    // User-declared index is always emitted regardless of FK index flag
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('auto-creates FK-backing index when index=true and no user-declared index exists', async () => {
    const contract = createFkTestContract({
      constraint: true,
      index: true,
      includeUserIndex: false,
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    // FK-backing index auto-created since no user-declared index covers it
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('does not auto-create FK-backing index when index=false and no user-declared index exists', async () => {
    const contract = createFkTestContract({
      constraint: true,
      index: false,
      includeUserIndex: false,
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    // No index: no user-declared and FK index=false
    expect(operationIds).not.toContain('index.post.post_userId_idx');
  });

  it('does not plan a destructive drop for a constraintless FK in offline from-contract schema', async () => {
    const fromContract = createWorkflowStateContract({
      storageHash: coreHash('sha256:from'),
      includeStateColumn: false,
    });
    const contract = createWorkflowStateContract({
      storageHash: coreHash('sha256:to'),
      includeStateColumn: true,
    });
    const schema = new PostgresSchemaIR({
      tables: contractToSchemaIR(fromContract, { annotationNamespace: 'pg' }).tables,
      pgSchemaName: 'public',
      pgVersion: '',
      rlsPolicies: [],
      roles: [],
      existingSchemas: [],
      nativeEnumTypeNames: [],
    });

    const result = planner.plan({
      contract,
      schema,
      policy: MIGRATION_PLAN_POLICY,
      fromContract,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const ops = await Promise.all(result.plan.operations);
    const operationIds = ops.map((op) => op.id);
    expect(operationIds).toContain('column.__unbound__.workflow_states.state');
    expect(operationIds).not.toContain('dropConstraint.workflow_states.fk(workflow_id)');
    expect(ops).not.toContainEqual(
      expect.objectContaining({
        operationClass: 'destructive',
        label: expect.stringContaining('fk(workflow_id)'),
      }),
    );
  });
});

function createWorkflowStateContract(options: {
  storageHash: ReturnType<typeof coreHash>;
  includeStateColumn: boolean;
}): Contract<SqlStorage> {
  const workflowStateColumns = {
    workflow_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
    team_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
    ...(options.includeStateColumn
      ? { state: { nativeType: 'jsonb', codecId: 'pg/json@1', nullable: true } }
      : {}),
  };

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: options.storageHash,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              teams: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              workflows: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  team_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id', 'team_id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflows',
                      columns: ['team_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'teams',
                      columns: ['id'],
                    },
                    constraint: true,
                    index: false,
                  },
                ],
              },
              workflow_states: {
                columns: workflowStateColumns,
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflow_states',
                      columns: ['workflow_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflows',
                      columns: ['id'],
                    },
                    constraint: false,
                    index: true,
                  },
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflow_states',
                      columns: ['workflow_id', 'team_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflows',
                      columns: ['id', 'team_id'],
                    },
                    name: 'workflow_states_workflow_team_id_fkey',
                    onDelete: 'cascade',
                    constraint: true,
                    index: false,
                  },
                ],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

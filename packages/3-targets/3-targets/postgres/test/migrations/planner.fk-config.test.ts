import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

function createFkTestContract(foreignKeys?: {
  constraints: boolean;
  indexes: boolean;
}): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:contract'),
    profileHash: profileHash('sha256:profile'),
    storage: {
      tables: {
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
          indexes: [{ columns: ['userId'] }],
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
            },
          ],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    ...(foreignKeys !== undefined && { foreignKeys }),
  };
}

const emptySchema: SqlSchemaIR = {
  tables: {},
  extensions: [],
};

describe('PostgresMigrationPlanner - FK config combinations', () => {
  const planner = createPostgresMigrationPlanner();

  it('emits both FK constraints and FK indexes when constraints=true, indexes=true', () => {
    const contract = createFkTestContract({ constraints: true, indexes: true });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = result.plan.operations.map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('emits FK constraints but omits FK indexes when constraints=true, indexes=false', () => {
    const contract = createFkTestContract({ constraints: true, indexes: false });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = result.plan.operations.map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).not.toContain('index.post.post_userId_idx');
  });

  it('omits FK constraints but emits FK indexes when constraints=false, indexes=true', () => {
    const contract = createFkTestContract({ constraints: false, indexes: true });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = result.plan.operations.map((op) => op.id);
    expect(operationIds).not.toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('omits both FK constraints and FK indexes when constraints=false, indexes=false', () => {
    const contract = createFkTestContract({ constraints: false, indexes: false });
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = result.plan.operations.map((op) => op.id);
    expect(operationIds).not.toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).not.toContain('index.post.post_userId_idx');
  });

  it('defaults to emitting both when foreignKeys config is undefined', () => {
    const contract = createFkTestContract(undefined);
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const operationIds = result.plan.operations.map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).toContain('index.post.post_userId_idx');
  });
});

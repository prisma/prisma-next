import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

function createFkTestContract(fkConfig: {
  constraint: boolean;
  index: boolean;
  includeUserIndex?: boolean;
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
          indexes: (fkConfig.includeUserIndex ?? true) ? [{ columns: ['userId'] }] : [],
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: fkConfig.constraint,
              index: fkConfig.index,
            },
          ],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

const emptySchema: SqlSchemaIR = {
  tables: {},
  extensions: [],
};

describe('PostgresMigrationPlanner - per-FK config combinations', () => {
  const planner = createPostgresMigrationPlanner();

  it('emits both FK constraints and FK indexes when constraint=true, index=true', () => {
    const contract = createFkTestContract({ constraint: true, index: true });
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

  it('emits FK constraint and user-declared index when constraint=true, index=false (user-declared index survives)', () => {
    const contract = createFkTestContract({ constraint: true, index: false });
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
    // User-declared index is always emitted regardless of FK index flag
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('omits FK constraints but emits FK indexes when constraint=false, index=true', () => {
    const contract = createFkTestContract({ constraint: false, index: true });
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

  it('omits FK constraints but user-declared index survives when constraint=false, index=false', () => {
    const contract = createFkTestContract({ constraint: false, index: false });
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
    // User-declared index is always emitted regardless of FK index flag
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('auto-creates FK-backing index when index=true and no user-declared index exists', () => {
    const contract = createFkTestContract({
      constraint: true,
      index: true,
      includeUserIndex: false,
    });

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
    // FK-backing index auto-created since no user-declared index covers it
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('does not auto-create FK-backing index when index=false and no user-declared index exists', () => {
    const contract = createFkTestContract({
      constraint: true,
      index: false,
      includeUserIndex: false,
    });

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
    // No index: no user-declared and FK index=false
    expect(operationIds).not.toContain('index.post.post_userId_idx');
  });
});

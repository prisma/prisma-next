import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

describe('PostgresMigrationPlanner - subset/superset/conflict handling', () => {
  const planner = createPostgresMigrationPlanner();
  const contract = createTestContract();

  it('returns empty plan when schema already satisfies contract (superset)', () => {
    const schema: SqlSchemaIR = {
      tables: {
        user: buildUserTableSchema(),
        post: buildPostTableSchema(),
        extra: {
          name: 'extra',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result).toMatchObject({
      kind: 'success',
      plan: { operations: [] },
    });
  });

  it('plans additive operations for subset schema (missing column/index/fk)', () => {
    const schema: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error('expected planner success for additive subset');
    }
    expect(result.plan.operations.map((op) => op.id)).toEqual([
      'table.post',
      'column.user.email',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
  });

  it('fails with conflicts when schema has incompatible column types', () => {
    const schema: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            email: { name: 'email', nativeType: 'uuid', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [
        expect.objectContaining({
          kind: 'typeMismatch',
          location: {
            table: 'user',
            column: 'email',
          },
        }),
      ],
    });
  });
});

function createTestContract(overrides?: Partial<SqlContract<SqlStorage>>): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:contract' as never,
    profileHash: 'sha256:profile' as never,
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [{ columns: ['email'] }],
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
          indexes: [],
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
    ...overrides,
  };
}

function buildUserTableSchema(): SqlSchemaIR['tables'][string] {
  return {
    name: 'user',
    columns: {
      id: { name: 'id', nativeType: 'uuid', nullable: false },
      email: { name: 'email', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [{ columns: ['email'], name: 'user_email_key' }],
    foreignKeys: [],
    indexes: [{ columns: ['email'], name: 'user_email_idx', unique: false }],
  };
}

function buildPostTableSchema(): SqlSchemaIR['tables'][string] {
  return {
    name: 'post',
    columns: {
      id: { name: 'id', nativeType: 'uuid', nullable: false },
      userId: { name: 'userId', nativeType: 'uuid', nullable: false },
      title: { name: 'title', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    foreignKeys: [
      {
        columns: ['userId'],
        referencedTable: 'user',
        referencedColumns: ['id'],
        name: 'post_userId_fkey',
      },
    ],
    indexes: [],
  };
}

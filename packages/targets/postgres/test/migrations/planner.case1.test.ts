import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:contract',
  profileHash: 'sha256:profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          embedding: { nativeType: 'vector', codecId: 'pg/vector@1', nullable: true },
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
  extensions: {
    pgvector: {},
  },
  meta: {},
  sources: {},
};

const emptySchema: SqlSchemaIR = {
  tables: {},
  extensions: [],
};

describe('PostgresMigrationPlanner (Case 1)', () => {
  it('builds additive plan for empty schema', () => {
    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
    });

    expect(result.kind).toBe('success');
    const operations = result.plan.operations;
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.map((op) => op.id)).toEqual([
      'extension.pgvector',
      'table.post',
      'table.user',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
    expect(operations[0]).toMatchObject({
      label: 'Enable extension "pgvector"',
      execute: [{ sql: 'CREATE EXTENSION IF NOT EXISTS vector' }],
    });
    expect(operations.find((op) => op.id === 'table.user')).toMatchObject({
      execute: [
        {
          sql: expect.stringContaining('CREATE TABLE "public"."user"'),
        },
      ],
    });
  });

  it('fails when schema is not empty', () => {
    const planner = createPostgresMigrationPlanner();
    const nonEmptySchema: SqlSchemaIR = {
      tables: {
        existing: {
          name: 'existing',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const result = planner.plan({
      contract,
      schema: nonEmptySchema,
      policy: INIT_ADDITIVE_POLICY,
    });

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
        },
      ],
    });
  });
});

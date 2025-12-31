import type { ComponentDatabaseDependency } from '@prisma-next/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

/**
 * Creates a test database dependency for pgvector.
 * This mimics what the pgvector extension descriptor provides.
 */
function createPgvectorDependency(): ComponentDatabaseDependency<unknown> {
  return {
    id: 'postgres.extension.vector',
    label: 'Enable vector extension',
    install: [
      {
        id: 'extension.pgvector',
        label: 'Enable extension "pgvector"',
        summary: 'Ensures the vector extension is available for pgvector operations',
        operationClass: 'additive',
        target: { id: 'postgres' },
        precheck: [
          {
            description: 'verify extension "vector" is not already enabled',
            sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
          },
        ],
        execute: [
          {
            description: 'create extension "vector"',
            sql: 'CREATE EXTENSION IF NOT EXISTS vector',
          },
        ],
        postcheck: [
          {
            description: 'confirm extension "vector" is enabled',
            sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
          },
        ],
      },
    ],
    verifyDatabaseDependenciesInstalled: (schema) => {
      if (!schema.extensions.includes('vector')) {
        return [
          {
            kind: 'extension_missing',
            table: '',
            message: 'Extension "vector" is missing from database (required by pgvector)',
          },
        ];
      }
      return [];
    },
  };
}

function createTestContract(overrides?: Partial<SqlContract<SqlStorage>>): SqlContract<SqlStorage> {
  return {
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
    ...overrides,
  };
}

const contract = createTestContract();

const emptySchema: SqlSchemaIR = {
  tables: {},
  extensions: [],
};

describe('PostgresMigrationPlanner - when database is empty', () => {
  it('builds additive plan for empty schema with database dependencies', () => {
    const planner = createPostgresMigrationPlanner();
    const databaseDependencies = [createPgvectorDependency()];

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      databaseDependencies,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
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

  it('builds additive plan for empty schema without database dependencies', () => {
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      // No databaseDependencies - planner should work without extensions
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    const operations = result.plan.operations;
    // No extension operations when no dependencies are provided
    expect(operations.map((op) => op.id)).toEqual([
      'table.post',
      'table.user',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
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
          summary: expect.stringContaining('Found 1 existing table(s): existing'),
        },
      ],
    });
  });

  it('lists all existing tables in error message', () => {
    const planner = createPostgresMigrationPlanner();
    const nonEmptySchema: SqlSchemaIR = {
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        posts: {
          name: 'posts',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        comments: {
          name: 'comments',
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
          summary: expect.stringContaining('Found 3 existing table(s): comments, posts, users'),
        },
      ],
    });
  });

  // NOTE: Extension validation is no longer done by the planner.
  // Extensions are now validated via component-owned database dependencies.
  // Each component declares its dependencies and the verifier checks if they're installed.
});

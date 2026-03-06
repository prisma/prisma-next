import { coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  ComponentDatabaseDependency,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import type { PostgresColumnDefault } from '../../src/core/types';

const pgvectorDependency: ComponentDatabaseDependency<unknown> = {
  id: 'postgres.extension.pgvector',
  label: 'Enable extension "vector"',
  install: [
    {
      id: 'extension.pgvector',
      label: 'Enable extension "vector"',
      summary: 'Ensures the pgvector extension is enabled for vector columns',
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
  verifyDatabaseDependencyInstalled: (schema) => {
    if (schema.extensions.includes('vector')) {
      return [];
    }
    return [
      {
        kind: 'extension_missing',
        table: '',
        message: 'Extension "vector" is missing from database',
      },
    ];
  },
};

type PostgresStorageColumn = Omit<StorageColumn, 'default'> & {
  readonly default?: PostgresColumnDefault;
};

function createFrameworkComponent(): SqlControlExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id: 'pgvector',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    operationSignatures: () => [],
    databaseDependencies: { init: [pgvectorDependency] },
    create: () => ({ familyId: 'sql', targetId: 'postgres' }) as never,
  };
}

function createTestContract(overrides?: Partial<SqlContract<SqlStorage>>): SqlContract<SqlStorage> {
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
              constraint: true,
              index: true,
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
    extensionPacks: {
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
    const frameworkComponents = [createFrameworkComponent()];

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
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
      'index.post.post_userId_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
    expect(operations[0]).toMatchObject({
      label: 'Enable extension "vector"',
      execute: [{ sql: 'CREATE EXTENSION IF NOT EXISTS vector' }],
    });
    expect(operations.find((op) => op.id === 'table.user')).toMatchObject({
      execute: [
        {
          sql: expect.stringContaining('CREATE TABLE "public"."user"'),
        },
      ],
    });
    const uniqueOp = operations.find((op) => op.id === 'unique.user.user_email_key');
    expect(uniqueOp).toMatchObject({
      operationClass: 'additive',
      target: {
        details: {
          objectType: 'unique',
          name: 'user_email_key',
          table: 'user',
          schema: 'public',
        },
      },
      execute: [
        {
          sql: expect.stringContaining('UNIQUE ("email")'),
        },
      ],
    });
    expect(uniqueOp!.execute[0]!.sql).toContain('ALTER TABLE');
    expect(uniqueOp!.execute[0]!.sql).toContain('"user_email_key"');
  });

  it('renders parameterized column types in DDL', () => {
    const planner = createPostgresMigrationPlanner();
    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: coreHash('sha256:contract'),
      profileHash: 'sha256:profile' as never,
      storage: {
        tables: {
          params: {
            columns: {
              name: {
                nativeType: 'character varying',
                codecId: 'pg/varchar@1',
                nullable: false,
                typeParams: { length: 255 },
              },
              code: {
                nativeType: 'character',
                codecId: 'pg/char@1',
                nullable: false,
                typeParams: { length: 16 },
              },
              price: {
                nativeType: 'numeric',
                codecId: 'pg/numeric@1',
                nullable: false,
                typeParams: { precision: 10, scale: 2 },
              },
              flags: {
                nativeType: 'bit',
                codecId: 'pg/bit@1',
                nullable: false,
                typeParams: { length: 8 },
              },
              created_at: {
                nativeType: 'timestamptz',
                codecId: 'pg/timestamptz@1',
                nullable: false,
                typeParams: { precision: 3 },
              },
              start_time: {
                nativeType: 'time',
                codecId: 'pg/time@1',
                nullable: false,
                typeParams: { precision: 2 },
              },
              duration: {
                nativeType: 'interval',
                codecId: 'pg/interval@1',
                nullable: false,
                typeParams: { precision: 6 },
              },
            },
            primaryKey: { columns: ['name'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
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
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    const createTable = result.plan.operations.find((op) => op.id === 'table.params');
    expect(createTable).toBeDefined();
    const sql = createTable?.execute[0]?.sql ?? '';
    expect(sql).toContain('"name" character varying(255)');
    expect(sql).toContain('"code" character(16)');
    expect(sql).toContain('"price" numeric(10,2)');
    expect(sql).toContain('"flags" bit(8)');
    expect(sql).toContain('"created_at" timestamptz(3)');
    expect(sql).toContain('"start_time" time(2)');
    expect(sql).toContain('"duration" interval(6)');
  });

  it('skips dependency install when dependency already satisfied', () => {
    const planner = createPostgresMigrationPlanner();
    const frameworkComponents = [createFrameworkComponent()];
    const schemaWithExtension: SqlSchemaIR = {
      tables: {},
      extensions: ['vector'],
    };

    const result = planner.plan({
      contract,
      schema: schemaWithExtension,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    expect(result.plan.operations.map((op) => op.id)).not.toContain('extension.pgvector');
  });

  it('builds additive plan for empty schema without database dependencies', () => {
    const planner = createPostgresMigrationPlanner();
    // Use extension descriptor but without databaseDependencies
    const extensionWithoutDeps: SqlControlExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'pgvector',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.0-test',
      operationSignatures: () => [],
      // No databaseDependencies - planner should work without them
      databaseDependencies: {},
      create: () => ({ familyId: 'sql', targetId: 'postgres' }) as never,
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [extensionWithoutDeps],
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
      'index.post.post_userId_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
  });

  it('still plans additive fixes when schema contains extra tables', () => {
    const planner = createPostgresMigrationPlanner();
    const frameworkComponents = [createFrameworkComponent()];
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
      frameworkComponents,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    expect(result.plan.operations.map((op) => op.id)).toEqual([
      'extension.pgvector',
      'table.post',
      'table.user',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
      'index.post.post_userId_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
  });

  it('ignores extra tables when they are unrelated to the contract', () => {
    const planner = createPostgresMigrationPlanner();
    const frameworkComponents = [createFrameworkComponent()];
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
      frameworkComponents,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    expect(result.plan.operations.map((op) => op.id)).toEqual([
      'extension.pgvector',
      'table.post',
      'table.user',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
      'index.post.post_userId_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
  });
});

describe('PostgresMigrationPlanner - composite unique constraint DDL', () => {
  it('generates correct ALTER TABLE SQL for composite unique constraint', () => {
    const planner = createPostgresMigrationPlanner();
    const compositeContract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: coreHash('sha256:composite-unique'),
      profileHash: profileHash('sha256:composite-unique-profile'),
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              first_name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              last_name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['first_name', 'last_name'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: { codecTypes: {}, operationTypes: {} },
      capabilities: {},
      extensionPacks: {},
      meta: {},
      sources: {},
    } as SqlContract<SqlStorage>;

    const result = planner.plan({
      contract: compositeContract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error(`Expected success: ${JSON.stringify(result)}`);

    const uniqueOp = result.plan.operations.find((op) => op.id.startsWith('unique.user.'));
    expect(uniqueOp).toMatchObject({
      operationClass: 'additive',
      target: {
        details: {
          objectType: 'unique',
          name: 'user_first_name_last_name_key',
          table: 'user',
          schema: 'public',
        },
      },
      execute: [
        {
          sql: expect.stringContaining('UNIQUE ("first_name", "last_name")'),
        },
      ],
    });
    expect(uniqueOp!.execute[0]!.sql).toContain('ALTER TABLE');
    expect(uniqueOp!.execute[0]!.sql).toContain('"user_first_name_last_name_key"');
  });
});

describe('PostgresMigrationPlanner - column defaults', () => {
  type ColumnDef = PostgresStorageColumn & { nativeType: string; codecId: string };

  function contractWithTable(
    tableName: string,
    columns: Record<string, ColumnDef>,
  ): SqlContract<SqlStorage> {
    return {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: coreHash('sha256:test-defaults'),
      profileHash: profileHash('sha256:test-defaults-profile'),
      storage: {
        tables: {
          [tableName]: {
            columns,
            primaryKey: { columns: [Object.keys(columns)[0]!] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: { codecTypes: {}, operationTypes: {} },
      capabilities: {},
      extensionPacks: {},
      meta: {},
      sources: {},
    } as SqlContract<SqlStorage>;
  }

  function planTableSql(tableName: string, columns: Record<string, ColumnDef>): string {
    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithTable(tableName, columns),
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error(`Expected success: ${JSON.stringify(result)}`);
    const tableOp = result.plan.operations.find((op) => op.id === `table.${tableName}`);
    expect(tableOp).toBeDefined();
    return tableOp!.execute[0]!.sql;
  }

  it.each([
    ['int2', 'SMALLSERIAL'],
    ['int4', 'SERIAL'],
    ['int8', 'BIGSERIAL'],
  ] as const)('generates %s for autoincrement on %s columns', (nativeType, serialType) => {
    const sql = planTableSql('counter', {
      id: {
        nativeType,
        codecId: `pg/${nativeType}@1`,
        nullable: false,
        default: { kind: 'function', expression: 'autoincrement()' },
      },
    });
    expect(sql).toContain(`"id" ${serialType} NOT NULL`);
    expect(sql).not.toContain('DEFAULT');
  });

  it('generates DEFAULT now() for timestamp columns', () => {
    const sql = planTableSql('user', {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      createdAt: {
        nativeType: 'timestamptz',
        codecId: 'pg/timestamptz@1',
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      },
    });
    expect(sql).toContain('"createdAt" timestamptz DEFAULT (now()) NOT NULL');
  });

  it('generates DEFAULT gen_random_uuid() for uuid columns', () => {
    const sql = planTableSql('user', {
      id: {
        nativeType: 'uuid',
        codecId: 'pg/uuid@1',
        nullable: false,
        default: { kind: 'function', expression: 'gen_random_uuid()' },
      },
    });
    expect(sql).toContain('"id" uuid DEFAULT (gen_random_uuid()) NOT NULL');
  });

  it('generates DEFAULT with literal values', () => {
    const sql = planTableSql('config', {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      enabled: {
        nativeType: 'bool',
        codecId: 'pg/bool@1',
        nullable: false,
        default: { kind: 'literal', value: true },
      },
      disabled: {
        nativeType: 'bool',
        codecId: 'pg/bool@1',
        nullable: false,
        default: { kind: 'literal', value: false },
      },
      name: {
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        default: { kind: 'literal', value: 'default' },
      },
      priority: {
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
        default: { kind: 'literal', value: 0 },
      },
    });
    expect(sql).toContain('"enabled" bool DEFAULT true NOT NULL');
    expect(sql).toContain('"disabled" bool DEFAULT false NOT NULL');
    expect(sql).toContain('"name" text DEFAULT \'default\' NOT NULL');
    expect(sql).toContain('"priority" int4 DEFAULT 0 NOT NULL');
  });

  it('generates DEFAULT with sequence reference', () => {
    const sql = planTableSql('counter', {
      id: {
        nativeType: 'int8',
        codecId: 'pg/int8@1',
        nullable: false,
        default: { kind: 'sequence', name: 'counter_id_seq' },
      },
    });
    // Sequence names use quoteIdentifier for proper identifier escaping
    expect(sql).toContain('"id" int8 DEFAULT nextval("counter_id_seq"::regclass) NOT NULL');
  });

  it('generates DEFAULT with function params when provided', () => {
    const sql = planTableSql('event', {
      id: {
        nativeType: 'uuid',
        codecId: 'pg/uuid@1',
        nullable: false,
        default: { kind: 'function', expression: "gen_random_uuid(INTERVAL '5500 years')" },
      },
    });
    expect(sql).toContain('"id" uuid DEFAULT (gen_random_uuid(INTERVAL \'5500 years\')) NOT NULL');
  });

  it('renders JSONB default with $type key as JSON, not as tagged bigint', () => {
    const sql = planTableSql('metadata', {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      payload: {
        nativeType: 'jsonb',
        codecId: 'pg/jsonb@1',
        nullable: false,
        default: { kind: 'literal', value: { $type: 'bigint', value: '42' } },
      },
    });
    expect(sql).toContain(
      '"payload" jsonb DEFAULT \'{"$type":"bigint","value":"42"}\'::jsonb NOT NULL',
    );
  });

  it('preserves json and jsonb native types in CREATE TABLE', () => {
    const sql = planTableSql('event_payloads', {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      payload: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
      raw: { nativeType: 'json', codecId: 'pg/json@1', nullable: true },
    });

    expect(sql).toContain('"payload" jsonb NOT NULL');
    expect(sql).toContain('"raw" json');
  });
});

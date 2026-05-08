import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import pgvectorDescriptor from '@prisma-next/extension-pgvector/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import type { PostgresColumnDefault } from '@prisma-next/target-postgres/types';
import { describe, expect, it } from 'vitest';
import postgresAdapterDescriptor from '../../src/exports/control';

type PostgresStorageColumn = Omit<StorageColumn, 'default'> & {
  readonly default?: PostgresColumnDefault;
};

function createTestContract(overrides?: Partial<Contract<SqlStorage>>): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: {
      storageHash: coreHash('sha256:contract'),
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
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {
      pgvector: {},
    },
    meta: {},
    ...overrides,
  };
}

const contract = createTestContract();

const emptySchema: SqlSchemaIR = {
  tables: {},
};

describe('PostgresMigrationPlanner - when database is empty', () => {
  it('builds additive plan for empty schema (tables, indexes, FKs)', () => {
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [pgvectorDescriptor],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    const operations = result.plan.operations;
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.map((op) => op.id)).toEqual([
      'table.post',
      'table.user',
      'unique.user.user_email_key',
      'index.post.post_userId_idx',
      'index.user.user_email_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
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
    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: {
        storageHash: coreHash('sha256:contract'),
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
      roots: {},
      models: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [postgresAdapterDescriptor],
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

  it('renders pgvector vector(N) column types in DDL', () => {
    const planner = createPostgresMigrationPlanner();
    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: {
        storageHash: coreHash('sha256:contract'),
        tables: {
          documents: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              embedding: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: true,
                typeParams: { length: 1536 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      roots: {},
      models: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [pgvectorDescriptor],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    const createTable = result.plan.operations.find((op) => op.id === 'table.documents');
    expect(createTable).toBeDefined();
    const sql = createTable?.execute[0]?.sql ?? '';
    expect(sql).toContain('"embedding" vector(1536)');
    expect(sql).not.toContain('"embedding" "vector(1536)"');
  });

  it('still plans additive fixes when schema contains extra tables', () => {
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
    };

    const result = planner.plan({
      contract,
      schema: nonEmptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [pgvectorDescriptor],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    expect(result.plan.operations.map((op) => op.id)).toEqual([
      'table.post',
      'table.user',
      'unique.user.user_email_key',
      'index.post.post_userId_idx',
      'index.user.user_email_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
  });

  it('ignores extra tables when they are unrelated to the contract', () => {
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
    };

    const result = planner.plan({
      contract,
      schema: nonEmptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [pgvectorDescriptor],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }
    expect(result.plan.operations.map((op) => op.id)).toEqual([
      'table.post',
      'table.user',
      'unique.user.user_email_key',
      'index.post.post_userId_idx',
      'index.user.user_email_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
  });
});

describe('PostgresMigrationPlanner - composite unique constraint DDL', () => {
  it('generates correct ALTER TABLE SQL for composite unique constraint', () => {
    const planner = createPostgresMigrationPlanner();
    const compositeContract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: {
        storageHash: coreHash('sha256:composite-unique'),
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
      roots: {},
      models: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
    } as Contract<SqlStorage>;

    const result = planner.plan({
      contract: compositeContract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
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
  ): Contract<SqlStorage> {
    return {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: {
        storageHash: coreHash('sha256:test-defaults'),
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
      roots: {},
      models: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
    } as Contract<SqlStorage>;
  }

  function planTableSql(tableName: string, columns: Record<string, ColumnDef>): string {
    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithTable(tableName, columns),
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
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
    expect(sql).toContain(`"id" int8 DEFAULT nextval('"counter_id_seq"'::regclass) NOT NULL`);
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

  it('renders JSONB default with $type key as regular JSON', () => {
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

import type {
  ComponentDatabaseDependency,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

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

function createFrameworkComponent(): SqlControlExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id: 'pgvector',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    databaseDependencies: { init: [pgvectorDependency] },
    create: () => ({ familyId: 'sql', targetId: 'postgres' }) as never,
  };
}

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
      'foreignKey.post.post_userId_fkey',
    ]);
  });
});

describe('PostgresMigrationPlanner - column defaults', () => {
  it('generates SERIAL for autoincrement on int4 columns', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
                default: { kind: 'function', name: 'autoincrement' },
              },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.user');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    // SERIAL includes implicit NOT NULL
    expect(sql).toContain('"id" SERIAL NOT NULL');
    expect(sql).not.toContain('DEFAULT');
  });

  it('generates DEFAULT now() for timestamp columns', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              createdAt: {
                nativeType: 'timestamptz',
                codecId: 'pg/timestamptz@1',
                nullable: false,
                default: { kind: 'function', name: 'now' },
              },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.user');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    expect(sql).toContain('"createdAt" timestamptz DEFAULT now() NOT NULL');
  });

  it('generates DEFAULT gen_random_uuid() for uuid columns', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'uuid',
                codecId: 'pg/uuid@1',
                nullable: false,
                default: { kind: 'function', name: 'uuid' },
              },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.user');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    expect(sql).toContain('"id" uuid DEFAULT gen_random_uuid() NOT NULL');
  });

  it('generates DEFAULT with literal values', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          config: {
            columns: {
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
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.config');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    expect(sql).toContain('"enabled" bool DEFAULT TRUE NOT NULL');
    expect(sql).toContain('"disabled" bool DEFAULT FALSE NOT NULL');
    expect(sql).toContain('"name" text DEFAULT \'default\' NOT NULL');
    expect(sql).toContain('"priority" int4 DEFAULT 0 NOT NULL');
  });

  it('generates DEFAULT with dbGenerated expression', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          audit: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              auditTime: {
                nativeType: 'timestamptz',
                codecId: 'pg/timestamptz@1',
                nullable: false,
                default: { kind: 'dbGenerated', expression: 'CURRENT_TIMESTAMP' },
              },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.audit');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    expect(sql).toContain('"auditTime" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL');
  });

  it('generates DEFAULT with sequence reference', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          counter: {
            columns: {
              id: {
                nativeType: 'int8',
                codecId: 'pg/int8@1',
                nullable: false,
                default: { kind: 'sequence', name: 'counter_id_seq' },
              },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.counter');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    expect(sql).toContain('"id" int8 DEFAULT nextval(\'counter_id_seq\') NOT NULL');
  });

  it('generates BIGSERIAL for autoincrement on int8 columns', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          bigcounter: {
            columns: {
              id: {
                nativeType: 'int8',
                codecId: 'pg/int8@1',
                nullable: false,
                default: { kind: 'function', name: 'autoincrement' },
              },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.bigcounter');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    expect(sql).toContain('"id" BIGSERIAL NOT NULL');
    expect(sql).not.toContain('DEFAULT');
  });

  it('generates SMALLSERIAL for autoincrement on int2 columns', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          smallcounter: {
            columns: {
              id: {
                nativeType: 'int2',
                codecId: 'pg/int2@1',
                nullable: false,
                default: { kind: 'function', name: 'autoincrement' },
              },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.smallcounter');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    expect(sql).toContain('"id" SMALLSERIAL NOT NULL');
    expect(sql).not.toContain('DEFAULT');
  });

  it('generates no DEFAULT clause for userland defaults (client-side)', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          item: {
            columns: {
              id: {
                nativeType: 'text',
                codecId: 'pg/text@1',
                nullable: false,
                default: { kind: 'userland', name: 'nanoid' },
              },
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.item');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    // Userland defaults are computed client-side, no DEFAULT clause
    expect(sql).toContain('"id" text NOT NULL');
    expect(sql).not.toContain('DEFAULT');
  });

  it('generates DEFAULT with function params when provided', () => {
    const contractWithDefaults: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-defaults' as never,
      profileHash: 'sha256:test-defaults-profile' as never,
      storage: {
        tables: {
          event: {
            columns: {
              id: {
                nativeType: 'uuid',
                codecId: 'pg/uuid@1',
                nullable: false,
                default: {
                  kind: 'function',
                  name: 'uuid',
                  params: ["INTERVAL '5500 years'"],
                },
              },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const planner = createPostgresMigrationPlanner();
    const result = planner.plan({
      contract: contractWithDefaults,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const tableOp = result.plan.operations.find((op) => op.id === 'table.event');
    expect(tableOp).toBeDefined();
    const sql = tableOp!.execute[0]!.sql;
    // uuid with params generates gen_random_uuid with the params
    expect(sql).toContain('"id" uuid DEFAULT gen_random_uuid(INTERVAL \'5500 years\') NOT NULL');
  });
});

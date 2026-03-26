import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import pgvectorDescriptor from '@prisma-next/extension-pgvector/control';
import { type CodecControlHooks, INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  buildBuiltinIdentityValue,
  createPostgresMigrationPlanner,
} from '../../src/core/migrations/planner';

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
      dependencies: [],
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
      dependencies: [],
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
      'index.post.post_userId_idx',
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
      dependencies: [],
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

describe('NOT NULL column without default uses temporary default', () => {
  const qualifiedUserTable = '"public"."user"';

  it('emits 2-step execute (add with temp default, drop default) for NOT NULL text column', () => {
    const addCol = planAddColumn('name', {
      nativeType: 'text',
      codecId: 'pg/text@1',
      nullable: false,
    });

    // No empty-table precheck
    expect(addCol.precheck.map((p) => p.sql)).not.toContain(
      `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedUserTable} LIMIT 1)`,
    );

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "name" text DEFAULT '' NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "name" DROP DEFAULT`,
    ]);

    // Postcheck includes verification that temporary default was removed
    expect(addCol.postcheck.map((p) => p.description)).toContainEqual(
      expect.stringContaining('no default'),
    );
  });

  it('emits 2-step execute for NOT NULL int4 column', () => {
    const addCol = planAddColumn('age', {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "age" int4 DEFAULT 0 NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "age" DROP DEFAULT`,
    ]);
  });

  it('uses length-aware temporary defaults for fixed-length bit columns', () => {
    const addCol = planAddColumn(
      'flags',
      {
        nativeType: 'bit',
        codecId: 'pg/bit@1',
        nullable: false,
        typeParams: { length: 4 },
      },
      {
        frameworkComponents: [
          createPlannerControlHookComponent('pg/bit@1', {
            expandNativeType: ({ nativeType, typeParams }) =>
              `${nativeType}(${String(typeParams?.['length'])})`,
          }),
        ],
      },
    );

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "flags" bit(4) DEFAULT B'0000' NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "flags" DROP DEFAULT`,
    ]);
  });

  it('uses empty-array temporary defaults for NOT NULL array columns', () => {
    const addCol = planAddColumn('tags', {
      nativeType: 'text[]',
      codecId: 'pg/text-array@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "tags" DROP DEFAULT`,
    ]);
  });

  it('uses built-in temporary defaults for NOT NULL tsvector columns', () => {
    const addCol = planAddColumn('searchDocument', {
      nativeType: 'tsvector',
      codecId: 'pg/tsvector@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "searchDocument" tsvector DEFAULT ''::tsvector NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "searchDocument" DROP DEFAULT`,
    ]);
  });

  it('uses explicit UTC-offset temporary defaults for NOT NULL timetz columns', () => {
    const addCol = planAddColumn('opensAt', {
      nativeType: 'timetz',
      codecId: 'pg/timetz@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "opensAt" timetz DEFAULT '00:00:00+00' NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "opensAt" DROP DEFAULT`,
    ]);
  });

  it('uses codec hook temporary defaults for parameterized pgvector columns', () => {
    const addCol = planAddColumn(
      'embedding',
      {
        nativeType: 'vector',
        codecId: 'pg/vector@1',
        nullable: false,
        typeParams: { length: 3 },
      },
      { frameworkComponents: [pgvectorDescriptor] },
    );

    expect(addCol.precheck.map((p) => p.sql)).not.toContain(
      `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedUserTable} LIMIT 1)`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "embedding" vector(3) DEFAULT '[0,0,0]'::vector NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "embedding" DROP DEFAULT`,
    ]);
  });

  it('uses the empty-table fallback when a codec hook declines a temporary default', () => {
    const addCol = planAddColumn(
      'name',
      {
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      },
      {
        frameworkComponents: [
          createPlannerControlHookComponent('pg/text@1', {
            resolveIdentityValue: () => null,
          }),
        ],
      },
    );

    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedUserTable} LIMIT 1)`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "name" text NOT NULL`,
    ]);
  });

  it('uses the empty-table fallback when the new column becomes a primary key later in the same plan', () => {
    const operations = planUserTableOperations(
      {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          slug: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['slug'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      {
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
        uniques: [],
        foreignKeys: [],
        indexes: [],
      },
    );

    const addCol = getRequiredOperation(operations, 'column.user.slug');
    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedUserTable} LIMIT 1)`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "slug" text NOT NULL`,
    ]);
    expect(operations.map((op) => op.id)).toContain('primaryKey.user.user_pkey');
  });

  it('uses the empty-table fallback when the new column becomes unique later in the same plan', () => {
    const operations = planUserTableOperations(
      {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          slug: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['slug'] }],
        indexes: [],
        foreignKeys: [],
      },
      buildUserTableSchemaWithoutEmail(),
    );

    const addCol = getRequiredOperation(operations, 'column.user.slug');
    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedUserTable} LIMIT 1)`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "slug" text NOT NULL`,
    ]);
    expect(operations.map((op) => op.id)).toContain('unique.user.user_slug_key');
  });

  it('uses the empty-table fallback when the new column becomes a foreign key later in the same plan', () => {
    const operations = planUserTableOperations(
      {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          orgId: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [
          {
            columns: ['orgId'],
            references: { table: 'org', columns: ['id'] },
            constraint: true,
            index: true,
          },
        ],
      },
      buildUserTableSchemaWithoutEmail(),
      {
        extraContractTables: {
          org: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        extraSchemaTables: {
          org: {
            name: 'org',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      },
    );

    const addCol = getRequiredOperation(operations, 'column.user.orgId');
    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedUserTable} LIMIT 1)`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "orgId" uuid NOT NULL`,
    ]);
    expect(operations.map((op) => op.id)).toContain('foreignKey.user.user_orgId_fkey');
  });

  it('skips temporary default for nullable columns', () => {
    const addCol = planAddColumn('bio', {
      nativeType: 'text',
      codecId: 'pg/text@1',
      nullable: true,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "bio" text`,
    ]);
  });

  it('skips temporary default for NOT NULL columns with explicit default', () => {
    const addCol = planAddColumn('active', {
      nativeType: 'bool',
      codecId: 'pg/bool@1',
      nullable: false,
      default: { kind: 'literal', value: true },
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "active" bool DEFAULT true NOT NULL`,
    ]);
  });
});

describe('buildBuiltinIdentityValue (built-in fallback)', () => {
  it.each([
    ['text', undefined, "''"],
    ['character', undefined, "''"],
    ['bpchar', undefined, "''"],
    ['character varying', undefined, "''"],
    ['varchar', undefined, "''"],
    ['int2', undefined, '0'],
    ['int4', undefined, '0'],
    ['int8', undefined, '0'],
    ['integer', undefined, '0'],
    ['bigint', undefined, '0'],
    ['smallint', undefined, '0'],
    ['float4', undefined, '0'],
    ['float8', undefined, '0'],
    ['real', undefined, '0'],
    ['double precision', undefined, '0'],
    ['numeric', undefined, '0'],
    ['decimal', undefined, '0'],
    ['bool', undefined, 'false'],
    ['boolean', undefined, 'false'],
    ['uuid', undefined, "'00000000-0000-0000-0000-000000000000'"],
    ['json', undefined, "'{}'::jsonb"],
    ['jsonb', undefined, "'{}'::jsonb"],
    ['date', undefined, "'epoch'"],
    ['timestamp', undefined, "'epoch'"],
    ['timestamptz', undefined, "'epoch'"],
    ['time', undefined, "'00:00:00'"],
    ['time without time zone', undefined, "'00:00:00'"],
    ['timetz', undefined, "'00:00:00+00'"],
    ['time with time zone', undefined, "'00:00:00+00'"],
    ['interval', undefined, "'0'"],
    ['bytea', undefined, "''::bytea"],
    ['tsvector', undefined, "''::tsvector"],
    ['bit', undefined, "B'0'"],
    ['bit', { length: 4 }, "B'0000'"],
    ['bit varying', undefined, "B''"],
    ['varbit', undefined, "B''"],
    ['int4[]', undefined, "'{}'"],
    ['text[]', undefined, "'{}'"],
  ] as const)('returns %s with %j → %s', (nativeType, typeParams, expected) => {
    expect(buildBuiltinIdentityValue(nativeType, typeParams)).toBe(expected);
  });

  it('returns null for unknown types (enum, array, extension)', () => {
    expect(buildBuiltinIdentityValue('my_enum')).toBeNull();
    expect(buildBuiltinIdentityValue('tsquery')).toBeNull();
    expect(buildBuiltinIdentityValue('vector')).toBeNull();
    expect(buildBuiltinIdentityValue('bit', { length: 0 })).toBeNull();
  });
});

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
    mappings: {},
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

/**
 * Plans adding a single column to the user table and returns the resulting operation.
 * The schema contains only the `id` column, so the planner generates an ADD COLUMN for `columnName`.
 */
function planAddColumn(
  columnName: string,
  columnDef: {
    nativeType: string;
    codecId: string;
    nullable: boolean;
    typeParams?: Record<string, unknown>;
    default?: { kind: 'literal'; value: ColumnDefaultLiteralInputValue };
  },
  options?: {
    frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>;
  },
) {
  const operations = planUserTableOperations(
    {
      columns: {
        id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        [columnName]: columnDef,
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
    buildUserTableSchemaWithoutEmail(),
    options,
  );
  return getRequiredOperation(operations, `column.user.${columnName}`);
}

function createPlannerControlHookComponent(
  codecId: string,
  hooks: CodecControlHooks,
): TargetBoundComponentDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id: `test-hooks-${codecId}`,
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    operationSignatures: () => [],
    create: () => ({ familyId: 'sql', targetId: 'postgres' }) as never,
    types: {
      codecTypes: {
        controlPlaneHooks: {
          [codecId]: hooks,
        },
      },
    },
  } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
}

function planUserTableOperations(
  userTable: StorageTable,
  schemaUserTable: SqlSchemaIR['tables'][string],
  options?: {
    frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>;
    extraContractTables?: SqlContract<SqlStorage>['storage']['tables'];
    extraSchemaTables?: SqlSchemaIR['tables'];
  },
) {
  const planner = createPostgresMigrationPlanner();
  const contract = createTestContract({
    storage: {
      tables: {
        ...(options?.extraContractTables ?? {}),
        user: userTable,
      },
    },
  });
  const schema: SqlSchemaIR = {
    tables: {
      ...(options?.extraSchemaTables ?? {}),
      user: schemaUserTable,
    },
    dependencies: [],
  };
  const result = planner.plan({
    contract,
    schema,
    policy: INIT_ADDITIVE_POLICY,
    frameworkComponents: options?.frameworkComponents ?? [],
  });
  if (result.kind !== 'success') throw new Error('expected planner success');
  return result.plan.operations;
}

function getRequiredOperation(operations: ReturnType<typeof planUserTableOperations>, id: string) {
  const operation = operations.find((candidate) => candidate.id === id);
  if (!operation) {
    throw new Error(`operation ${id} not found`);
  }
  return operation;
}

function buildUserTableSchemaWithoutEmail(): SqlSchemaIR['tables'][string] {
  return {
    name: 'user',
    columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
    primaryKey: { columns: ['id'] },
    uniques: [],
    foreignKeys: [],
    indexes: [],
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
    indexes: [{ columns: ['userId'], name: 'post_userId_idx', unique: false }],
  };
}

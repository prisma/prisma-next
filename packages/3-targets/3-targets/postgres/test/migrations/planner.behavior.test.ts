import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  buildTypeZeroDefaultLiteral,
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
  const planner = createPostgresMigrationPlanner();

  it('emits 2-step execute (add with temp default, drop default) for NOT NULL text column', () => {
    const contract = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
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
    if (result.kind !== 'success') throw new Error('expected success');

    const addCol = result.plan.operations.find((op) => op.id === 'column.user.name');
    expect(addCol).toBeDefined();

    // No empty-table precheck
    expect(addCol!.precheck.map((p) => p.description)).not.toContainEqual(
      expect.stringContaining('empty'),
    );

    // 2-step execute: add with temporary default, then drop default
    expect(addCol!.execute).toHaveLength(2);
    expect(addCol!.execute[0]!.sql).toContain("DEFAULT ''");
    expect(addCol!.execute[0]!.sql).toContain('NOT NULL');
    expect(addCol!.execute[1]!.sql).toContain('DROP DEFAULT');

    // Postcheck includes verification that temporary default was removed
    expect(addCol!.postcheck.map((p) => p.description)).toContainEqual(
      expect.stringContaining('no default'),
    );
  });

  it('emits 2-step execute for NOT NULL int4 column', () => {
    const contract = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              age: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
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
    if (result.kind !== 'success') throw new Error('expected success');

    const addCol = result.plan.operations.find((op) => op.id === 'column.user.age');
    expect(addCol).toBeDefined();
    expect(addCol!.execute).toHaveLength(2);
    expect(addCol!.execute[0]!.sql).toContain('DEFAULT 0');
    expect(addCol!.execute[0]!.sql).toContain('NOT NULL');
    expect(addCol!.execute[1]!.sql).toContain('DROP DEFAULT');
  });

  it('skips temporary default for nullable columns', () => {
    const contract = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              bio: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
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
    if (result.kind !== 'success') throw new Error('expected success');

    const addCol = result.plan.operations.find((op) => op.id === 'column.user.bio');
    expect(addCol).toBeDefined();
    expect(addCol!.execute).toHaveLength(1);
    expect(addCol!.execute[0]!.sql).not.toContain('DEFAULT');
    expect(addCol!.execute[0]!.sql).not.toContain('NOT NULL');
  });

  it('skips temporary default for NOT NULL columns with explicit default', () => {
    const contract = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              active: {
                nativeType: 'bool',
                codecId: 'pg/bool@1',
                nullable: false,
                default: { kind: 'literal', value: true },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
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
    if (result.kind !== 'success') throw new Error('expected success');

    const addCol = result.plan.operations.find((op) => op.id === 'column.user.active');
    expect(addCol).toBeDefined();
    // Single execute step (explicit default, no temporary default needed)
    expect(addCol!.execute).toHaveLength(1);
    expect(addCol!.execute[0]!.sql).toContain('DEFAULT true');
    expect(addCol!.execute[0]!.sql).toContain('NOT NULL');
  });
});

describe('buildTypeZeroDefaultLiteral', () => {
  it.each([
    ['text', "''"],
    ['character', "''"],
    ['character varying', "''"],
    ['int2', '0'],
    ['int4', '0'],
    ['int8', '0'],
    ['integer', '0'],
    ['bigint', '0'],
    ['smallint', '0'],
    ['float4', '0'],
    ['float8', '0'],
    ['real', '0'],
    ['double precision', '0'],
    ['numeric', '0'],
    ['decimal', '0'],
    ['bool', 'false'],
    ['boolean', 'false'],
    ['uuid', "'00000000-0000-0000-0000-000000000000'"],
    ['json', "'{}'::jsonb"],
    ['jsonb', "'{}'::jsonb"],
    ['date', "'epoch'"],
    ['timestamp', "'epoch'"],
    ['timestamptz', "'epoch'"],
    ['time', "'00:00:00'"],
    ['timetz', "'00:00:00'"],
    ['interval', "'0'"],
    ['bit', "B'0'"],
    ['bit varying', "B''"],
  ] as const)('returns %s → %s', (nativeType, expected) => {
    expect(buildTypeZeroDefaultLiteral(nativeType)).toBe(expected);
  });

  it('returns null for unknown types (enum, array, extension)', () => {
    expect(buildTypeZeroDefaultLiteral('my_enum')).toBeNull();
    expect(buildTypeZeroDefaultLiteral('int4[]')).toBeNull();
    expect(buildTypeZeroDefaultLiteral('tsvector')).toBeNull();
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

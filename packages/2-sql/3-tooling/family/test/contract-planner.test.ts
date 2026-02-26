import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { planContractDiff } from '../src/core/migrations/contract-planner';
import { createTestEmitter } from './test-emitter';

// ============================================================================
// Helpers
// ============================================================================

function storage(tables: SqlStorage['tables'], types?: SqlStorage['types']): SqlStorage {
  return { tables, ...(types ? { types } : {}) };
}

const EMPTY: SqlStorage = storage({});
const emitter = createTestEmitter();

function plan(from: SqlStorage | null, to: SqlStorage) {
  return planContractDiff({ from, to, emitter });
}

function successOps(from: SqlStorage | null, to: SqlStorage): readonly MigrationPlanOperation[] {
  const result = plan(from, to);
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('expected success');
  return result.ops;
}

// ============================================================================
// Tests
// ============================================================================

describe('planContractDiff', () => {
  it('empty → single table with columns, PK, and unique', () => {
    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
          name: { nativeType: 'text', codecId: 'core/text@1', nullable: true },
        },
        primaryKey: { columns: ['id'], name: 'users_pkey' },
        uniques: [{ columns: ['email'], name: 'users_email_key' }],
        indexes: [],
        foreignKeys: [],
      },
    });

    const ops = successOps(null, to);

    const createTable = ops.find((o) => o.id === 'table.users');
    expect(createTable).toBeDefined();
    expect(createTable!.label).toBe('Create table users');

    const addUnique = ops.find((o) => o.id === 'unique.users.users_email_key');
    expect(addUnique).toBeDefined();

    const addColumns = ops.filter((o) => o.id.startsWith('column.'));
    expect(addColumns).toHaveLength(0);

    const addPKs = ops.filter((o) => o.id.startsWith('primaryKey.'));
    expect(addPKs).toHaveLength(0);
  });

  it('empty → multiple tables with FK relationships, correct order', () => {
    const to = storage({
      posts: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          author_id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          title: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [{ columns: ['author_id'], references: { table: 'users', columns: ['id'] } }],
      },
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const ops = successOps(null, to);

    const createTables = ops.filter((o) => o.id.startsWith('table.'));
    expect(createTables).toHaveLength(2);
    expect(createTables[0]!.id).toBe('table.posts');
    expect(createTables[1]!.id).toBe('table.users');

    const fkOps = ops.filter((o) => o.id.startsWith('foreignKey.'));
    expect(fkOps).toHaveLength(1);
    expect(fkOps[0]!.id).toBe('foreignKey.posts.posts_author_id_fkey');

    const createTableIdx = ops.indexOf(createTables[1]!);
    const fkIdx = ops.indexOf(fkOps[0]!);
    expect(fkIdx).toBeGreaterThan(createTableIdx);
  });

  it('empty → table with indexes', () => {
    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [{ columns: ['email'], name: 'users_email_idx' }],
        foreignKeys: [],
      },
    });

    const ops = successOps(null, to);

    const indexOps = ops.filter((o) => o.id.startsWith('index.'));
    expect(indexOps).toHaveLength(1);
    expect(indexOps[0]!.id).toBe('index.users.users_email_idx');
  });

  it('empty → table with column defaults', () => {
    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          status: {
            nativeType: 'text',
            codecId: 'core/text@1',
            nullable: false,
            default: { kind: 'literal', expression: "'active'" },
          },
          created_at: {
            nativeType: 'timestamptz',
            codecId: 'core/timestamp@1',
            nullable: false,
            default: { kind: 'function', expression: 'now()' },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const ops = successOps(null, to);
    const createTable = ops.find((o) => o.id === 'table.users');
    expect(createTable).toBeDefined();
  });

  it('single table → add new table (incremental)', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: from.tables['users']!,
      posts: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          title: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const ops = successOps(from, to);

    const createTables = ops.filter((o) => o.id.startsWith('table.'));
    expect(createTables).toHaveLength(1);
    expect(createTables[0]!.id).toBe('table.posts');

    const userOps = ops.filter((o) => o.id.includes('.users'));
    expect(userOps).toHaveLength(0);
  });

  it('existing table → add new columns', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: {
            nativeType: 'text',
            codecId: 'core/text@1',
            nullable: false,
            default: { kind: 'literal', expression: "''" },
          },
          name: { nativeType: 'text', codecId: 'core/text@1', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const ops = successOps(from, to);

    const addColumns = ops.filter((o) => o.id.startsWith('column.'));
    expect(addColumns).toHaveLength(2);
    expect(addColumns[0]!.id).toBe('column.users.email');
    expect(addColumns[1]!.id).toBe('column.users.name');

    expect(ops.filter((o) => o.id.startsWith('table.'))).toHaveLength(0);
  });

  it('existing table → add new constraints', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      posts: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          user_id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: {
        ...from.tables['users']!,
        uniques: [{ columns: ['email'], name: 'users_email_key' }],
        indexes: [{ columns: ['email'], name: 'users_email_idx' }],
      },
      posts: {
        ...from.tables['posts']!,
        foreignKeys: [
          {
            columns: ['user_id'],
            references: { table: 'users', columns: ['id'] },
            name: 'posts_user_id_fkey',
          },
        ],
      },
    });

    const ops = successOps(from, to);

    expect(ops.filter((o) => o.id.startsWith('unique.'))).toHaveLength(1);
    expect(ops.filter((o) => o.id.startsWith('index.'))).toHaveLength(1);
    expect(ops.filter((o) => o.id.startsWith('foreignKey.'))).toHaveLength(1);
  });

  it('extension-aware: pgvector type → enableExtension + createStorageType', () => {
    const to = storage(
      {
        items: {
          columns: {
            id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: true,
              typeRef: 'Embedding',
              typeParams: { length: 1536 },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      {
        Embedding: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    );

    const ops = successOps(null, to);

    const extOps = ops.filter((o) => o.id.startsWith('extension.'));
    expect(extOps).toHaveLength(1);
    expect(extOps[0]!.id).toBe('extension.vector');

    const typeOps = ops.filter((o) => o.id.startsWith('storageType.'));
    expect(typeOps).toHaveLength(1);
    expect(typeOps[0]!.id).toBe('storageType.Embedding');

    // Ordering: extensions → types → tables
    const extIdx = ops.indexOf(extOps[0]!);
    const typeIdx = ops.indexOf(typeOps[0]!);
    const tableOp = ops.find((o) => o.id.startsWith('table.'));
    const tableIdx = ops.indexOf(tableOp!);
    expect(extIdx).toBeLessThan(typeIdx);
    expect(typeIdx).toBeLessThan(tableIdx);
  });

  it('determinism: identical inputs produce identical ops', () => {
    const to = storage({
      beta: {
        columns: {
          z_col: { nativeType: 'text', codecId: 'core/text@1', nullable: true },
          a_col: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['a_col'] },
        uniques: [{ columns: ['z_col'] }],
        indexes: [{ columns: ['a_col'] }],
        foreignKeys: [],
      },
      alpha: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result1 = plan(null, to);
    const result2 = plan(null, to);

    expect(result1).toEqual(result2);
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('conflict: column type change → failure', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'varchar', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result = plan(from, to);
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.kind).toBe('typeMismatch');
    expect(result.conflicts[0]!.location?.table).toBe('users');
    expect(result.conflicts[0]!.location?.column).toBe('email');
  });

  it('conflict: column removal → failure', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result = plan(from, to);
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts[0]!.kind).toBe('columnRemoved');
  });

  it('no-op: identical contracts → empty ops list', () => {
    const both = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
        indexes: [],
        foreignKeys: [],
      },
    });

    const ops = successOps(both, both);
    expect(ops).toHaveLength(0);
  });

  it('ops carry correct operation class', () => {
    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [{ columns: ['id'], name: 'users_id_idx' }],
        foreignKeys: [],
      },
    });

    const ops = successOps(null, to);

    for (const op of ops) {
      expect(op.operationClass).toBe('additive');
    }
  });

  it('conflict: nullability tightening → failure', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          name: { nativeType: 'text', codecId: 'core/text@1', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          name: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result = plan(from, to);
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts[0]!.kind).toBe('nullabilityConflict');
  });

  it('conflict: table removal → failure', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result = plan(from, EMPTY);
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts[0]!.kind).toBe('tableRemoved');
  });

  it('nullability widening (not-null → nullable) is NOT a conflict', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          name: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          name: { nativeType: 'text', codecId: 'core/text@1', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result = plan(from, to);
    expect(result.kind).toBe('success');
  });

  it('addPrimaryKey for existing table without PK', () => {
    const from = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const ops = successOps(from, to);

    const pkOps = ops.filter((o) => o.id.startsWith('primaryKey.'));
    expect(pkOps).toHaveLength(1);
    expect(pkOps[0]!.id).toBe('primaryKey.users.users_pkey');
  });

  it('default constraint name generation', () => {
    const to = storage({
      users: {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
        indexes: [{ columns: ['id', 'email'] }],
        foreignKeys: [{ columns: ['id'], references: { table: 'other', columns: ['id'] } }],
      },
    });

    const ops = successOps(null, to);

    expect(ops.find((o) => o.id === 'unique.users.users_email_key')).toBeDefined();
    expect(ops.find((o) => o.id === 'index.users.users_id_email_idx')).toBeDefined();
    expect(ops.find((o) => o.id === 'foreignKey.users.users_id_fkey')).toBeDefined();
  });
});

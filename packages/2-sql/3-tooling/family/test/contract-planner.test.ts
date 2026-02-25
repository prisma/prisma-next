import type { AbstractOp } from '@prisma-next/core-control-plane/abstract-ops';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { planContractDiff } from '../src/core/migrations/contract-planner';

// ============================================================================
// Helpers: build SqlStorage fixtures concisely
// ============================================================================

function storage(tables: SqlStorage['tables'], types?: SqlStorage['types']): SqlStorage {
  return { tables, ...(types ? { types } : {}) };
}

const EMPTY: SqlStorage = storage({});

// ============================================================================
// Tests
// ============================================================================

describe('planContractDiff', () => {
  // --------------------------------------------------------------------------
  // 1. empty → single table with columns, PK, and unique constraint
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from: null, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // createTable op
    const createTable = result.ops.find((o) => o.op === 'createTable');
    expect(createTable).toBeDefined();
    expect(createTable!.id).toBe('table.users');
    if (createTable!.op !== 'createTable') return;
    expect(createTable!.args.table).toBe('users');
    expect(createTable!.args.columns).toHaveLength(3);
    expect(createTable!.args.primaryKey).toEqual({ columns: ['id'], name: 'users_pkey' });

    // addUniqueConstraint op
    const addUnique = result.ops.find((o) => o.op === 'addUniqueConstraint');
    expect(addUnique).toBeDefined();
    expect(addUnique!.id).toBe('unique.users.users_email_key');

    // No addColumn ops (columns come from createTable)
    const addColumns = result.ops.filter((o) => o.op === 'addColumn');
    expect(addColumns).toHaveLength(0);

    // No addPrimaryKey ops (PK is inline in createTable)
    const addPKs = result.ops.filter((o) => o.op === 'addPrimaryKey');
    expect(addPKs).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 2. empty → multiple tables with FK relationships
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from: null, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const createTables = result.ops.filter((o) => o.op === 'createTable');
    expect(createTables).toHaveLength(2);
    // Deterministic alphabetical order
    expect(createTables[0]!.id).toBe('table.posts');
    expect(createTables[1]!.id).toBe('table.users');

    const fkOps = result.ops.filter((o) => o.op === 'addForeignKey');
    expect(fkOps).toHaveLength(1);
    if (fkOps[0]!.op !== 'addForeignKey') return;
    expect(fkOps[0]!.args.table).toBe('posts');
    expect(fkOps[0]!.args.referencedTable).toBe('users');
    expect(fkOps[0]!.args.columns).toEqual(['author_id']);
    expect(fkOps[0]!.args.referencedColumns).toEqual(['id']);

    // FKs always come after createTable
    const createTableIdx = result.ops.indexOf(createTables[1]!);
    const fkIdx = result.ops.indexOf(fkOps[0]!);
    expect(fkIdx).toBeGreaterThan(createTableIdx);
  });

  // --------------------------------------------------------------------------
  // 3. empty → table with indexes
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from: null, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const indexOps = result.ops.filter((o) => o.op === 'createIndex');
    expect(indexOps).toHaveLength(1);
    expect(indexOps[0]!.id).toBe('index.users.users_email_idx');
    if (indexOps[0]!.op !== 'createIndex') return;
    expect(indexOps[0]!.args.columns).toEqual(['email']);
  });

  // --------------------------------------------------------------------------
  // 4. empty → table with column defaults (literal and function)
  // --------------------------------------------------------------------------
  it('empty → table with column defaults (literal and function)', () => {
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

    const result = planContractDiff({ from: null, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const createTable = result.ops.find((o) => o.op === 'createTable');
    expect(createTable).toBeDefined();
    if (createTable!.op !== 'createTable') return;

    const statusCol = createTable!.args.columns.find((c) => c.name === 'status');
    expect(statusCol!.default).toEqual({ kind: 'literal', expression: "'active'" });

    const createdAtCol = createTable!.args.columns.find((c) => c.name === 'created_at');
    expect(createdAtCol!.default).toEqual({ kind: 'function', expression: 'now()' });
  });

  // --------------------------------------------------------------------------
  // 5. single table → add new table (incremental)
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // Only the new table should appear
    const createTables = result.ops.filter((o) => o.op === 'createTable');
    expect(createTables).toHaveLength(1);
    expect(createTables[0]!.id).toBe('table.posts');

    // No ops for the existing users table
    const userOps = result.ops.filter(
      (o) =>
        'args' in o &&
        'table' in (o.args as Record<string, unknown>) &&
        (o.args as Record<string, unknown>)['table'] === 'users',
    );
    expect(userOps).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 6. existing table → add new columns
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const addColumns = result.ops.filter((o) => o.op === 'addColumn');
    expect(addColumns).toHaveLength(2);
    // Alphabetical: email, name
    expect(addColumns[0]!.id).toBe('column.users.email');
    expect(addColumns[1]!.id).toBe('column.users.name');

    // No createTable op
    expect(result.ops.filter((o) => o.op === 'createTable')).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 7. existing table → add new constraints (unique, index, FK)
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const uniqueOps = result.ops.filter((o) => o.op === 'addUniqueConstraint');
    expect(uniqueOps).toHaveLength(1);
    expect(uniqueOps[0]!.id).toBe('unique.users.users_email_key');

    // Both the unique and index are new (not in `from`), so both get ops.
    // The contract planner doesn't deduplicate between new constraints —
    // semantic satisfaction only checks the `from` table to avoid
    // re-creating what already exists.
    const indexOps = result.ops.filter((o) => o.op === 'createIndex');
    expect(indexOps).toHaveLength(1);
    expect(indexOps[0]!.id).toBe('index.users.users_email_idx');

    const fkOps = result.ops.filter((o) => o.op === 'addForeignKey');
    expect(fkOps).toHaveLength(1);
    expect(fkOps[0]!.id).toBe('foreignKey.posts.posts_user_id_fkey');
  });

  // --------------------------------------------------------------------------
  // 8. extension-aware: pgvector column + type
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from: null, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // enableExtension for vector
    const extOps = result.ops.filter((o) => o.op === 'enableExtension');
    expect(extOps).toHaveLength(1);
    if (extOps[0]!.op !== 'enableExtension') return;
    expect(extOps[0]!.args.extension).toBe('vector');

    // createStorageType for Embedding
    const typeOps = result.ops.filter((o) => o.op === 'createStorageType');
    expect(typeOps).toHaveLength(1);
    if (typeOps[0]!.op !== 'createStorageType') return;
    expect(typeOps[0]!.args.typeName).toBe('Embedding');
    expect(typeOps[0]!.args.typeParams).toEqual({ length: 1536 });

    // Ordering: extensions → types → tables
    const extIdx = result.ops.indexOf(extOps[0]!);
    const typeIdx = result.ops.indexOf(typeOps[0]!);
    const tableOp = result.ops.find((o) => o.op === 'createTable');
    const tableIdx = result.ops.indexOf(tableOp!);
    expect(extIdx).toBeLessThan(typeIdx);
    expect(typeIdx).toBeLessThan(tableIdx);
  });

  // --------------------------------------------------------------------------
  // 9. determinism — same inputs → same outputs
  // --------------------------------------------------------------------------
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

    const result1 = planContractDiff({ from: null, to });
    const result2 = planContractDiff({ from: null, to });

    expect(result1).toEqual(result2);
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  // --------------------------------------------------------------------------
  // 10. conflict: type change → error
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.kind).toBe('typeMismatch');
    expect(result.conflicts[0]!.location?.table).toBe('users');
    expect(result.conflicts[0]!.location?.column).toBe('email');
  });

  // --------------------------------------------------------------------------
  // 11. conflict: column removal → error
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.kind).toBe('columnRemoved');
  });

  // --------------------------------------------------------------------------
  // 12. no-op: identical contracts → empty ops
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from: both, to: both });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.ops).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 13. pre/post checks — verify ADR 044 structured checks
  // --------------------------------------------------------------------------
  it('ops carry correct pre/post checks per ADR 044', () => {
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

    const result = planContractDiff({ from: null, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // createTable checks
    const createTable = result.ops.find((o) => o.op === 'createTable');
    expect(createTable!.pre).toEqual([{ id: 'tableNotExists', params: { table: 'users' } }]);
    expect(createTable!.post).toEqual([{ id: 'tableExists', params: { table: 'users' } }]);

    // createIndex checks
    const createIndex = result.ops.find((o) => o.op === 'createIndex');
    expect(createIndex!.pre).toEqual([
      { id: 'indexNotExists', params: { table: 'users', name: 'users_id_idx' } },
    ]);
    expect(createIndex!.post).toEqual([
      { id: 'indexExists', params: { table: 'users', name: 'users_id_idx' } },
    ]);

    // All ops have operationClass 'additive'
    for (const op of result.ops) {
      expect(op.operationClass).toBe('additive');
    }
  });

  // --------------------------------------------------------------------------
  // Additional edge cases
  // --------------------------------------------------------------------------
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

    const result = planContractDiff({ from, to });
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

    const result = planContractDiff({ from, to: EMPTY });
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

    // Nullability widening is not currently rejected (additive-only checks
    // for tightening). It produces no ops since it's a change to an existing
    // column, not an addition. In MVP this is a silent no-op.
    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('success');
  });

  it('addColumn for NOT NULL without default requires tableIsEmpty check', () => {
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
          status: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const addCol = result.ops.find((o) => o.op === 'addColumn') as AbstractOp & { op: 'addColumn' };
    expect(addCol).toBeDefined();
    // Should have tableIsEmpty pre-check for NOT NULL without default
    expect(addCol.pre).toContainEqual({ id: 'tableIsEmpty', params: { table: 'users' } });
    // Should have columnIsNotNull post-check
    expect(addCol.post).toContainEqual({
      id: 'columnIsNotNull',
      params: { table: 'users', column: 'status' },
    });
  });

  it('addColumn for NOT NULL with default does NOT require tableIsEmpty', () => {
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
          status: {
            nativeType: 'text',
            codecId: 'core/text@1',
            nullable: false,
            default: { kind: 'literal', expression: "'active'" },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const addCol = result.ops.find((o) => o.op === 'addColumn') as AbstractOp & { op: 'addColumn' };
    expect(addCol).toBeDefined();
    // Should NOT have tableIsEmpty check
    const emptyCheck = addCol.pre.find((c) => c.id === 'tableIsEmpty');
    expect(emptyCheck).toBeUndefined();
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

    const result = planContractDiff({ from, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const pkOps = result.ops.filter((o) => o.op === 'addPrimaryKey');
    expect(pkOps).toHaveLength(1);
    expect(pkOps[0]!.id).toBe('primaryKey.users.users_pkey');
    if (pkOps[0]!.op !== 'addPrimaryKey') return;
    expect(pkOps[0]!.args.columns).toEqual(['id']);
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

    const result = planContractDiff({ from: null, to });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // Unique: tableName_columns_key
    const unique = result.ops.find((o) => o.op === 'addUniqueConstraint');
    expect(unique!.id).toBe('unique.users.users_email_key');

    // Index: tableName_columns_idx
    const index = result.ops.find((o) => o.op === 'createIndex');
    expect(index!.id).toBe('index.users.users_id_email_idx');

    // FK: tableName_columns_fkey
    const fk = result.ops.find((o) => o.op === 'addForeignKey');
    expect(fk!.id).toBe('foreignKey.users.users_id_fkey');
  });
});

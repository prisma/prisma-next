import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { createSqliteMigrationPlanner } from '@prisma-next/target-sqlite/planner';
import { describe, expect, it } from 'vitest';

function makeColumn(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  };
}

function makeTable(overrides: Partial<StorageTable> = {}): StorageTable {
  return {
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  };
}

function makeContract(tables: Record<string, StorageTable>): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: {
      tables,
      storageHash: coreHash(`sha256:test-${Date.now()}`),
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const emptySchema = { tables: {}, dependencies: [] };

describe('SQLite migration planner', () => {
  const planner = createSqliteMigrationPlanner();

  it('plans CREATE TABLE for new table', () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          name: makeColumn({ nativeType: 'text', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = result.plan.operations;
    expect(ops.length).toBeGreaterThanOrEqual(1);
    const tableOp = ops.find((op) => op.id === 'table.users');
    expect(tableOp).toBeDefined();
    expect(tableOp!.execute[0]!.sql).toContain('CREATE TABLE');
    expect(tableOp!.execute[0]!.sql).toContain('"users"');
  });

  it('plans ADD COLUMN for existing table', () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          name: makeColumn({ nativeType: 'text', nullable: false }),
          bio: makeColumn({ nativeType: 'text', nullable: true }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const existingSchema = {
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', nativeType: 'integer', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    const result = planner.plan({
      contract,
      schema: existingSchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = result.plan.operations;
    const colOp = ops.find((op) => op.id === 'column.users.bio');
    expect(colOp).toBeDefined();
    expect(colOp!.execute[0]!.sql).toContain('ADD COLUMN "bio"');
  });

  it('plans CREATE INDEX', () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          email: makeColumn({ nativeType: 'text', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
        indexes: [{ columns: ['email'], name: 'idx_users_email' }],
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = result.plan.operations;
    const indexOp = ops.find((op) => op.id === 'index.users.idx_users_email');
    expect(indexOp).toBeDefined();
    expect(indexOp!.execute[0]!.sql).toContain('CREATE INDEX');
  });

  it('fails without additive policy', () => {
    const contract = makeContract({});
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: [] },
      frameworkComponents: [],
    });
    expect(result.kind).toBe('failure');
  });
});

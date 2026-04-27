import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';

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
      storageHash: coreHash('sha256:contract'),
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

// Live schema where "users.email" is nullable. Contract below will tighten
// it to NOT NULL.
function nullableEmailSchema(): { tables: Record<string, SqlTableIR>; dependencies: [] } {
  return {
    tables: {
      users: {
        name: 'users',
        columns: {
          id: {
            name: 'id',
            nativeType: 'INTEGER',
            nullable: false,
          },
          email: {
            name: 'email',
            nativeType: 'TEXT',
            nullable: true,
          },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    },
    dependencies: [],
  };
}

function tightenedEmailContract() {
  return makeContract({
    users: makeTable({
      columns: {
        id: makeColumn({ nativeType: 'integer', nullable: false }),
        email: makeColumn({ nativeType: 'text', nullable: false }),
      },
      primaryKey: { columns: ['id'] },
    }),
  });
}

describe('nullability-tightening backfill', () => {
  const planner = createSqliteMigrationPlanner();

  it("without 'data' in policy, recreate alone runs and would fail at runtime on NULLs", () => {
    const result = planner.plan({
      contract: tightenedEmailContract(),
      schema: nullableEmailSchema(),
      policy: { allowedOperationClasses: ['additive', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const ops = result.plan.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('recreateTable.users');
    expect(ops[0]?.operationClass).toBe('destructive');
  });

  it("with 'data' allowed, emits a backfill data-transform stub before the recreate", () => {
    const result = planner.plan({
      contract: tightenedEmailContract(),
      schema: nullableEmailSchema(),
      policy: { allowedOperationClasses: ['additive', 'destructive', 'data'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // Accessing operations throws because the DataTransformCall stub's
    // toOp() unconditionally throws PN-MIG-2001 — the user must fill the
    // rendered migration.ts before the plan is executable. This mirrors
    // Postgres's behavior.
    expect(() => result.plan.operations).toThrowError(/unfilled/i);

    // The rendered TypeScript contains the dataTransform placeholder and
    // the recreate follows it.
    const ts = result.plan.renderTypeScript();
    const backfillIdx = ts.indexOf('dataTransform(');
    const recreateIdx = ts.indexOf('recreateTable(');
    expect(backfillIdx).toBeGreaterThan(-1);
    expect(recreateIdx).toBeGreaterThan(-1);
    expect(backfillIdx).toBeLessThan(recreateIdx);
    expect(ts).toContain('placeholder("users-email-backfill-sql")');
  });

  it("relaxing NOT NULL → nullable does not emit a backfill even with 'data' allowed", () => {
    // Swap: schema is NOT NULL, contract wants nullable.
    const schema = {
      tables: {
        users: {
          name: 'users',
          columns: {
            id: {
              name: 'id',
              nativeType: 'INTEGER',
              nullable: false,
            },
            email: {
              name: 'email',
              nativeType: 'TEXT',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          email: makeColumn({ nativeType: 'text', nullable: true }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const result = planner.plan({
      contract,
      schema,
      policy: { allowedOperationClasses: ['additive', 'widening', 'data'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // No data transform — just a widening recreate.
    const ops = result.plan.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('recreateTable.users');
    expect(ops[0]?.operationClass).toBe('widening');
  });
});

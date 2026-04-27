import type { StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  RecreateTableCall,
} from '../../src/core/migrations/op-factory-call';

function col(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  };
}

function table(
  cols: Record<string, StorageColumn>,
  extras: Partial<StorageTable> = {},
): StorageTable {
  return {
    columns: cols,
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...extras,
  };
}

function tableIR(name: string): SqlTableIR {
  return {
    name,
    columns: { id: { name: 'id', nativeType: 'INTEGER', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  };
}

describe('CreateTableCall', () => {
  it('produces an additive op with correct id, label, and CREATE TABLE SQL', () => {
    const call = new CreateTableCall(
      'user',
      table(
        {
          id: col({ nativeType: 'integer', nullable: false }),
          email: col({ nativeType: 'text', nullable: false }),
        },
        { primaryKey: { columns: ['id'] } },
      ),
      new Map(),
      {},
    );
    expect(call.factoryName).toBe('createTable');
    expect(call.operationClass).toBe('additive');
    expect(call.label).toBe('Create table user');

    const op = call.toOp();
    expect(op.id).toBe('table.user');
    expect(op.label).toBe('Create table user');
    expect(op.execute[0]?.sql).toContain('CREATE TABLE "user"');
    expect(op.execute[0]?.sql).toContain('PRIMARY KEY');
    expect(op.precheck[0]?.sql).toContain("name = 'user'");
    expect(op.postcheck[0]?.sql).toContain("name = 'user'");
  });

  it('renderTypeScript() emits a createTable(...) expression', () => {
    const call = new CreateTableCall(
      'user',
      table({ id: col({ nativeType: 'integer', nullable: false }) }),
      new Map(),
      {},
    );
    const ts = call.renderTypeScript();
    expect(ts).toMatch(/^createTable\("user", /);
  });

  it('importRequirements() points at @prisma-next/target-sqlite/migration', () => {
    const call = new CreateTableCall('user', table({ id: col() }), new Map(), {});
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@prisma-next/target-sqlite/migration', symbol: 'createTable' },
    ]);
  });
});

describe('DropTableCall', () => {
  it('produces a destructive op with DROP TABLE', () => {
    const call = new DropTableCall('orphan');
    expect(call.factoryName).toBe('dropTable');
    expect(call.operationClass).toBe('destructive');
    expect(call.label).toBe('Drop table orphan');

    const op = call.toOp();
    expect(op.id).toBe('dropTable.orphan');
    expect(op.execute[0]?.sql).toBe('DROP TABLE "orphan"');
  });

  it('renderTypeScript() emits dropTable("orphan")', () => {
    expect(new DropTableCall('orphan').renderTypeScript()).toBe('dropTable("orphan")');
  });
});

describe('AddColumnCall', () => {
  it('produces an additive op with ALTER TABLE ADD COLUMN', () => {
    const call = new AddColumnCall(
      'user',
      'bio',
      col({ nativeType: 'text', nullable: true }),
      new Map(),
      {},
    );
    expect(call.factoryName).toBe('addColumn');
    expect(call.operationClass).toBe('additive');

    const op = call.toOp();
    expect(op.id).toBe('column.user.bio');
    expect(op.execute[0]?.sql).toContain('ALTER TABLE "user"');
    expect(op.execute[0]?.sql).toContain('ADD COLUMN "bio"');
  });
});

describe('DropColumnCall', () => {
  it('produces a destructive op with ALTER TABLE DROP COLUMN', () => {
    const call = new DropColumnCall('user', 'old');
    const op = call.toOp();
    expect(op.id).toBe('dropColumn.user.old');
    expect(op.operationClass).toBe('destructive');
    expect(op.execute[0]?.sql).toBe('ALTER TABLE "user" DROP COLUMN "old"');
  });
});

describe('CreateIndexCall', () => {
  it('produces a CREATE INDEX op (same shape regardless of FK-backing origin)', () => {
    const call = new CreateIndexCall('user', 'idx_email', ['email']);
    expect(call.label).toBe('Create index idx_email on user');
    const op = call.toOp();
    expect(op.id).toBe('index.user.idx_email');
    expect(op.execute[0]?.description).toBe('create index "idx_email"');
    expect(op.execute[0]?.sql).toBe('CREATE INDEX "idx_email" ON "user" ("email")');
  });
});

describe('DropIndexCall', () => {
  it('produces a destructive DROP INDEX IF EXISTS op', () => {
    const call = new DropIndexCall('user', 'idx_email');
    const op = call.toOp();
    expect(op.id).toBe('dropIndex.user.idx_email');
    expect(op.operationClass).toBe('destructive');
    expect(op.execute[0]?.sql).toBe('DROP INDEX IF EXISTS "idx_email"');
  });
});

describe('RecreateTableCall', () => {
  it('folds FK-with-index=true into the index recreation steps and dedupes on column set', () => {
    const contractTable = table(
      {
        id: col({ nativeType: 'integer', nullable: false }),
        userId: col({ nativeType: 'integer', nullable: false }),
        otherId: col({ nativeType: 'integer', nullable: false }),
      },
      {
        primaryKey: { columns: ['id'] },
        // userId is covered by both an explicit index AND an FK-with-index;
        // otherId is covered by an FK-with-index only.
        indexes: [{ columns: ['userId'], name: 'idx_explicit_user' }],
        foreignKeys: [
          {
            columns: ['userId'],
            references: { table: 'user', columns: ['id'] },
            index: true,
            constraint: true,
          },
          {
            columns: ['otherId'],
            references: { table: 'other', columns: ['id'] },
            index: true,
            constraint: true,
          },
        ],
      },
    );

    const call = new RecreateTableCall({
      tableName: 'post',
      contractTable,
      schemaTable: tableIR('post'),
      issues: [],
      operationClass: 'destructive',
      codecHooks: new Map(),
      storageTypes: {},
    });

    const op = call.toOp();
    const recreateSteps = op.execute.filter((s) => s.description.startsWith('recreate index'));
    // Two unique column-sets → two recreate-index steps.
    expect(recreateSteps).toHaveLength(2);
    const sqls = recreateSteps.map((s) => s.sql).join('\n');
    expect(sqls).toContain('"idx_explicit_user"');
    expect(sqls).toContain('"post_otherId_idx"');
    // userId column-set should not produce both an "idx_explicit_user" and a
    // "post_userId_idx" — dedup picks the first.
    expect(sqls).not.toContain('"post_userId_idx"');
  });

  it('produces a single op with the four core execute steps + index recreation', () => {
    const contractTable = table(
      {
        id: col({ nativeType: 'integer', nullable: false }),
        email: col({ nativeType: 'text', nullable: false }),
      },
      {
        primaryKey: { columns: ['id'] },
        indexes: [{ columns: ['email'], name: 'idx_email' }],
      },
    );

    const call = new RecreateTableCall({
      tableName: 'user',
      contractTable,
      schemaTable: tableIR('user'),
      issues: [
        {
          kind: 'type_mismatch',
          table: 'user',
          column: 'email',
          expected: 'TEXT',
          actual: 'INT',
          message: 'm',
        },
      ],
      operationClass: 'destructive',
      codecHooks: new Map(),
      storageTypes: {},
    });

    expect(call.factoryName).toBe('recreateTable');
    const op = call.toOp();
    expect(op.id).toBe('recreateTable.user');
    expect(op.operationClass).toBe('destructive');

    // Execute order: temp-create → copy → drop → rename → index
    const descriptions = op.execute.map((s) => s.description);
    expect(descriptions[0]).toContain('create new table "_prisma_new_user"');
    expect(descriptions[1]).toContain('copy data');
    expect(descriptions[2]).toContain('drop old table');
    expect(descriptions[3]).toContain('rename');
    expect(descriptions[4]).toContain('idx_email');

    // Postcheck includes per-issue idempotency check
    expect(op.postcheck.some((s) => s.description.includes('type'))).toBe(true);
  });
});

describe('dataTransform factory (user-authored)', () => {
  it('produces a class="data" op with execute step from the run closure', async () => {
    const { dataTransform } = await import('../../src/core/migrations/operations/data-transform');
    const op = dataTransform({
      id: 'data_migration.backfill-user-email',
      label: 'Backfill user.email',
      table: 'user',
      description: 'fill nulls',
      run: () => 'UPDATE "user" SET email = \'\' WHERE email IS NULL',
    });

    expect(op.id).toBe('data_migration.backfill-user-email');
    expect(op.label).toBe('Backfill user.email');
    expect(op.operationClass).toBe('data');
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      { description: 'fill nulls', sql: 'UPDATE "user" SET email = \'\' WHERE email IS NULL' },
    ]);
    expect(op.target.details).toEqual({ schema: 'main', objectType: 'table', name: 'user' });
  });
});

describe('DataTransformCall', () => {
  it('toOp() throws PN-MIG-2001 (unfilled placeholder)', () => {
    const call = new DataTransformCall('user', 'email');
    expect(() => call.toOp()).toThrowError(/PN-MIG-2001|unfilled/i);
  });

  it('renderTypeScript() emits a dataTransform({...}) call with a placeholder run slot', () => {
    const call = new DataTransformCall('user', 'email');
    const ts = call.renderTypeScript();
    expect(ts).toContain('dataTransform({');
    expect(ts).toContain('placeholder("user-email-backfill-sql")');
    expect(ts).toContain('"data_migration.backfill-user-email"');
  });

  it('importRequirements() pulls dataTransform + placeholder from the migration module', () => {
    const reqs = new DataTransformCall('user', 'email').importRequirements();
    expect(reqs).toEqual([
      { moduleSpecifier: '@prisma-next/target-sqlite/migration', symbol: 'dataTransform' },
      { moduleSpecifier: '@prisma-next/target-sqlite/migration', symbol: 'placeholder' },
    ]);
  });
});

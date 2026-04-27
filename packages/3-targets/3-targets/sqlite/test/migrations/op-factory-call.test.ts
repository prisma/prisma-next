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
import type {
  SqliteColumnSpec,
  SqliteTableSpec,
} from '../../src/core/migrations/operations/shared';

function colSpec(overrides: Partial<SqliteColumnSpec> = {}): SqliteColumnSpec {
  return {
    name: 'col',
    typeSql: 'TEXT',
    defaultSql: '',
    nullable: true,
    ...overrides,
  };
}

function tableSpec(
  columns: SqliteColumnSpec[],
  overrides: Partial<SqliteTableSpec> = {},
): SqliteTableSpec {
  return {
    columns,
    uniques: [],
    foreignKeys: [],
    ...overrides,
  };
}

describe('CreateTableCall', () => {
  it('produces an additive op with correct id, label, and CREATE TABLE SQL', () => {
    const call = new CreateTableCall(
      'user',
      tableSpec(
        [
          colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false }),
          colSpec({ name: 'email', typeSql: 'TEXT', nullable: false }),
        ],
        { primaryKey: { columns: ['id'] } },
      ),
    );
    expect(call.factoryName).toBe('createTable');
    expect(call.operationClass).toBe('additive');
    expect(call.label).toBe('Create table user');

    const op = call.toOp();
    expect(op.id).toBe('table.user');
    expect(op.label).toBe('Create table user');
    expect(op.execute[0]?.sql).toContain('CREATE TABLE "user"');
    expect(op.execute[0]?.sql).toContain('PRIMARY KEY ("id")');
    expect(op.execute[0]?.sql).toContain('"email" TEXT NOT NULL');
    expect(op.precheck[0]?.sql).toContain("name = 'user'");
    expect(op.postcheck[0]?.sql).toContain("name = 'user'");
  });

  it('emits INTEGER PRIMARY KEY AUTOINCREMENT inline when the column carries the flag', () => {
    const call = new CreateTableCall(
      'user',
      tableSpec(
        [
          colSpec({
            name: 'id',
            typeSql: 'INTEGER',
            nullable: false,
            inlineAutoincrementPrimaryKey: true,
          }),
        ],
        { primaryKey: { columns: ['id'] } },
      ),
    );
    const sql = call.toOp().execute[0]?.sql ?? '';
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    // The table-level PK clause must be suppressed when an inline PK is present.
    expect(sql).not.toMatch(/PRIMARY KEY \("id"\)/);
  });

  it('renderTypeScript() emits a createTable(...) expression with the embedded spec', () => {
    const call = new CreateTableCall(
      'user',
      tableSpec([colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false })]),
    );
    const ts = call.renderTypeScript();
    expect(ts).toMatch(/^createTable\("user", /);
    expect(ts).toContain('typeSql:');
  });

  it('importRequirements() points at @prisma-next/target-sqlite/migration', () => {
    const call = new CreateTableCall('user', tableSpec([colSpec()]));
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
      colSpec({ name: 'bio', typeSql: 'TEXT', nullable: true }),
    );
    expect(call.factoryName).toBe('addColumn');
    expect(call.operationClass).toBe('additive');

    const op = call.toOp();
    expect(op.id).toBe('column.user.bio');
    expect(op.execute[0]?.sql).toContain('ALTER TABLE "user"');
    expect(op.execute[0]?.sql).toContain('ADD COLUMN "bio" TEXT');
  });

  it('includes default and NOT NULL', () => {
    const call = new AddColumnCall(
      'user',
      colSpec({
        name: 'role',
        typeSql: 'TEXT',
        defaultSql: "DEFAULT 'user'",
        nullable: false,
      }),
    );
    const op = call.toOp();
    expect(op.execute[0]?.sql).toContain("DEFAULT 'user'");
    expect(op.execute[0]?.sql).toContain('NOT NULL');
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
  it('produces a single op with the four core execute steps + index recreation', () => {
    const contractSpec = tableSpec(
      [
        colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false }),
        colSpec({ name: 'email', typeSql: 'TEXT', nullable: false }),
      ],
      { primaryKey: { columns: ['id'] } },
    );

    const call = new RecreateTableCall({
      tableName: 'user',
      contractTable: contractSpec,
      schemaColumnNames: ['id', 'email'],
      indexes: [{ name: 'idx_email', columns: ['email'] }],
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

    // Per-issue postcheck (type_mismatch)
    expect(op.postcheck.some((s) => s.description.includes('type'))).toBe(true);
  });

  it('skips columns missing from the live schema in the data-copy column list', () => {
    const contractSpec = tableSpec(
      [
        colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false }),
        colSpec({ name: 'old_col', typeSql: 'TEXT', nullable: true }),
        colSpec({ name: 'new_col', typeSql: 'TEXT', nullable: true }),
      ],
      { primaryKey: { columns: ['id'] } },
    );

    const call = new RecreateTableCall({
      tableName: 'user',
      contractTable: contractSpec,
      schemaColumnNames: ['id', 'old_col'],
      indexes: [],
      issues: [],
      operationClass: 'widening',
    });

    const copyStep = call.toOp().execute.find((s) => s.description.startsWith('copy data'));
    expect(copyStep?.sql).toContain('"id", "old_col"');
    expect(copyStep?.sql).not.toContain('"new_col"');
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

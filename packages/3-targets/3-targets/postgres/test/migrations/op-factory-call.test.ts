/**
 * Unit coverage for the Postgres class-flow IR:
 *
 * - Every `*Call` class constructs with literal args, is frozen, computes its
 *   label, dispatches through `accept()` to the right visitor method, and
 *   emits the expected TypeScript expression + import requirements.
 * - `PlaceholderExpression` renders as bare `placeholder("slot")` and
 *   declares the matching import.
 * - `renderCallsToTypeScript` deduplicates + sorts imports across a mixed
 *   call list, and recurses into `DataTransformCall` children polymorphically.
 * - `TypeScriptRenderablePostgresMigration` routes `operations` through
 *   `renderOps` and `renderTypeScript()` through `renderCallsToTypeScript`.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AddColumnCall,
  AddEnumValuesCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateEnumTypeCall,
  CreateIndexCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropEnumTypeCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  type PostgresOpFactoryCallVisitor,
  RenameTypeCall,
  SetDefaultCall,
  SetNotNullCall,
} from '../../src/core/migrations/op-factory-call';
import { PlaceholderExpression } from '../../src/core/migrations/placeholder-expression';
import { TypeScriptRenderablePostgresMigration } from '../../src/core/migrations/planner-produced-postgres-migration';
import { renderOps } from '../../src/core/migrations/render-ops';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';

const META = { from: 'sha256:from', to: 'sha256:to' } as const;

describe('PlaceholderExpression', () => {
  it('is frozen and renders as a placeholder arrow call with the slot name quoted', () => {
    const placeholder = new PlaceholderExpression('backfill-users');

    expect(Object.isFrozen(placeholder)).toBe(true);
    expect(placeholder.slot).toBe('backfill-users');
    expect(placeholder.renderTypeScript()).toBe('placeholder("backfill-users")');
  });

  it('requires the `placeholder` symbol from the errors-migration module', () => {
    const placeholder = new PlaceholderExpression('slot');

    expect(placeholder.importRequirements()).toEqual([
      { moduleSpecifier: '@prisma-next/errors/migration', symbol: 'placeholder' },
    ]);
  });
});

describe('Postgres call classes', () => {
  describe('construction + dispatch', () => {
    it('CreateTableCall freezes, labels from the table name, and dispatches createTable', () => {
      const call = new CreateTableCall(
        'public',
        'user',
        [{ name: 'id', typeSql: 'text', defaultSql: '', nullable: false }],
        { columns: ['id'] },
      );

      expect(Object.isFrozen(call)).toBe(true);
      expect(call.factoryName).toBe('createTable');
      expect(call.operationClass).toBe('additive');
      expect(call.label).toBe('Create table "user"');

      const visitor = makeDispatchSpy();
      call.accept(visitor);
      expect(visitor.createTable).toHaveBeenCalledWith(call);
    });

    it('DataTransformCall exposes its check/run expressions and carries a caller-supplied operationClass', () => {
      const check = new PlaceholderExpression('slot-check');
      const run = new PlaceholderExpression('slot-run');
      const call = new DataTransformCall('Backfill', check, run, 'widening');

      expect(call.check).toBe(check);
      expect(call.run).toBe(run);
      expect(call.operationClass).toBe('widening');

      const visitor = makeDispatchSpy();
      call.accept(visitor);
      expect(visitor.dataTransform).toHaveBeenCalledWith(call);
    });
  });

  describe('renderTypeScript + importRequirements', () => {
    it('emits the factory call with positional literal args and imports the factory symbol', () => {
      const call = new DropTableCall('public', 'user');
      expect(call.renderTypeScript()).toBe('dropTable("public", "user")');
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'dropTable' },
      ]);
    });

    it('SetDefaultCall omits the operationClass argument when additive, emits it when widening', () => {
      const additive = new SetDefaultCall('public', 'user', 'created_at', "DEFAULT 'now'");
      expect(additive.renderTypeScript()).toBe(
        `setDefault("public", "user", "created_at", "DEFAULT 'now'")`,
      );

      const widening = new SetDefaultCall(
        'public',
        'user',
        'created_at',
        "DEFAULT 'now'",
        'widening',
      );
      expect(widening.renderTypeScript()).toBe(
        `setDefault("public", "user", "created_at", "DEFAULT 'now'", "widening")`,
      );
    });

    it('DropConstraintCall omits kind when unique, emits it otherwise', () => {
      const unique = new DropConstraintCall('public', 'user', 'user_email_key');
      expect(unique.renderTypeScript()).toBe('dropConstraint("public", "user", "user_email_key")');

      const fk = new DropConstraintCall('public', 'user', 'user_org_fk', 'foreignKey');
      expect(fk.renderTypeScript()).toBe(
        'dropConstraint("public", "user", "user_org_fk", "foreignKey")',
      );
    });

    it('DataTransformCall renders children inline and concatenates their import requirements', () => {
      const call = new DataTransformCall(
        'Backfill',
        new PlaceholderExpression('check'),
        new PlaceholderExpression('run'),
      );

      expect(call.renderTypeScript()).toBe(
        'dataTransform("Backfill", () => placeholder("check"), () => placeholder("run"))',
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'dataTransform' },
        { moduleSpecifier: '@prisma-next/errors/migration', symbol: 'placeholder' },
        { moduleSpecifier: '@prisma-next/errors/migration', symbol: 'placeholder' },
      ]);
    });
  });
});

describe('renderCallsToTypeScript', () => {
  it('deduplicates + sorts imports across a mixed call list and keeps the base Migration import', () => {
    const calls = [
      new CreateTableCall('public', 'user', [
        { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
      ]),
      new DropTableCall('public', 'old_user'),
      new AddColumnCall('public', 'user', {
        name: 'email',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      new CreateIndexCall('public', 'user', 'user_email_idx', ['email']),
    ];

    const source = renderCallsToTypeScript(calls, META);

    expect(source).toContain("import { Migration } from '@prisma-next/family-sql/migration';");
    // Per-factory imports collapsed under a single target-postgres line, sorted.
    expect(source).toContain(
      "import { addColumn, createIndex, createTable, dropTable } from '@prisma-next/target-postgres/migration';",
    );
    // Each call appears once in the operations body.
    expect(source).toContain('createTable(');
    expect(source).toContain('dropTable(');
    expect(source).toContain('addColumn(');
    expect(source).toContain('createIndex(');
  });

  it('emits DataTransformCall children in-line and contributes the placeholder import', () => {
    const calls = [
      new DataTransformCall(
        'Backfill user emails',
        new PlaceholderExpression('check-emails'),
        new PlaceholderExpression('run-emails'),
      ),
    ];

    const source = renderCallsToTypeScript(calls, META);

    expect(source).toContain("import { placeholder } from '@prisma-next/errors/migration';");
    expect(source).toContain(
      'dataTransform("Backfill user emails", () => placeholder("check-emails"), () => placeholder("run-emails"))',
    );
  });

  it('embeds describe() with the supplied from/to hashes', () => {
    const source = renderCallsToTypeScript([], { from: 'sha256:a', to: 'sha256:b' });
    expect(source).toContain('from: "sha256:a",');
    expect(source).toContain('to: "sha256:b",');
    expect(source).toContain('class M extends Migration {');
    expect(source).toContain('Migration.run(import.meta.url, M);');
  });
});

describe('renderOps', () => {
  it('lowers every non-dataTransform variant via its corresponding pure factory', () => {
    const calls = [
      new CreateTableCall('public', 'user', [
        { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
      ]),
      new DropTableCall('public', 'stale'),
      new AddColumnCall('public', 'user', {
        name: 'email',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      new DropColumnCall('public', 'user', 'legacy'),
      new AlterColumnTypeCall('public', 'user', 'age', {
        qualifiedTargetType: 'integer',
        formatTypeExpected: 'integer',
        rawTargetTypeForLabel: 'integer',
      }),
      new SetNotNullCall('public', 'user', 'email'),
      new DropNotNullCall('public', 'user', 'nickname'),
      new SetDefaultCall('public', 'user', 'created_at', 'DEFAULT now()'),
      new DropDefaultCall('public', 'user', 'updated_at'),
      new AddPrimaryKeyCall('public', 'user', 'user_pkey', ['id']),
      new AddUniqueCall('public', 'user', 'user_email_key', ['email']),
      new AddForeignKeyCall('public', 'user', {
        name: 'user_org_fk',
        columns: ['org_id'],
        references: { table: 'org', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
      new DropConstraintCall('public', 'user', 'user_email_key'),
      new CreateIndexCall('public', 'user', 'user_email_idx', ['email']),
      new DropIndexCall('public', 'user', 'stale_idx'),
      new CreateEnumTypeCall('public', 'status', ['active', 'archived']),
      new AddEnumValuesCall('public', 'status', 'public.status', ['pending']),
      new DropEnumTypeCall('public', 'status'),
      new RenameTypeCall('public', 'status_old', 'status'),
    ];

    const ops = renderOps(calls);

    expect(ops).toHaveLength(calls.length);
    for (const op of ops) {
      expect(op.id).toBeTypeOf('string');
      expect(op.execute).toBeInstanceOf(Array);
    }
  });

  it('throws PN-MIG-2001 on DataTransformCall with placeholder bodies', () => {
    const call = new DataTransformCall(
      'Backfill',
      new PlaceholderExpression('check'),
      new PlaceholderExpression('run'),
    );

    expect(() => renderOps([call])).toThrow(/Unfilled migration placeholder/);
  });
});

describe('TypeScriptRenderablePostgresMigration', () => {
  it('identifies as postgres, derives destination from meta.to, and materializes operations via renderOps', () => {
    const calls = [new DropTableCall('public', 'stale')];
    const migration = new TypeScriptRenderablePostgresMigration(calls, META);

    expect(migration.targetId).toBe('postgres');
    expect(migration.destination).toEqual({ storageHash: 'sha256:to' });
    expect(migration.describe()).toEqual(META);

    const operations = migration.operations;
    expect(operations).toHaveLength(1);
    expect(operations[0]?.id).toBe('dropTable.stale');
  });

  it('renders TypeScript source mirroring renderCallsToTypeScript output', () => {
    const calls = [new DropTableCall('public', 'stale')];
    const migration = new TypeScriptRenderablePostgresMigration(calls, META);

    const source = migration.renderTypeScript();
    expect(source).toContain("import { Migration } from '@prisma-next/family-sql/migration';");
    expect(source).toContain("import { dropTable } from '@prisma-next/target-postgres/migration';");
    expect(source).toContain('dropTable("public", "stale")');
  });
});

function makeDispatchSpy(): PostgresOpFactoryCallVisitor<void> {
  return {
    createTable: vi.fn(),
    dropTable: vi.fn(),
    addColumn: vi.fn(),
    dropColumn: vi.fn(),
    alterColumnType: vi.fn(),
    setNotNull: vi.fn(),
    dropNotNull: vi.fn(),
    setDefault: vi.fn(),
    dropDefault: vi.fn(),
    addPrimaryKey: vi.fn(),
    addForeignKey: vi.fn(),
    addUnique: vi.fn(),
    createIndex: vi.fn(),
    dropIndex: vi.fn(),
    dropConstraint: vi.fn(),
    createEnumType: vi.fn(),
    addEnumValues: vi.fn(),
    dropEnumType: vi.fn(),
    renameType: vi.fn(),
    rawSql: vi.fn(),
    createExtension: vi.fn(),
    createSchema: vi.fn(),
    dataTransform: vi.fn(),
  };
}

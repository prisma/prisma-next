/**
 * Unit coverage for the Postgres class-flow IR:
 *
 * - Every `*Call` class constructs with literal args, is frozen, computes its
 *   label, lowers to the matching runtime op via `toOp()`, and emits the
 *   expected TypeScript expression + import requirements.
 * - `DataTransformCall` renders its body as `() => placeholder("slot")`
 *   closures around the authored slot names and always throws
 *   `PN-MIG-2001` from `toOp()` because the planner can only emit
 *   unfilled stubs.
 * - `renderCallsToTypeScript` deduplicates + sorts imports across a mixed
 *   call list.
 * - `TypeScriptRenderablePostgresMigration` routes `operations` through
 *   `renderOps` and `renderTypeScript()` through `renderCallsToTypeScript`.
 */

import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import {
  AddColumnCall,
  AddEnumValuesCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateEnumTypeCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreateSchemaCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropEnumTypeCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  RawSqlCall,
  RenameTypeCall,
  SetDefaultCall,
  SetNotNullCall,
} from '../../src/core/migrations/op-factory-call';
import { TypeScriptRenderablePostgresMigration } from '../../src/core/migrations/planner-produced-postgres-migration';
import { renderOps } from '../../src/core/migrations/render-ops';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';

const META = { from: 'sha256:from', to: 'sha256:to' } as const;

describe('Postgres call classes', () => {
  describe('construction + toOp parity', () => {
    it('CreateTableCall freezes, labels from the table name, and lowers to a createTable op', () => {
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

      expect(call.toOp()).toMatchObject({
        id: 'table.user',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'user' },
        },
      });
    });

    it('DataTransformCall carries its slot names and a caller-supplied operationClass; toOp throws PN-MIG-2001', () => {
      const call = new DataTransformCall('Backfill', 'slot-check', 'slot-run', 'widening');

      expect(call.checkSlot).toBe('slot-check');
      expect(call.runSlot).toBe('slot-run');
      expect(call.operationClass).toBe('widening');

      expect(() => call.toOp()).toThrow(/Unfilled migration placeholder/);
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

    it('DataTransformCall renders slots as placeholder closures and imports factory + placeholder + contract', () => {
      const call = new DataTransformCall('Backfill', 'check', 'run');

      expect(call.renderTypeScript()).toBe(
        [
          'dataTransform(contract, "Backfill", {',
          '  check: () => placeholder("check"),',
          '  run: () => placeholder("run"),',
          '})',
        ].join('\n'),
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'dataTransform' },
        { moduleSpecifier: '@prisma-next/errors/migration', symbol: 'placeholder' },
        {
          moduleSpecifier: './contract.json',
          symbol: 'contract',
          kind: 'default',
          attributes: { type: 'json' },
        },
      ]);
    });
  });

  describe('per-class renderTypeScript coverage', () => {
    const migrationModule = '@prisma-next/target-postgres/migration';
    const expectFactoryImport = (
      call: { importRequirements(): readonly unknown[] },
      symbol: string,
    ) => {
      expect(call.importRequirements()).toEqual([{ moduleSpecifier: migrationModule, symbol }]);
    };

    it('CreateTableCall emits columns as an array literal; omits the primary-key arg when absent', () => {
      const withoutPk = new CreateTableCall('public', 'user', [
        { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
      ]);
      expect(withoutPk.renderTypeScript()).toBe(
        'createTable("public", "user", [{ name: "id", typeSql: "text", defaultSql: "", nullable: false }])',
      );
      expectFactoryImport(withoutPk, 'createTable');

      const withPk = new CreateTableCall(
        'public',
        'user',
        [{ name: 'id', typeSql: 'text', defaultSql: '', nullable: false }],
        { columns: ['id'] },
      );
      expect(withPk.renderTypeScript()).toBe(
        'createTable("public", "user", [{ name: "id", typeSql: "text", defaultSql: "", nullable: false }], { columns: ["id"] })',
      );
    });

    it('AddColumnCall emits the column literal and imports addColumn', () => {
      const call = new AddColumnCall('public', 'user', {
        name: 'email',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      });
      expect(call.renderTypeScript()).toBe(
        'addColumn("public", "user", { name: "email", typeSql: "text", defaultSql: "", nullable: true })',
      );
      expectFactoryImport(call, 'addColumn');
    });

    it('DropColumnCall emits three positional args and imports dropColumn', () => {
      const call = new DropColumnCall('public', 'user', 'legacy');
      expect(call.renderTypeScript()).toBe('dropColumn("public", "user", "legacy")');
      expectFactoryImport(call, 'dropColumn');
    });

    it('AlterColumnTypeCall inlines the options object and imports alterColumnType', () => {
      const call = new AlterColumnTypeCall('public', 'user', 'age', {
        qualifiedTargetType: 'integer',
        formatTypeExpected: 'integer',
        rawTargetTypeForLabel: 'integer',
      });
      const rendered = call.renderTypeScript();
      expect(rendered.startsWith('alterColumnType("public", "user", "age", {')).toBe(true);
      expect(rendered).toContain('qualifiedTargetType: "integer"');
      expect(rendered).toContain('formatTypeExpected: "integer"');
      expect(rendered).toContain('rawTargetTypeForLabel: "integer"');
      expectFactoryImport(call, 'alterColumnType');
    });

    it('AlterColumnTypeCall preserves an explicit USING clause in the options literal', () => {
      const call = new AlterColumnTypeCall('public', 'user', 'age', {
        qualifiedTargetType: 'integer',
        formatTypeExpected: 'integer',
        rawTargetTypeForLabel: 'integer',
        using: '"age"::integer',
      });
      expect(call.renderTypeScript()).toContain('using: "\\"age\\"::integer"');
    });

    it('SetNotNullCall / DropNotNullCall / DropDefaultCall emit three positional args', () => {
      expect(new SetNotNullCall('public', 'user', 'email').renderTypeScript()).toBe(
        'setNotNull("public", "user", "email")',
      );
      expect(new DropNotNullCall('public', 'user', 'nickname').renderTypeScript()).toBe(
        'dropNotNull("public", "user", "nickname")',
      );
      expect(new DropDefaultCall('public', 'user', 'updated_at').renderTypeScript()).toBe(
        'dropDefault("public", "user", "updated_at")',
      );
      expectFactoryImport(new SetNotNullCall('public', 'user', 'email'), 'setNotNull');
      expectFactoryImport(new DropNotNullCall('public', 'user', 'nickname'), 'dropNotNull');
      expectFactoryImport(new DropDefaultCall('public', 'user', 'updated_at'), 'dropDefault');
    });

    it('AddPrimaryKeyCall / AddUniqueCall emit (schema, table, constraint, columns)', () => {
      const pk = new AddPrimaryKeyCall('public', 'user', 'user_pkey', ['id']);
      expect(pk.renderTypeScript()).toBe('addPrimaryKey("public", "user", "user_pkey", ["id"])');
      expectFactoryImport(pk, 'addPrimaryKey');

      const uq = new AddUniqueCall('public', 'user', 'user_email_key', ['email']);
      expect(uq.renderTypeScript()).toBe(
        'addUnique("public", "user", "user_email_key", ["email"])',
      );
      expectFactoryImport(uq, 'addUnique');
    });

    it('AddForeignKeyCall serializes the full ForeignKeySpec including optional referential actions', () => {
      const minimal = new AddForeignKeyCall('public', 'post', {
        name: 'fk',
        columns: ['a'],
        references: { table: 'u', columns: ['id'] },
      });
      expect(minimal.renderTypeScript()).toBe(
        'addForeignKey("public", "post", { name: "fk", columns: ["a"], references: { table: "u", columns: ["id"] } })',
      );
      expectFactoryImport(minimal, 'addForeignKey');

      const withActions = new AddForeignKeyCall('public', 'post', {
        name: 'post_author_fk',
        columns: ['author_id'],
        references: { table: 'user', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'restrict',
      });
      expect(withActions.renderTypeScript()).toContain('onDelete: "cascade"');
      expect(withActions.renderTypeScript()).toContain('onUpdate: "restrict"');
    });

    it('CreateIndexCall / DropIndexCall emit their positional args and import createIndex/dropIndex', () => {
      const ci = new CreateIndexCall('public', 'user', 'user_email_idx', ['email']);
      expect(ci.renderTypeScript()).toBe(
        'createIndex("public", "user", "user_email_idx", ["email"])',
      );
      expectFactoryImport(ci, 'createIndex');

      const di = new DropIndexCall('public', 'user', 'stale_idx');
      expect(di.renderTypeScript()).toBe('dropIndex("public", "user", "stale_idx")');
      expectFactoryImport(di, 'dropIndex');
    });

    it('CreateEnumTypeCall emits the enum values as an array literal', () => {
      const call = new CreateEnumTypeCall('public', 'status', ['active', 'archived']);
      expect(call.renderTypeScript()).toBe(
        'createEnumType("public", "status", ["active", "archived"])',
      );
      expectFactoryImport(call, 'createEnumType');
    });

    it('AddEnumValuesCall distinguishes typeName from nativeType in its positional args', () => {
      const call = new AddEnumValuesCall('public', 'status', 'public.status_native', ['pending']);
      expect(call.renderTypeScript()).toBe(
        'addEnumValues("public", "status", "public.status_native", ["pending"])',
      );
      expectFactoryImport(call, 'addEnumValues');
    });

    it('DropEnumTypeCall / RenameTypeCall emit matching positional args', () => {
      const drop = new DropEnumTypeCall('public', 'status');
      expect(drop.renderTypeScript()).toBe('dropEnumType("public", "status")');
      expectFactoryImport(drop, 'dropEnumType');

      const rename = new RenameTypeCall('public', 'status_old', 'status');
      expect(rename.renderTypeScript()).toBe('renameType("public", "status_old", "status")');
      expectFactoryImport(rename, 'renameType');
    });

    it('RenameTypeCall prechecks both fromName existence and toName non-existence', () => {
      const op = new RenameTypeCall('public', 'status_old', 'status').toOp();
      const prechecks = op.precheck.map((s) => s.sql);
      expect(prechecks).toHaveLength(2);
      expect(prechecks[0]).toContain("t.typname = 'status_old'");
      expect(prechecks[0]).toContain('EXISTS (');
      expect(prechecks[1]).toContain("t.typname = 'status'");
      expect(prechecks[1]).toContain('NOT EXISTS (');
    });

    it('CreateExtensionCall / CreateSchemaCall emit a single-arg factory call', () => {
      const ext = new CreateExtensionCall('citext');
      expect(ext.renderTypeScript()).toBe('createExtension("citext")');
      expectFactoryImport(ext, 'createExtension');

      const schema = new CreateSchemaCall('app');
      expect(schema.renderTypeScript()).toBe('createSchema("app")');
      expectFactoryImport(schema, 'createSchema');
    });

    it('RawSqlCall serializes the stored op as a JSON literal and imports rawSql', () => {
      const op = {
        id: 'raw.1',
        label: 'raw 1',
        operationClass: 'additive' as const,
        target: { id: 'postgres' as const },
        precheck: [],
        execute: [{ description: 'do', sql: 'SELECT 1' }],
        postcheck: [],
      };
      const call = new RawSqlCall(op);

      const rendered = call.renderTypeScript();
      expect(rendered.startsWith('rawSql({')).toBe(true);
      expect(rendered).toContain('id: "raw.1"');
      expect(rendered).toContain('sql: "SELECT 1"');
      expectFactoryImport(call, 'rawSql');
    });

    it('RawSqlCall carries the stored op unchanged; operationClass + label mirror the op', () => {
      const op = {
        id: 'raw.widening.1',
        label: 'raw widening label',
        operationClass: 'widening' as const,
        target: { id: 'postgres' as const },
        precheck: [],
        execute: [],
        postcheck: [],
      };
      const call = new RawSqlCall(op);
      expect(call.operationClass).toBe('widening');
      expect(call.label).toBe('raw widening label');
      expect(call.op).toBe(op);
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
    // Asserted as an exact-length array so a stray duplicate import line fails here.
    const targetPostgresImports = source
      .split('\n')
      .filter((line) => line.includes("from '@prisma-next/target-postgres/migration';"));
    expect(targetPostgresImports).toEqual([
      "import { addColumn, createIndex, createTable, dropTable } from '@prisma-next/target-postgres/migration';",
    ]);
    // Each call appears once in the operations body.
    expect(source).toContain('createTable(');
    expect(source).toContain('dropTable(');
    expect(source).toContain('addColumn(');
    expect(source).toContain('createIndex(');
  });

  it('emits DataTransformCall slots as placeholder closures and contributes placeholder + contract imports', () => {
    const calls = [new DataTransformCall('Backfill user emails', 'check-emails', 'run-emails')];

    const source = renderCallsToTypeScript(calls, META);

    expect(source).toContain("import { placeholder } from '@prisma-next/errors/migration';");
    expect(source).toContain('import contract from \'./contract.json\' with { type: "json" };');
    expect(source).toContain(
      [
        '      dataTransform(contract, "Backfill user emails", {',
        '        check: () => placeholder("check-emails"),',
        '        run: () => placeholder("run-emails"),',
        '      })',
      ].join('\n'),
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
  it('lowers each variant via its pure factory, pinning id/operationClass/target.details', () => {
    const liftedOp = {
      id: 'custom.op.1',
      label: 'Custom raw op',
      operationClass: 'additive' as const,
      target: { id: 'postgres' as const },
      precheck: [],
      execute: [{ description: 'run', sql: 'SELECT 1' }],
      postcheck: [],
    };
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
      new RawSqlCall(liftedOp),
      new CreateExtensionCall('citext'),
      new CreateSchemaCall('app'),
    ];

    const ops = renderOps(calls);

    const schemaObject = (objectType: string, name: string, table?: string) => ({
      schema: 'public',
      objectType,
      name,
      ...ifDefined('table', table),
    });
    const expectations: Array<{
      id: string;
      operationClass: string;
      details: Record<string, unknown> | undefined;
    }> = [
      { id: 'table.user', operationClass: 'additive', details: schemaObject('table', 'user') },
      {
        id: 'dropTable.stale',
        operationClass: 'destructive',
        details: schemaObject('table', 'stale'),
      },
      {
        id: 'column.user.email',
        operationClass: 'additive',
        details: schemaObject('column', 'email', 'user'),
      },
      {
        id: 'dropColumn.user.legacy',
        operationClass: 'destructive',
        details: schemaObject('column', 'legacy', 'user'),
      },
      {
        id: 'alterType.user.age',
        operationClass: 'destructive',
        details: schemaObject('column', 'age', 'user'),
      },
      {
        id: 'alterNullability.setNotNull.user.email',
        operationClass: 'destructive',
        details: schemaObject('column', 'email', 'user'),
      },
      {
        id: 'alterNullability.dropNotNull.user.nickname',
        operationClass: 'widening',
        details: schemaObject('column', 'nickname', 'user'),
      },
      {
        id: 'setDefault.user.created_at',
        operationClass: 'additive',
        details: schemaObject('column', 'created_at', 'user'),
      },
      {
        id: 'dropDefault.user.updated_at',
        operationClass: 'destructive',
        details: schemaObject('column', 'updated_at', 'user'),
      },
      {
        id: 'primaryKey.user.user_pkey',
        operationClass: 'additive',
        details: schemaObject('primaryKey', 'user_pkey', 'user'),
      },
      {
        id: 'unique.user.user_email_key',
        operationClass: 'additive',
        details: schemaObject('unique', 'user_email_key', 'user'),
      },
      {
        id: 'foreignKey.user.user_org_fk',
        operationClass: 'additive',
        details: schemaObject('foreignKey', 'user_org_fk', 'user'),
      },
      {
        id: 'dropConstraint.user.user_email_key',
        operationClass: 'destructive',
        details: schemaObject('unique', 'user_email_key', 'user'),
      },
      {
        id: 'index.user.user_email_idx',
        operationClass: 'additive',
        details: schemaObject('index', 'user_email_idx', 'user'),
      },
      {
        id: 'dropIndex.user.stale_idx',
        operationClass: 'destructive',
        details: schemaObject('index', 'stale_idx', 'user'),
      },
      { id: 'type.status', operationClass: 'additive', details: schemaObject('type', 'status') },
      {
        id: 'type.status.addValues',
        operationClass: 'additive',
        details: schemaObject('type', 'status'),
      },
      {
        id: 'type.status.drop',
        operationClass: 'destructive',
        details: schemaObject('type', 'status'),
      },
      {
        id: 'type.status_old.rename',
        operationClass: 'destructive',
        details: schemaObject('type', 'status_old'),
      },
      { id: 'custom.op.1', operationClass: 'additive', details: undefined },
      { id: 'extension.citext', operationClass: 'additive', details: undefined },
      { id: 'schema.app', operationClass: 'additive', details: undefined },
    ];

    expect(ops).toHaveLength(expectations.length);
    for (const [i, expected] of expectations.entries()) {
      const op = ops[i];
      expect(op, `ops[${i}]`).toMatchObject({
        id: expected.id,
        operationClass: expected.operationClass,
        target: {
          id: 'postgres',
          ...ifDefined('details', expected.details),
        },
      });
    }
  });

  it('RawSqlCall returns its stored op verbatim', () => {
    const op = {
      id: 'raw.identity',
      label: 'raw identity',
      operationClass: 'widening' as const,
      target: {
        id: 'postgres' as const,
        details: { schema: 'x', objectType: 'table' as const, name: 't' },
      },
      precheck: [],
      execute: [{ description: 'do', sql: 'SELECT 1' }],
      postcheck: [],
      meta: { note: 'roundtrip' },
    };

    const [rendered] = renderOps([new RawSqlCall(op)]);

    expect(rendered).toBe(op);
  });

  it('throws PN-MIG-2001 on DataTransformCall (always an unfilled stub at plan time)', () => {
    const call = new DataTransformCall('Backfill', 'check', 'run');

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

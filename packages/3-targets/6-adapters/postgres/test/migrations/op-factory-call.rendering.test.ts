/**
 * TypeScript-rendering coverage for the Postgres migration IR call classes:
 *
 * - Each `*Call` emits the expected TypeScript expression and the
 *   `importRequirements()` it depends on.
 * - `DataTransformCall` renders its body as `() => placeholder("slot")`
 *   closures around the authored slot names.
 * - `renderCallsToTypeScript` deduplicates + sorts imports across a mixed
 *   call list and embeds the supplied from/to hashes in `describe()`.
 *
 * Construction + per-class `toOp()` lowering are covered in
 * op-factory-call.construction.test.ts; multi-call op lowering and the
 * `TypeScriptRenderablePostgresMigration` wrapper are covered in
 * op-factory-call.lowering.test.ts.
 */

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
} from '@prisma-next/target-postgres/op-factory-call';
import { renderCallsToTypeScript } from '@prisma-next/target-postgres/render-typescript';
import { describe, expect, it } from 'vitest';

const META = { from: 'sha256:from', to: 'sha256:to' } as const;

describe('Postgres call classes - renderTypeScript + importRequirements', () => {
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

  it('DataTransformCall renders slots as placeholder closures and imports placeholder + endContract', () => {
    const call = new DataTransformCall('Backfill', 'check', 'run');

    expect(call.renderTypeScript()).toBe(
      [
        'this.dataTransform(endContract, "Backfill", {',
        '  check: () => placeholder("check"),',
        '  run: () => placeholder("run"),',
        '})',
      ].join('\n'),
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'placeholder' },
      {
        moduleSpecifier: './end-contract.json',
        symbol: 'endContract',
        kind: 'default',
        attributes: { type: 'json' },
      },
    ]);
  });
});

describe('Postgres call classes - per-class renderTypeScript coverage', () => {
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
    expect(uq.renderTypeScript()).toBe('addUnique("public", "user", "user_email_key", ["email"])');
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

    // `Migration` is now re-exported from the target's migration entrypoint, so
    // it gets merged into the same aggregated import line as the per-factory
    // imports (see `buildImportClause` in `@prisma-next/ts-render`). Asserted
    // as an exact-length array so a stray duplicate import line fails here.
    const targetPostgresImports = source
      .split('\n')
      .filter((line) => line.includes("from '@prisma-next/target-postgres/migration';"));
    expect(targetPostgresImports).toEqual([
      "import { Migration, MigrationCLI, addColumn, createIndex, createTable, dropTable } from '@prisma-next/target-postgres/migration';",
    ]);
    // Each call appears once in the operations body.
    expect(source).toContain('createTable(');
    expect(source).toContain('dropTable(');
    expect(source).toContain('addColumn(');
    expect(source).toContain('createIndex(');
  });

  it('emits DataTransformCall slots as placeholder closures and contributes placeholder + endContract imports', () => {
    const calls = [new DataTransformCall('Backfill user emails', 'check-emails', 'run-emails')];

    const source = renderCallsToTypeScript(calls, META);

    // `placeholder` is merged with the base `Migration` import (also owned
    // by the target's migration entrypoint) into a single aggregated line.
    // `dataTransform` is no longer imported as a free factory: it is called
    // as `this.dataTransform(...)` so `PostgresMigration` can inject the
    // control adapter.
    expect(source).toContain(
      "import { Migration, MigrationCLI, placeholder } from '@prisma-next/target-postgres/migration';",
    );
    expect(source).toContain(
      'import endContract from \'./end-contract.json\' with { type: "json" };',
    );
    expect(source).toContain(
      [
        '      this.dataTransform(endContract, "Backfill user emails", {',
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
    expect(source).toContain('export default class M extends Migration {');
    expect(source).toContain(
      "import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';",
    );
    expect(source).toContain('MigrationCLI.run(import.meta.url, M);');
  });
});

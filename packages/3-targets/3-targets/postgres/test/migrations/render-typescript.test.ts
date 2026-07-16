import { StorageColumn } from '@prisma-next/sql-contract/types';
import {
  checkExpression,
  col,
  fn,
  foreignKey,
  lit,
  primaryKey,
  unique,
} from '@prisma-next/sql-relational-core/contract-free';
import { TsExpression } from '@prisma-next/ts-render';
import { describe, expect, it } from 'vitest';
import * as opFactoryCalls from '../../src/core/migrations/op-factory-call';
import {
  AddCheckConstraintCall,
  AddColumnCall,
  AddForeignKeyCall,
  AddNativeEnumValueCall,
  AddNotNullColumnDirectCall,
  AddNotNullColumnWithTempDefaultCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreateNativeEnumTypeCall,
  CreatePostgresRlsPolicyCall,
  CreateSchemaCall,
  CreateTableCall,
  DataTransformCall,
  DisableRowLevelSecurityCall,
  DropCheckConstraintCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropNotNullCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RawSqlCall,
  RenamePostgresRlsPolicyCall,
  SetDefaultCall,
  SetNotNullCall,
} from '../../src/core/migrations/op-factory-call';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import * as migrationFacade from '../../src/exports/migration';

const renderTypeScript = (
  calls: Parameters<typeof renderCallsToTypeScript>[0],
  meta: Parameters<typeof renderCallsToTypeScript>[1],
) => renderCallsToTypeScript(calls, meta);

describe('renderCallsToTypeScript (postgres)', () => {
  it('emits contract-JSON imports + fields and Migration<Start, End> header (with-start)', () => {
    const output = renderTypeScript([new CreateSchemaCall('app')], {
      from: 'sha256:aaa',
      to: 'sha256:bbb',
    });

    expect(output).toContain(
      "import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';",
    );
    expect(output).toContain(
      'import endContract from \'./end-contract.json\' with { type: "json" };',
    );
    expect(output).toContain(
      'import startContract from \'./start-contract.json\' with { type: "json" };',
    );
    expect(output).toContain("import type { Contract as End } from './end-contract';");
    expect(output).toContain("import type { Contract as Start } from './start-contract';");
    expect(output).toContain('export default class M extends Migration<Start, End> {');
    expect(output).toContain('override readonly startContractJson = startContract;');
    expect(output).toContain('override readonly endContractJson = endContract;');
    expect(output).toContain('override get operations()');
    expect(output).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('does NOT emit a describe() method (the base derives it from the contract JSON)', () => {
    const output = renderTypeScript([new DropTableCall('public', 'stale')], {
      from: 'sha256:aaa',
      to: 'sha256:bbb',
    });

    expect(output).not.toContain('describe()');
    expect(output).not.toContain('sha256:aaa');
    expect(output).not.toContain('sha256:bbb');
  });

  it('renders the baseline shape for from: null (no start imports, Migration<never, End>)', () => {
    const output = renderTypeScript([new CreateSchemaCall('app')], {
      from: null,
      to: 'sha256:bbb',
    });

    expect(output).toContain('export default class M extends Migration<never, End> {');
    expect(output).toContain('override readonly endContractJson = endContract;');
    expect(output).toContain(
      'import endContract from \'./end-contract.json\' with { type: "json" };',
    );
    expect(output).toContain("import type { Contract as End } from './end-contract';");
    expect(output).not.toContain('start-contract');
    expect(output).not.toContain('startContractJson');
    expect(output).not.toContain('describe()');
  });

  it('inlines the operation calls unchanged', () => {
    const output = renderTypeScript([new CreateSchemaCall('app')], {
      from: null,
      to: 'sha256:bbb',
    });
    expect(output).toContain('this.createSchema({ schema: "app" })');
  });
});

describe('renderCallsToTypeScript (postgres) — facade import surface', () => {
  const policy = new PostgresRlsPolicy({
    name: 'p_ab12cd34',
    prefix: 'p',
    tableName: 'note',
    namespaceId: 'public',
    operation: 'select',
    roles: ['authenticated'],
    using: '(owner_id = auth.uid())',
    permissive: true,
  });

  const rawOp = {
    id: 'raw.custom.1',
    label: 'raw custom 1',
    operationClass: 'additive' as const,
    target: { id: 'postgres' as const },
    precheck: [],
    execute: [{ description: 'do thing', sql: 'SELECT 1' }],
    postcheck: [],
  };

  const storageColumn = new StorageColumn({
    nativeType: 'text',
    codecId: 'pg/text@1',
    nullable: false,
  });

  const oneCallPerClass = [
    new CreateTableCall(
      'public',
      'note',
      [
        col('id', 'text', { notNull: true, default: fn('gen_random_uuid()') }),
        col('kind', 'text', { default: lit('draft') }),
        col('owner_id', 'uuid'),
      ],
      [
        primaryKey(['id']),
        foreignKey(['owner_id'], 'user', ['id']),
        unique(['kind']),
        checkExpression('note_kind_check', "kind in ('draft', 'published')"),
      ],
    ),
    new DropTableCall('public', 'stale'),
    new AddColumnCall('public', 'note', col('nickname', 'text')),
    new DropColumnCall('public', 'note', 'nickname'),
    new AlterColumnTypeCall('public', 'note', 'kind', {
      qualifiedTargetType: 'text',
      formatTypeExpected: 'text',
      rawTargetTypeForLabel: 'text',
    }),
    new SetNotNullCall('public', 'note', 'kind'),
    new DropNotNullCall('public', 'note', 'kind'),
    new SetDefaultCall('public', 'note', 'kind', "'draft'"),
    new DropDefaultCall('public', 'note', 'kind'),
    new AddNotNullColumnDirectCall('public', 'note', 'title', col('title', 'text')),
    new AddNotNullColumnWithTempDefaultCall({
      schemaName: 'public',
      tableName: 'note',
      columnName: 'title',
      column: storageColumn,
      codecHooks: new Map(),
      storageTypes: {},
      temporaryDefault: "''",
    }),
    new AddPrimaryKeyCall('public', 'note', 'note_pkey', ['id']),
    new AddForeignKeyCall('public', 'note', {
      name: 'note_owner_fkey',
      columns: ['owner_id'],
      references: { schema: 'auth', table: 'users', columns: ['id'] },
    }),
    new AddUniqueCall('public', 'note', 'note_kind_key', ['kind']),
    new AddCheckConstraintCall('public', 'note', 'note_kind_check', 'kind', ['draft']),
    new DropCheckConstraintCall('public', 'note', 'note_kind_check'),
    new CreateIndexCall('public', 'note', 'note_kind_idx', ['kind']),
    new DropIndexCall('public', 'note', 'note_kind_idx'),
    new DropConstraintCall('public', 'note', 'note_kind_key'),
    new RawSqlCall(rawOp),
    new CreateExtensionCall('citext'),
    new CreateSchemaCall('app'),
    new CreateNativeEnumTypeCall('public', 'mood', ['happy']),
    new DropNativeEnumTypeCall('public', 'mood'),
    new AddNativeEnumValueCall('public', 'mood', 'grumpy'),
    new EnableRowLevelSecurityCall('public', 'note'),
    new CreatePostgresRlsPolicyCall('public', 'note', policy),
    new RenamePostgresRlsPolicyCall('public', 'note', 'p_old', 'p_new'),
    new DropPostgresRlsPolicyCall('public', 'note', 'p_stale'),
    new DisableRowLevelSecurityCall('public', 'note'),
    new DataTransformCall('backfill titles', 'check slot', 'run slot'),
  ];

  it('the fixture list covers every op-factory-call class (a new class must be added here)', () => {
    const moduleMembers: unknown[] = Object.values(opFactoryCalls);
    const allCallClasses = moduleMembers.filter(
      (value): value is abstract new () => TsExpression =>
        typeof value === 'function' && value.prototype instanceof TsExpression,
    );
    const covered = new Set(oneCallPerClass.map((call) => call.constructor));
    const missing = allCallClasses.filter((cls) => !covered.has(cls)).map((cls) => cls.name);
    expect(missing).toEqual([]);
  });

  it('every symbol a rendered migration imports from the facade is actually exported by it', () => {
    const output = renderTypeScript(oneCallPerClass, { from: 'sha256:aaa', to: 'sha256:bbb' });

    const facadeImport = output.match(
      /import\s*\{([\s\S]*?)\}\s*from\s*'@prisma-next\/postgres\/migration';/,
    );
    expect(facadeImport).not.toBeNull();
    const importedNames = (facadeImport?.[1] ?? '')
      .split(',')
      .map((entry) =>
        entry
          .trim()
          .replace(/^type\s+/, '')
          .replace(/\s+as\s+.*$/, ''),
      )
      .filter((name) => name.length > 0);
    expect(importedNames.length).toBeGreaterThan(2);

    for (const name of importedNames) {
      expect(
        Object.hasOwn(migrationFacade, name),
        `@prisma-next/postgres/migration must export "${name}" — the renderer emits an import for it in generated migration.ts files`,
      ).toBe(true);
    }
  });

  it('RLS ops render as migration methods, not free-function calls', () => {
    const output = renderTypeScript(
      [
        new EnableRowLevelSecurityCall('public', 'note'),
        new CreatePostgresRlsPolicyCall('public', 'note', policy),
        new RenamePostgresRlsPolicyCall('public', 'note', 'p_old', 'p_new'),
        new DropPostgresRlsPolicyCall('public', 'note', 'p_stale'),
        new DisableRowLevelSecurityCall('public', 'note'),
      ],
      { from: null, to: 'sha256:bbb' },
    );

    expect(output).toContain('this.enableRowLevelSecurity({ schema: "public", table: "note" })');
    expect(output).toContain('this.createRlsPolicy({ schema: "public", table: "note", policy: {');
    expect(output).toContain(
      'this.renameRlsPolicy({ schema: "public", table: "note", from: "p_old", to: "p_new" })',
    );
    expect(output).toContain(
      'this.dropRlsPolicy({ schema: "public", table: "note", policy: "p_stale" })',
    );
    expect(output).toContain('this.disableRowLevelSecurity({ schema: "public", table: "note" })');
  });
});

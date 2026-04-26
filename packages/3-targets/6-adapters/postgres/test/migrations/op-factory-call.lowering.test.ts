/**
 * Op-lowering coverage for the Postgres migration IR call classes:
 *
 * - `renderOps` lowers each variant via its pure factory and pins the
 *   id/operationClass/target.details shape exposed to runners.
 * - `RawSqlCall` is returned verbatim by `renderOps`.
 * - `DataTransformCall` always throws PN-MIG-2001 from `renderOps` because
 *   the planner can only emit unfilled stubs.
 * - `TypeScriptRenderablePostgresMigration` routes `operations` through
 *   `renderOps` and `renderTypeScript()` through `renderCallsToTypeScript`.
 *
 * Construction-side checks live in op-factory-call.construction.test.ts;
 * TypeScript rendering of individual calls and the `renderCallsToTypeScript`
 * aggregator are covered in op-factory-call.rendering.test.ts.
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
import { TypeScriptRenderablePostgresMigration } from '@prisma-next/target-postgres/planner-produced-postgres-migration';
import { renderOps } from '@prisma-next/target-postgres/render-ops';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';

const META = { from: 'sha256:from', to: 'sha256:to' } as const;

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
    expect(operations[0]).toMatchObject({ id: 'dropTable.stale' });
  });

  it('renders TypeScript source mirroring renderCallsToTypeScript output', () => {
    const calls = [new DropTableCall('public', 'stale')];
    const migration = new TypeScriptRenderablePostgresMigration(calls, META);

    const source = migration.renderTypeScript();
    expect(source).toContain(
      "import { Migration, dropTable } from '@prisma-next/target-postgres/migration';",
    );
    expect(source).toContain('dropTable("public", "stale")');
  });
});

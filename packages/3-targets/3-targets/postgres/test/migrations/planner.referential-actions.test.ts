import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type {
  ForeignKey,
  ReferentialAction,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

function createRefActionContract(
  onDelete?: ReferentialAction,
  onUpdate?: ReferentialAction,
): SqlContract<SqlStorage> {
  const fk: ForeignKey = {
    columns: ['userId'],
    references: { table: 'user', columns: ['id'] },
    constraint: true,
    index: true,
    ...(onDelete !== undefined && { onDelete }),
    ...(onUpdate !== undefined && { onUpdate }),
  };

  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:contract'),
    profileHash: profileHash('sha256:profile'),
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            userId: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [fk],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

const emptySchema: SqlSchemaIR = {
  tables: {},
  extensions: [],
};

function planAndGetFkSql(onDelete?: ReferentialAction, onUpdate?: ReferentialAction): string {
  const planner = createPostgresMigrationPlanner();
  const contract = createRefActionContract(onDelete, onUpdate);
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    frameworkComponents: [],
  });

  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('Expected success');

  const fkOp = result.plan.operations.find((op) => op.id.startsWith('foreignKey.'));
  expect(fkOp).toBeDefined();

  return fkOp!.execute[0]!.sql;
}

describe('PostgresMigrationPlanner - referential actions DDL', () => {
  it('emits no ON DELETE/ON UPDATE when both are undefined', () => {
    const sql = planAndGetFkSql(undefined, undefined);
    expect(sql).not.toContain('ON DELETE');
    expect(sql).not.toContain('ON UPDATE');
  });

  it('emits ON DELETE CASCADE when onDelete is cascade', () => {
    const sql = planAndGetFkSql('cascade', undefined);
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).not.toContain('ON UPDATE');
  });

  it('emits ON DELETE RESTRICT when onDelete is restrict', () => {
    const sql = planAndGetFkSql('restrict', undefined);
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('emits ON DELETE SET NULL when onDelete is setNull', () => {
    const sql = planAndGetFkSql('setNull', undefined);
    expect(sql).toContain('ON DELETE SET NULL');
  });

  it('emits ON DELETE SET DEFAULT when onDelete is setDefault', () => {
    const sql = planAndGetFkSql('setDefault', undefined);
    expect(sql).toContain('ON DELETE SET DEFAULT');
  });

  it('emits ON DELETE NO ACTION when onDelete is noAction', () => {
    const sql = planAndGetFkSql('noAction', undefined);
    expect(sql).toContain('ON DELETE NO ACTION');
  });

  it('emits ON UPDATE CASCADE when onUpdate is cascade', () => {
    const sql = planAndGetFkSql(undefined, 'cascade');
    expect(sql).not.toContain('ON DELETE');
    expect(sql).toContain('ON UPDATE CASCADE');
  });

  it('emits both clauses when both onDelete and onUpdate are specified', () => {
    const sql = planAndGetFkSql('cascade', 'cascade');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('ON UPDATE CASCADE');
  });

  it.each([
    { action: 'noAction' as const, expected: 'NO ACTION' },
    { action: 'restrict' as const, expected: 'RESTRICT' },
    { action: 'cascade' as const, expected: 'CASCADE' },
    { action: 'setNull' as const, expected: 'SET NULL' },
    { action: 'setDefault' as const, expected: 'SET DEFAULT' },
  ])('maps $action to $expected in ON DELETE clause', ({ action, expected }) => {
    const sql = planAndGetFkSql(action, undefined);
    expect(sql).toContain(`ON DELETE ${expected}`);
  });
});

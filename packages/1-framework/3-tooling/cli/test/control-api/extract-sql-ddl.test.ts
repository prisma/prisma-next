import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { extractSqlDdl } from '../../src/control-api/operations/extract-sql-ddl';

/**
 * Creates an operation with SQL execute steps (SqlMigrationPlanOperation shape).
 */
function sqlOperation(
  id: string,
  executeSteps: Array<{ description: string; sql: string }>,
): MigrationPlanOperation {
  return {
    id,
    label: `Operation ${id}`,
    operationClass: 'additive',
    // SqlMigrationPlanOperation extends MigrationPlanOperation with execute/precheck/postcheck
    execute: executeSteps,
    precheck: [],
    postcheck: [],
    target: { id: 'postgres' },
  } as unknown as MigrationPlanOperation;
}

describe('extractSqlDdl', () => {
  it('extracts CREATE statements from operations', () => {
    const ops = [
      sqlOperation('table.users', [
        { description: 'create users table', sql: 'CREATE TABLE "public"."users" (id uuid)' },
      ]),
    ];
    const result = extractSqlDdl(ops);

    expect(result).toEqual(['CREATE TABLE "public"."users" (id uuid)']);
  });

  it('extracts ALTER and DROP statements', () => {
    const ops = [
      sqlOperation('alter.col', [
        { description: 'alter column', sql: 'ALTER TABLE "public"."users" ADD COLUMN name text' },
      ]),
      sqlOperation('drop.table', [
        { description: 'drop table', sql: 'DROP TABLE "public"."legacy"' },
      ]),
    ];
    const result = extractSqlDdl(ops);

    expect(result).toHaveLength(2);
    expect(result[0]).toContain('ALTER TABLE');
    expect(result[1]).toContain('DROP TABLE');
  });

  it('skips non-DDL statements', () => {
    const ops = [
      sqlOperation('marker.write', [
        { description: 'write marker', sql: 'INSERT INTO _prisma_marker VALUES ($1)' },
      ]),
    ];
    const result = extractSqlDdl(ops);

    expect(result).toEqual([]);
  });

  it('skips operations without execute steps (base MigrationPlanOperation)', () => {
    const baseOp: MigrationPlanOperation = {
      id: 'base.op',
      label: 'Base operation',
      operationClass: 'additive',
    };
    const result = extractSqlDdl([baseOp]);

    expect(result).toEqual([]);
  });

  it('returns empty array for empty operations list', () => {
    expect(extractSqlDdl([])).toEqual([]);
  });
});

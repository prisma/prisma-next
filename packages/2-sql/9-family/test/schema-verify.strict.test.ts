import { describe, expect, it } from 'vitest';
import { collectSqlSchemaIssues } from '../src/core/diff/sql-schema-diff';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
} from './schema-verify.helpers';

describe('collectSqlSchemaIssues - strict mode', () => {
  it('detects extra tables in schema when strict is true', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      extra_table: createSchemaTable('extra_table', {
        id: { nativeType: 'int4', nullable: false },
      }),
    });

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: true,
      frameworkComponents: [],
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'extra_table',
        table: 'extra_table',
      }),
    );
  });

  it('detects extra columns in schema when strict is true', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
        extra_column: { nativeType: 'text', nullable: true },
      }),
    });

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: true,
      frameworkComponents: [],
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'extra_column',
        table: 'user',
        column: 'extra_column',
      }),
    );
  });

  it('detects extra foreign keys when contract has no FKs for the table', () => {
    const contract = createTestContract({
      parent: createContractTable({
        id: { nativeType: 'int4', nullable: false },
      }),
      child: createContractTable({
        id: { nativeType: 'int4', nullable: false },
        parent_id: { nativeType: 'int4', nullable: false },
      }),
    });

    const schema = createTestSchemaIR({
      parent: createSchemaTable('parent', {
        id: { nativeType: 'int4', nullable: false },
      }),
      child: createSchemaTable(
        'child',
        {
          id: { nativeType: 'int4', nullable: false },
          parent_id: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['parent_id'],
              referencedTable: 'parent',
              referencedColumns: ['id'],
              name: 'child_parent_id_fkey',
            },
          ],
        },
      ),
    });

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: true,
      frameworkComponents: [],
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'extra_foreign_key',
        table: 'child',
        indexOrConstraint: 'child_parent_id_fkey',
      }),
    );
  });
});

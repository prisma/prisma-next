import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import type {
  SqliteColumnSpec,
  SqliteTableSpec,
} from '../../src/core/migrations/operations/shared';
import { buildRecreatePostchecks } from '../../src/core/migrations/operations/tables';

function colSpec(overrides: Partial<SqliteColumnSpec> = {}): SqliteColumnSpec {
  return {
    name: 'col',
    typeSql: 'TEXT',
    defaultSql: '',
    nullable: true,
    ...overrides,
  };
}

function tableSpec(overrides: Partial<SqliteTableSpec> = {}): SqliteTableSpec {
  return {
    columns: [colSpec()],
    ...overrides,
  };
}

describe('buildRecreatePostchecks - constraint coverage', () => {
  it('emits a primary-key shape postcheck when a primary_key_mismatch fires', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'a' }), colSpec({ name: 'b' }), colSpec({ name: 'c' })],
      primaryKey: { columns: ['a', 'b'] },
    });
    const issues: SchemaIssue[] = [
      {
        kind: 'primary_key_mismatch',
        table: 'users',
        expected: 'a, b',
        actual: 'a',
        message: 'pk mismatch',
      },
    ];

    const checks = buildRecreatePostchecks('users', issues, spec);
    const pkCheck = checks.find((c) => c.description.includes('primary key'));
    expect(pkCheck).toBeDefined();
    expect(pkCheck!.sql).toContain("pragma_table_info('users')");
    expect(pkCheck!.sql).toContain('pk > 0');
    expect(pkCheck!.sql).toContain("'a', 'b'");
    expect(pkCheck!.sql).toContain('= 2');
  });

  it('detects an inline autoincrement primary key as the expected PK', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'id', inlineAutoincrementPrimaryKey: true })],
    });
    const issues: SchemaIssue[] = [
      { kind: 'primary_key_mismatch', table: 't', expected: 'id', message: 'pk' },
    ];
    const checks = buildRecreatePostchecks('t', issues, spec);
    const pkCheck = checks.find((c) => c.description.includes('primary key'));
    expect(pkCheck).toBeDefined();
    expect(pkCheck!.sql).toContain("'id'");
  });

  it('emits a "no primary key" postcheck when extra_primary_key fires and the spec has none', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'x' })] });
    const issues: SchemaIssue[] = [
      { kind: 'extra_primary_key', table: 't', actual: 'x', message: 'extra pk' },
    ];
    const checks = buildRecreatePostchecks('t', issues, spec);
    const pkCheck = checks.find((c) => c.description.includes('no primary key'));
    expect(pkCheck).toBeDefined();
    expect(pkCheck!.sql).toContain('pk > 0) = 0');
  });

  it('emits one unique postcheck per declared unique when a unique_constraint_mismatch fires', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'email' }), colSpec({ name: 'tenant' })],
      uniques: [{ columns: ['email'] }, { columns: ['tenant', 'email'], name: 'tenant_email' }],
    });
    const issues: SchemaIssue[] = [
      {
        kind: 'unique_constraint_mismatch',
        table: 'users',
        expected: 'email',
        message: 'unique mismatch',
      },
    ];

    const checks = buildRecreatePostchecks('users', issues, spec);
    const uniqueChecks = checks.filter((c) => c.description.includes('unique constraint'));
    expect(uniqueChecks).toHaveLength(2);
    expect(uniqueChecks[0]!.sql).toContain("pragma_index_list('users')");
    expect(uniqueChecks[0]!.sql).toContain('l."unique" = 1');
    expect(uniqueChecks[0]!.sql).toContain("name IN ('email')");
    expect(uniqueChecks[1]!.description).toContain('"tenant_email"');
    expect(uniqueChecks[1]!.sql).toContain("name IN ('tenant', 'email')");
  });

  it('emits one foreign-key postcheck per declared FK when foreign_key_mismatch fires', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'user_id' }), colSpec({ name: 'tenant_id' })],
      foreignKeys: [
        {
          columns: ['user_id'],
          references: { table: 'users', columns: ['id'] },
          constraint: true,
        },
        {
          columns: ['tenant_id', 'user_id'],
          references: { table: 'memberships', columns: ['tenant_id', 'user_id'] },
          constraint: true,
        },
      ],
    });
    const issues: SchemaIssue[] = [
      {
        kind: 'foreign_key_mismatch',
        table: 'posts',
        expected: 'user_id -> users(id)',
        message: 'fk',
      },
    ];

    const checks = buildRecreatePostchecks('posts', issues, spec);
    const fkChecks = checks.filter((c) => c.description.includes('foreign key'));
    expect(fkChecks).toHaveLength(2);

    expect(fkChecks[0]!.sql).toContain("pragma_foreign_key_list('posts')");
    expect(fkChecks[0]!.sql).toContain('f."table" = \'users\'');
    expect(fkChecks[0]!.sql).toContain("('user_id', 'id')");
    expect(fkChecks[0]!.sql).toContain('HAVING COUNT(*) = 1');

    // Multi-column FK keeps both tuples and the matching count
    expect(fkChecks[1]!.sql).toContain("('tenant_id', 'tenant_id'), ('user_id', 'user_id')");
    expect(fkChecks[1]!.sql).toContain('HAVING COUNT(*) = 2');
  });

  it('does not emit constraint postchecks when only column-level issues are present', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'a' })],
      primaryKey: { columns: ['a'] },
      uniques: [{ columns: ['a'] }],
      foreignKeys: [
        { columns: ['a'], references: { table: 'x', columns: ['id'] }, constraint: true },
      ],
    });
    const issues: SchemaIssue[] = [
      {
        kind: 'type_mismatch',
        table: 't',
        column: 'a',
        expected: 'TEXT',
        actual: 'INTEGER',
        message: 'type',
      },
    ];

    const checks = buildRecreatePostchecks('t', issues, spec);
    expect(checks.some((c) => c.description.includes('primary key'))).toBe(false);
    expect(checks.some((c) => c.description.includes('unique constraint'))).toBe(false);
    expect(checks.some((c) => c.description.includes('foreign key'))).toBe(false);
  });
});

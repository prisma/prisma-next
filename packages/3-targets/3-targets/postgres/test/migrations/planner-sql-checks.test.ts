import { describe, expect, it } from 'vitest';
import {
  columnExistsCheck,
  columnHasNoDefaultCheck,
  columnNullabilityCheck,
  constraintExistsCheck,
  qualifyTableName,
  tableHasPrimaryKeyCheck,
  tableIsEmptyCheck,
  toRegclassLiteral,
} from '../../src/core/migrations/planner-sql-checks';

describe('qualifyTableName', () => {
  it('quotes schema and table', () => {
    expect(qualifyTableName('public', 'user')).toBe('"public"."user"');
  });
});

describe('toRegclassLiteral', () => {
  it('produces an escaped regclass literal', () => {
    expect(toRegclassLiteral('public', 'user')).toBe(`'"public"."user"'`);
  });
});

describe('constraintExistsCheck', () => {
  it('defaults to EXISTS', () => {
    const sql = constraintExistsCheck({ constraintName: 'user_pkey', schema: 'public' });
    expect(sql).toContain('SELECT EXISTS');
    expect(sql).toContain("c.conname = 'user_pkey'");
    expect(sql).toContain("n.nspname = 'public'");
  });

  it('uses NOT EXISTS when exists=false', () => {
    const sql = constraintExistsCheck({
      constraintName: 'user_pkey',
      schema: 'public',
      exists: false,
    });
    expect(sql).toContain('SELECT NOT EXISTS');
  });
});

describe('columnExistsCheck', () => {
  it('defaults to EXISTS', () => {
    const sql = columnExistsCheck({ schema: 'public', table: 'user', column: 'email' });
    expect(sql).toContain('SELECT EXISTS');
    expect(sql).toContain("table_schema = 'public'");
    expect(sql).toContain("table_name = 'user'");
    expect(sql).toContain("column_name = 'email'");
  });

  it('uses NOT EXISTS when exists=false', () => {
    const sql = columnExistsCheck({
      schema: 'public',
      table: 'user',
      column: 'email',
      exists: false,
    });
    expect(sql).toContain('SELECT NOT EXISTS');
  });
});

describe('columnNullabilityCheck', () => {
  it('checks for NOT NULL', () => {
    const sql = columnNullabilityCheck({
      schema: 'public',
      table: 'user',
      column: 'email',
      nullable: false,
    });
    expect(sql).toContain("is_nullable = 'NO'");
  });

  it('checks for nullable', () => {
    const sql = columnNullabilityCheck({
      schema: 'public',
      table: 'user',
      column: 'bio',
      nullable: true,
    });
    expect(sql).toContain("is_nullable = 'YES'");
  });
});

describe('tableIsEmptyCheck', () => {
  it('produces NOT EXISTS with LIMIT 1', () => {
    expect(tableIsEmptyCheck('"public"."user"')).toBe(
      'SELECT NOT EXISTS (SELECT 1 FROM "public"."user" LIMIT 1)',
    );
  });
});

describe('columnHasNoDefaultCheck', () => {
  it('checks column_default IS NOT NULL', () => {
    const sql = columnHasNoDefaultCheck({ schema: 'public', table: 'user', column: 'name' });
    expect(sql).toContain('SELECT NOT EXISTS');
    expect(sql).toContain('column_default IS NOT NULL');
    expect(sql).toContain("column_name = 'name'");
  });
});

describe('tableHasPrimaryKeyCheck', () => {
  it('checks PK exists without constraint name', () => {
    const sql = tableHasPrimaryKeyCheck('public', 'user', true);
    expect(sql).toContain('SELECT EXISTS');
    expect(sql).toContain("n.nspname = 'public'");
    expect(sql).toContain("c.relname = 'user'");
    expect(sql).toContain('i.indisprimary');
    expect(sql).not.toContain('c2.relname');
  });

  it('checks PK does not exist', () => {
    const sql = tableHasPrimaryKeyCheck('public', 'user', false);
    expect(sql).toContain('SELECT NOT EXISTS');
  });

  it('filters by constraint name when provided', () => {
    const sql = tableHasPrimaryKeyCheck('public', 'user', true, 'user_pkey');
    expect(sql).toContain("c2.relname = 'user_pkey'");
  });
});

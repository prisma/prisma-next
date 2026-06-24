import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import {
  buildColumnDefaultSql,
  buildColumnTypeSql,
  renderDefaultLiteral,
} from '@prisma-next/target-postgres/planner-ddl-builders';
import { describe, expect, it } from 'vitest';

const noHooks = new Map<string, CodecControlHooks>();

function col(overrides: Partial<StorageColumn> & { nativeType: string }): StorageColumn {
  return { codecId: 'pg/text@1', nullable: true, ...overrides };
}

// ---------------------------------------------------------------------------
// buildColumnTypeSql
// ---------------------------------------------------------------------------

describe('buildColumnTypeSql', () => {
  it('returns native type for plain columns', () => {
    expect(buildColumnTypeSql(col({ nativeType: 'text' }), noHooks)).toBe('text');
  });

  it('returns SERIAL for int4 with autoincrement', () => {
    const column = col({
      nativeType: 'int4',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('SERIAL');
  });

  it('returns BIGSERIAL for int8 with autoincrement', () => {
    const column = col({
      nativeType: 'int8',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('BIGSERIAL');
  });

  it('returns SMALLSERIAL for int2 with autoincrement', () => {
    const column = col({
      nativeType: 'int2',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('SMALLSERIAL');
  });

  it('quotes type name for typeRef columns', () => {
    const column = col({ nativeType: 'my_enum', typeRef: 'my_enum' });
    expect(buildColumnTypeSql(column, noHooks)).toBe('"my_enum"');
  });

  it('rejects unsafe native type names', () => {
    expect(() => buildColumnTypeSql(col({ nativeType: 'text; DROP TABLE' }), noHooks)).toThrow(
      'Unsafe native type',
    );
  });

  it('uses expandNativeType hook for parameterized types', () => {
    const hooks = new Map<string, CodecControlHooks>([
      [
        'pg/vector@1',
        {
          expandNativeType: ({ nativeType, typeParams }) =>
            `${nativeType}(${typeParams?.['length']})`,
        },
      ],
    ]);
    const column = col({
      nativeType: 'vector',
      codecId: 'pg/vector@1',
      typeParams: { length: 3 },
    });
    expect(buildColumnTypeSql(column, hooks)).toBe('vector(3)');
  });
});

// ---------------------------------------------------------------------------
// buildColumnDefaultSql
// ---------------------------------------------------------------------------

describe('buildColumnDefaultSql', () => {
  it('returns empty string for undefined default', () => {
    expect(buildColumnDefaultSql(undefined)).toBe('');
  });

  it('renders literal string default', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: 'hello' })).toBe("DEFAULT 'hello'");
  });

  it('renders literal number default', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: 42 })).toBe('DEFAULT 42');
  });

  it('renders literal boolean default', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: true })).toBe('DEFAULT true');
  });

  it('returns empty string for autoincrement function', () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'autoincrement()' })).toBe('');
  });

  it('renders non-autoincrement function default', () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'now()' })).toBe(
      'DEFAULT (now())',
    );
  });

  it('renders sequence default', () => {
    expect(buildColumnDefaultSql({ kind: 'sequence', name: 'user_id_seq' })).toBe(
      `DEFAULT nextval('"user_id_seq"'::regclass)`,
    );
  });

  it('rejects unsafe function expressions', () => {
    expect(() =>
      buildColumnDefaultSql({ kind: 'function', expression: 'now(); DROP TABLE users' }),
    ).toThrow('Unsafe default expression');
  });
});

// ---------------------------------------------------------------------------
// renderDefaultLiteral
// ---------------------------------------------------------------------------

describe('renderDefaultLiteral', () => {
  it('renders string', () => {
    expect(renderDefaultLiteral('hello')).toBe("'hello'");
  });

  it('renders number', () => {
    expect(renderDefaultLiteral(42)).toBe('42');
  });

  it('renders boolean', () => {
    expect(renderDefaultLiteral(false)).toBe('false');
  });

  it('renders null', () => {
    expect(renderDefaultLiteral(null)).toBe('NULL');
  });

  it('renders JSON object for jsonb column', () => {
    const result = renderDefaultLiteral({ key: 'val' }, col({ nativeType: 'jsonb' }));
    expect(result).toBe(`'{"key":"val"}'::jsonb`);
  });

  it('renders JSON object without cast for non-json column', () => {
    const result = renderDefaultLiteral({ key: 'val' });
    expect(result).toBe(`'{"key":"val"}'`);
  });
});

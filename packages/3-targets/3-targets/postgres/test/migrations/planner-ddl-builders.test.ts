import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { ForeignKey, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  buildAddColumnSql,
  buildColumnDefaultSql,
  buildColumnTypeSql,
  buildCreateTableSql,
  buildForeignKeySql,
  renderDefaultLiteral,
} from '../../src/core/migrations/planner-ddl-builders';

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
      'DEFAULT nextval("user_id_seq"::regclass)',
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

  it('renders bigint', () => {
    expect(renderDefaultLiteral(123n)).toBe('123');
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

// ---------------------------------------------------------------------------
// buildAddColumnSql
// ---------------------------------------------------------------------------

describe('buildAddColumnSql', () => {
  it('builds basic ADD COLUMN', () => {
    const sql = buildAddColumnSql('"public"."user"', 'email', col({ nativeType: 'text' }), noHooks);
    expect(sql).toBe('ALTER TABLE "public"."user" ADD COLUMN "email" text');
  });

  it('includes NOT NULL for non-nullable columns', () => {
    const sql = buildAddColumnSql(
      '"public"."user"',
      'email',
      col({ nativeType: 'text', nullable: false }),
      noHooks,
    );
    expect(sql).toContain('NOT NULL');
  });

  it('includes temporary default when provided', () => {
    const sql = buildAddColumnSql(
      '"public"."user"',
      'name',
      col({ nativeType: 'text', nullable: false }),
      noHooks,
      "''",
    );
    expect(sql).toContain("DEFAULT ''");
    expect(sql).toContain('NOT NULL');
  });

  it('prefers column default over temporary default', () => {
    const sql = buildAddColumnSql(
      '"public"."user"',
      'active',
      col({
        nativeType: 'bool',
        nullable: false,
        default: { kind: 'literal', value: true },
      }),
      noHooks,
      'false',
    );
    expect(sql).toContain('DEFAULT true');
    expect(sql).not.toContain('DEFAULT false');
  });
});

// ---------------------------------------------------------------------------
// buildCreateTableSql
// ---------------------------------------------------------------------------

describe('buildCreateTableSql', () => {
  it('builds CREATE TABLE with columns and primary key', () => {
    const table: StorageTable = {
      columns: {
        id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      foreignKeys: [],
      indexes: [],
    };
    const sql = buildCreateTableSql('"public"."user"', table, noHooks);
    expect(sql).toContain('CREATE TABLE "public"."user"');
    expect(sql).toContain('"id" int4 NOT NULL');
    expect(sql).toContain('"name" text');
    expect(sql).toContain('PRIMARY KEY ("id")');
  });

  it('omits PRIMARY KEY when not defined', () => {
    const table: StorageTable = {
      columns: {
        value: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
      },
      primaryKey: undefined,
      uniques: [],
      foreignKeys: [],
      indexes: [],
    };
    const sql = buildCreateTableSql('"public"."kv"', table, noHooks);
    expect(sql).not.toContain('PRIMARY KEY');
  });
});

// ---------------------------------------------------------------------------
// buildForeignKeySql
// ---------------------------------------------------------------------------

describe('buildForeignKeySql', () => {
  const baseFk: ForeignKey = {
    columns: ['author_id'],
    references: { table: 'user', columns: ['id'] },
    constraint: true,
    index: true,
  };

  it('builds basic FK without referential actions', () => {
    const sql = buildForeignKeySql('public', 'post', 'post_author_id_fkey', baseFk);
    expect(sql).toContain('ALTER TABLE "public"."post"');
    expect(sql).toContain('ADD CONSTRAINT "post_author_id_fkey"');
    expect(sql).toContain('FOREIGN KEY ("author_id")');
    expect(sql).toContain('REFERENCES "public"."user" ("id")');
    expect(sql).not.toContain('ON DELETE');
    expect(sql).not.toContain('ON UPDATE');
  });

  it.each([
    ['cascade', 'CASCADE'],
    ['restrict', 'RESTRICT'],
    ['noAction', 'NO ACTION'],
    ['setNull', 'SET NULL'],
    ['setDefault', 'SET DEFAULT'],
  ] as const)('renders ON DELETE %s', (action, expected) => {
    const fk: ForeignKey = { ...baseFk, onDelete: action };
    const sql = buildForeignKeySql('public', 'post', 'fk', fk);
    expect(sql).toContain(`ON DELETE ${expected}`);
  });

  it.each([
    ['cascade', 'CASCADE'],
    ['restrict', 'RESTRICT'],
    ['noAction', 'NO ACTION'],
    ['setNull', 'SET NULL'],
    ['setDefault', 'SET DEFAULT'],
  ] as const)('renders ON UPDATE %s', (action, expected) => {
    const fk: ForeignKey = { ...baseFk, onUpdate: action };
    const sql = buildForeignKeySql('public', 'post', 'fk', fk);
    expect(sql).toContain(`ON UPDATE ${expected}`);
  });

  it('renders both ON DELETE and ON UPDATE', () => {
    const fk: ForeignKey = { ...baseFk, onDelete: 'cascade', onUpdate: 'restrict' };
    const sql = buildForeignKeySql('public', 'post', 'fk', fk);
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('ON UPDATE RESTRICT');
  });
});

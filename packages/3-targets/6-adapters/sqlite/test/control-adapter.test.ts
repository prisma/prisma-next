import { DatabaseSync } from 'node:sqlite';
import { parseSqliteDefault } from '@prisma-next/target-sqlite/default-normalizer';
import { normalizeSqliteNativeType } from '@prisma-next/target-sqlite/native-type-normalizer';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';

function createMemoryDriver() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as Array<string | number | null>)) as Row[];
      return { rows };
    },
    async close() {
      db.close();
    },
    db,
  };
}

describe('SqliteControlAdapter.introspect', () => {
  it('introspects empty database', async () => {
    const driver = createMemoryDriver();
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);
    expect(schema.tables).toEqual({});
    expect(schema.dependencies).toEqual([]);
    await driver.close();
  });

  it('introspects table with columns', async () => {
    const driver = createMemoryDriver();
    driver.db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT)');
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    expect(Object.keys(schema.tables)).toEqual(['users']);
    const users = schema.tables['users']!;
    expect(users.columns['id']!.nativeType).toBe('integer');
    expect(users.columns['name']!.nullable).toBe(false);
    expect(users.columns['bio']!.nullable).toBe(true);
    expect(users.primaryKey).toEqual({ columns: ['id'] });
    await driver.close();
  });

  it('introspects composite primary key', async () => {
    const driver = createMemoryDriver();
    driver.db.exec('CREATE TABLE kv (ns TEXT, key TEXT, val TEXT, PRIMARY KEY (ns, key))');
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    expect(schema.tables['kv']!.primaryKey).toEqual({ columns: ['ns', 'key'] });
    await driver.close();
  });

  it('introspects foreign keys', async () => {
    const driver = createMemoryDriver();
    driver.db.exec('CREATE TABLE authors (id INTEGER PRIMARY KEY)');
    driver.db.exec(
      'CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE)',
    );
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    const fks = schema.tables['posts']!.foreignKeys;
    expect(fks).toHaveLength(1);
    expect(fks[0]!.columns).toEqual(['author_id']);
    expect(fks[0]!.referencedTable).toBe('authors');
    expect(fks[0]!.referencedColumns).toEqual(['id']);
    expect(fks[0]!.onDelete).toBe('cascade');
    await driver.close();
  });

  it('introspects indexes', async () => {
    const driver = createMemoryDriver();
    driver.db.exec('CREATE TABLE t (a TEXT, b TEXT)');
    driver.db.exec('CREATE INDEX idx_t_a ON t (a)');
    driver.db.exec('CREATE UNIQUE INDEX idx_t_b ON t (b)');
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    const indexes = schema.tables['t']!.indexes;
    expect(indexes).toHaveLength(2);
    const idxA = indexes.find((i) => i.name === 'idx_t_a');
    expect(idxA!.columns).toEqual(['a']);
    expect(idxA!.unique).toBe(false);
    const idxB = indexes.find((i) => i.name === 'idx_t_b');
    expect(idxB!.columns).toEqual(['b']);
    expect(idxB!.unique).toBe(true);
    await driver.close();
  });

  it('introspects unique constraints', async () => {
    const driver = createMemoryDriver();
    driver.db.exec('CREATE TABLE t (a TEXT, b TEXT, UNIQUE (a, b))');
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    const uniques = schema.tables['t']!.uniques;
    expect(uniques).toHaveLength(1);
    expect(uniques[0]!.columns).toEqual(['a', 'b']);
    await driver.close();
  });

  it('excludes sqlite_ internal tables', async () => {
    const driver = createMemoryDriver();
    driver.db.exec('CREATE TABLE user_data (id INTEGER PRIMARY KEY)');
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    expect(Object.keys(schema.tables)).toEqual(['user_data']);
    await driver.close();
  });

  it('introspects column defaults', async () => {
    const driver = createMemoryDriver();
    driver.db.exec(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT DEFAULT 'anon', active INTEGER DEFAULT 1)",
    );
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    expect(schema.tables['t']!.columns['name']!.default).toBe("'anon'");
    expect(schema.tables['t']!.columns['active']!.default).toBe('1');
    await driver.close();
  });
});

describe('parseSqliteDefault', () => {
  it('normalizes CURRENT_TIMESTAMP to now()', () => {
    expect(parseSqliteDefault('CURRENT_TIMESTAMP')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it("normalizes datetime('now') to now()", () => {
    expect(parseSqliteDefault("(datetime('now'))")).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('preserves CURRENT_DATE distinctly', () => {
    expect(parseSqliteDefault('CURRENT_DATE')).toEqual({
      kind: 'function',
      expression: 'CURRENT_DATE',
    });
  });

  it('preserves CURRENT_TIME distinctly', () => {
    expect(parseSqliteDefault('CURRENT_TIME')).toEqual({
      kind: 'function',
      expression: 'CURRENT_TIME',
    });
  });

  it('parses NULL default', () => {
    expect(parseSqliteDefault('NULL')).toEqual({ kind: 'literal', value: null });
  });

  it('returns string for integer nativeType', () => {
    expect(parseSqliteDefault('42', 'integer')).toEqual({ kind: 'literal', value: '42' });
    expect(parseSqliteDefault('0', 'integer')).toEqual({ kind: 'literal', value: '0' });
    const big = '9999999999999999999';
    expect(parseSqliteDefault(big, 'integer')).toEqual({ kind: 'literal', value: big });
  });

  it('returns number for real nativeType', () => {
    expect(parseSqliteDefault('3.14', 'real')).toEqual({ kind: 'literal', value: 3.14 });
    expect(parseSqliteDefault('0xFF', 'real')).toEqual({ kind: 'literal', value: 255 });
    expect(parseSqliteDefault('1.5e3', 'real')).toEqual({ kind: 'literal', value: 1500 });
  });

  it('returns number when nativeType is unknown', () => {
    expect(parseSqliteDefault('42')).toEqual({ kind: 'literal', value: 42 });
  });

  it('parses string literal default', () => {
    expect(parseSqliteDefault("'hello'")).toEqual({ kind: 'literal', value: 'hello' });
  });

  it('preserves unrecognized expressions as function', () => {
    expect(parseSqliteDefault('abs(-5)')).toEqual({ kind: 'function', expression: 'abs(-5)' });
  });

  it('strips outer parentheses', () => {
    expect(parseSqliteDefault('(42)')).toEqual({ kind: 'literal', value: 42 });
  });
});

describe('normalizeSqliteNativeType', () => {
  it('lowercases type names', () => {
    expect(normalizeSqliteNativeType('INTEGER')).toBe('integer');
    expect(normalizeSqliteNativeType('TEXT')).toBe('text');
    expect(normalizeSqliteNativeType('  REAL  ')).toBe('real');
  });
});

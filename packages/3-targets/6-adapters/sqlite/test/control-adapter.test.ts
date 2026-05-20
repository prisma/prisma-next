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
      kind: 'expression',
      expression: 'now()',
    });
  });

  it("normalizes datetime('now') to now()", () => {
    expect(parseSqliteDefault("(datetime('now'))")).toEqual({
      kind: 'expression',
      expression: 'now()',
    });
  });

  it('preserves CURRENT_DATE as expression', () => {
    expect(parseSqliteDefault('CURRENT_DATE')).toEqual({
      kind: 'expression',
      expression: 'CURRENT_DATE',
    });
  });

  it('preserves CURRENT_TIME as expression', () => {
    expect(parseSqliteDefault('CURRENT_TIME')).toEqual({
      kind: 'expression',
      expression: 'CURRENT_TIME',
    });
  });

  it('parses NULL default as expression', () => {
    expect(parseSqliteDefault('NULL')).toEqual({ kind: 'expression', expression: 'NULL' });
  });

  it('parses numeric default as expression', () => {
    expect(parseSqliteDefault('42')).toEqual({ kind: 'expression', expression: '42' });
    expect(parseSqliteDefault('0')).toEqual({ kind: 'expression', expression: '0' });
    expect(parseSqliteDefault('3.14')).toEqual({ kind: 'expression', expression: '3.14' });
  });

  it('parses string literal default as expression', () => {
    expect(parseSqliteDefault("'hello'")).toEqual({
      kind: 'expression',
      expression: "'hello'",
    });
  });

  it('preserves unrecognized expressions', () => {
    expect(parseSqliteDefault('abs(-5)')).toEqual({ kind: 'expression', expression: 'abs(-5)' });
  });

  it('strips outer parentheses', () => {
    expect(parseSqliteDefault('(42)')).toEqual({ kind: 'expression', expression: '42' });
  });
});

describe('normalizeSqliteNativeType', () => {
  it('lowercases type names', () => {
    expect(normalizeSqliteNativeType('INTEGER')).toBe('integer');
    expect(normalizeSqliteNativeType('TEXT')).toBe('text');
    expect(normalizeSqliteNativeType('  REAL  ')).toBe('real');
  });
});

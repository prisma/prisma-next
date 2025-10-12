import { describe, it, expect } from 'vitest';
import { sql, makeT, compileToSQL, type Tables, TABLE_NAME } from '../src/index';
import type { Column, FieldExpression } from '../src/types';

interface UserShape {
  id: number;
  email: string;
  active: boolean;
  createdAt: Date;
}

interface TestTables extends Tables {
  user: {
    [TABLE_NAME]: string;
    id: Column<number>;
    email: Column<string>;
    active: Column<boolean>;
    createdAt: Column<Date>;
  };
}

const mockSchema = {
  target: 'postgres',
  tables: {
    user: {
      columns: {
        id: { type: 'int4', nullable: false, pk: true, default: { kind: 'autoincrement' } },
        email: { type: 'text', nullable: false, unique: true },
        active: { type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } },
        createdAt: { type: 'timestamptz', nullable: false, default: { kind: 'now' } },
      },
      indexes: [],
      constraints: [],
      capabilities: [],
    },
  },
};

const t = makeT<TestTables>(mockSchema);

describe('SQL Query Builder', () => {
  it('builds a simple SELECT query with Column objects', () => {
    const query = sql().from(t.user).select({ id: t.user.id, email: t.user.email });

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe('SELECT id AS id, email AS email FROM user');
    expect(params).toHaveLength(0);
  });

  it('builds a query with WHERE clause using Column expressions', () => {
    const query = sql().from(t.user).where(t.user.active.eq(true));

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe('SELECT * FROM user WHERE active = $1');
    expect(params).toEqual([true]);
  });

  it('builds a query with ORDER BY and LIMIT', () => {
    const query = sql().from(t.user).orderBy('createdAt', 'DESC').limit(10);

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe('SELECT * FROM user ORDER BY createdAt DESC LIMIT $1');
    expect(params).toEqual([10]);
  });

  it('builds a complex query with Column objects', () => {
    const query = sql()
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('createdAt', 'DESC')
      .limit(5);

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe(
      'SELECT id AS id, email AS email FROM user WHERE active = $1 ORDER BY createdAt DESC LIMIT $2',
    );
    expect(params).toEqual([true, 5]);
  });

  it('handles IN expressions with Column objects', () => {
    const query = sql()
      .from(t.user)
      .where(t.user.id.in([1, 2, 3]));

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe('SELECT * FROM user WHERE id IN ($1, $2, $3)');
    expect(params).toEqual([1, 2, 3]);
  });

  it('handles multiple comparison operators', () => {
    const queries = [
      sql().from(t.user).where(t.user.id.gt(5)),
      sql().from(t.user).where(t.user.id.lt(10)),
      sql().from(t.user).where(t.user.id.gte(1)),
      sql().from(t.user).where(t.user.id.lte(100)),
      sql().from(t.user).where(t.user.email.ne('test@example.com')),
    ];

    const expectedSQLs = [
      'SELECT * FROM user WHERE id > $1',
      'SELECT * FROM user WHERE id < $1',
      'SELECT * FROM user WHERE id >= $1',
      'SELECT * FROM user WHERE id <= $1',
      'SELECT * FROM user WHERE email != $1',
    ];

    queries.forEach((query, index) => {
      const { sql: generatedSQL, params } = query.build();
      expect(generatedSQL).toBe(expectedSQLs[index]);
      expect(params).toHaveLength(1);
    });
  });

  it('handles queries with all column types', () => {
    const query = sql().from(t.user).select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
      createdAt: t.user.createdAt,
    });

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe(
      'SELECT id AS id, email AS email, active AS active, "createdAt" AS "createdAt" FROM user',
    );
    expect(params).toHaveLength(0);
  });

  it('handles boolean values in WHERE clauses', () => {
    const query = sql().from(t.user).where(t.user.active.eq(false));

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe('SELECT * FROM user WHERE active = $1');
    expect(params).toEqual([false]);
  });

  it('handles string values with special characters', () => {
    const query = sql().from(t.user).where(t.user.email.eq('test@example.com'));

    const { sql: generatedSQL, params } = query.build();

    expect(generatedSQL).toBe('SELECT * FROM user WHERE email = $1');
    expect(params).toEqual(['test@example.com']);
  });
});

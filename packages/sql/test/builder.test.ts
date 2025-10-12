import { describe, it, expect } from 'vitest';
import { sql, compileToSQL, t } from '../src/index';

describe('SQL Query Builder', () => {
  it('builds a simple SELECT query with Column objects', () => {
    const query = sql()
      .from('user')
      .select({ id: t.user.id, email: t.user.email });

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe('SELECT id AS id, email AS email FROM user');
    expect(params).toHaveLength(0);
  });

  it('builds a query with WHERE clause using Column expressions', () => {
    const query = sql()
      .from('user')
      .where(t.user.active.eq(true));

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe('SELECT * FROM user WHERE active = $1');
    expect(params).toEqual([true]);
  });

  it('builds a query with ORDER BY and LIMIT', () => {
    const query = sql()
      .from('user')
      .orderBy('createdAt', 'DESC')
      .limit(10);

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe('SELECT * FROM user ORDER BY createdAt DESC LIMIT 10');
    expect(params).toHaveLength(0);
  });

  it('builds a complex query with Column objects', () => {
    const query = sql()
      .from('user')
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('createdAt', 'DESC')
      .limit(5);

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe(
      'SELECT id AS id, email AS email FROM user WHERE active = $1 ORDER BY createdAt DESC LIMIT 5',
    );
    expect(params).toEqual([true]);
  });

  it('handles IN expressions with Column objects', () => {
    const query = sql()
      .from('user')
      .where(t.user.id.in([1, 2, 3]));

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe('SELECT * FROM user WHERE id IN ($1, $2, $3)');
    expect(params).toEqual([1, 2, 3]);
  });

  it('handles multiple comparison operators', () => {
    const queries = [
      sql().from('user').where(t.user.id.gt(5)),
      sql().from('user').where(t.user.id.lt(10)),
      sql().from('user').where(t.user.id.gte(1)),
      sql().from('user').where(t.user.id.lte(100)),
      sql().from('user').where(t.user.email.ne('test@example.com')),
    ];

    const expectedSQLs = [
      'SELECT * FROM user WHERE id > $1',
      'SELECT * FROM user WHERE id < $1',
      'SELECT * FROM user WHERE id >= $1',
      'SELECT * FROM user WHERE id <= $1',
      'SELECT * FROM user WHERE email != $1',
    ];

    queries.forEach((query, index) => {
      const { sql: generatedSQL, params } = compileToSQL(query.build());
      expect(generatedSQL).toBe(expectedSQLs[index]);
      expect(params).toHaveLength(1);
    });
  });
});

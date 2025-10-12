import { describe, it, expect } from 'vitest';
import { sql, compileToSQL } from '../src/index';

describe('SQL Query Builder', () => {
  it('should build a simple SELECT query', () => {
    const query = sql().from('user').select({ id: 'id', email: 'email' });

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe('SELECT id AS id, email AS email FROM user');
    expect(params).toHaveLength(0);
  });

  it('should build a query with WHERE clause', () => {
    const query = sql().from('user').where({ type: 'eq', field: 'active', value: true });

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe('SELECT * FROM user WHERE active = $1');
    expect(params).toEqual([true]);
  });

  it('should build a query with ORDER BY and LIMIT', () => {
    const query = sql().from('user').orderBy('createdAt', 'DESC').limit(10);

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe('SELECT * FROM user ORDER BY createdAt DESC LIMIT 10');
    expect(params).toHaveLength(0);
  });

  it('should build a complex query', () => {
    const query = sql()
      .from('user')
      .where({ type: 'eq', field: 'active', value: true })
      .select({ id: 'id', email: 'email' })
      .orderBy('createdAt', 'DESC')
      .limit(5);

    const { sql: generatedSQL, params } = compileToSQL(query.build());

    expect(generatedSQL).toBe(
      'SELECT id AS id, email AS email FROM user WHERE active = $1 ORDER BY createdAt DESC LIMIT 5',
    );
    expect(params).toEqual([true]);
  });
});

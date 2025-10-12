import { describe, it, expect } from 'vitest';
import { sql, makeT, type Tables } from '../src/index';

// Define the expected Tables type for our test schema
interface TestTables extends Tables {
  user: {
    name: string;
    id: { table: string; name: string; eq: (v: any) => any; ne: (v: any) => any; gt: (v: any) => any; lt: (v: any) => any; gte: (v: any) => any; lte: (v: any) => any; in: (v: any[]) => any; };
    email: { table: string; name: string; eq: (v: any) => any; ne: (v: any) => any; gt: (v: any) => any; lt: (v: any) => any; gte: (v: any) => any; lte: (v: any) => any; in: (v: any[]) => any; };
    active: { table: string; name: string; eq: (v: any) => any; ne: (v: any) => any; gt: (v: any) => any; lt: (v: any) => any; gte: (v: any) => any; lte: (v: any) => any; in: (v: any[]) => any; };
    createdAt: { table: string; name: string; eq: (v: any) => any; ne: (v: any) => any; gt: (v: any) => any; lt: (v: any) => any; gte: (v: any) => any; lte: (v: any) => any; in: (v: any[]) => any; };
  };
}

// Create a mock schema for testing
const mockSchema = {
  models: [
    {
      name: 'User',
      fields: [
        { name: 'id', type: 'Int', attributes: [{ name: 'id' }] },
        { name: 'email', type: 'String', attributes: [{ name: 'unique' }] },
        { name: 'active', type: 'Boolean', attributes: [{ name: 'default', value: { type: 'literal', value: 'true' } }] },
        { name: 'createdAt', type: 'DateTime', attributes: [{ name: 'default', value: { type: 'now' } }] }
      ]
    }
  ]
};

// Create typed tables for testing
const t = makeT<TestTables>(mockSchema);

describe('SQL Query Builder', () => {
  it('builds a simple SELECT query with Column objects', () => {
    const query = sql()
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email });

    const result = query.build();

    expect(result.sql).toBe('SELECT id AS id, email AS email FROM user');
    expect(result.params).toHaveLength(0);
  });

  it('builds a query with WHERE clause using Column expressions', () => {
    const query = sql()
      .from(t.user)
      .where(t.user.active.eq(true));

    const result = query.build();

    expect(result.sql).toBe('SELECT * FROM user WHERE active = $1');
    expect(result.params).toEqual([true]);
  });

  it('builds a query with ORDER BY and LIMIT', () => {
    const query = sql()
      .from(t.user)
      .orderBy('createdAt', 'DESC')
      .limit(10);

    const result = query.build();

    expect(result.sql).toBe('SELECT * FROM user ORDER BY createdAt DESC LIMIT 10');
    expect(result.params).toHaveLength(0);
  });

  it('builds a complex query with Column objects', () => {
    const query = sql()
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('createdAt', 'DESC')
      .limit(5);

    const result = query.build();

    expect(result.sql).toBe(
      'SELECT id AS id, email AS email FROM user WHERE active = $1 ORDER BY createdAt DESC LIMIT 5',
    );
    expect(result.params).toEqual([true]);
  });

  it('handles IN expressions with Column objects', () => {
    const query = sql()
      .from(t.user)
      .where(t.user.id.in([1, 2, 3]));

    const result = query.build();

    expect(result.sql).toBe('SELECT * FROM user WHERE id IN ($1, $2, $3)');
    expect(result.params).toEqual([1, 2, 3]);
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
      const result = query.build();
      expect(result.sql).toBe(expectedSQLs[index]);
      expect(result.params).toHaveLength(1);
    });
  });
});

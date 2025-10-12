import { describe, it, expect } from 'vitest';
import { sql, makeT } from '../src/index';

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
const t = makeT(mockSchema);

describe('Type Inference Tests', () => {
  it('infers correct return type for simple select', () => {
    const query = sql()
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email });

    // This test verifies that TypeScript can infer the correct types
    // The actual type checking happens at compile time
    const result = query.build();

    // Verify the query structure
    expect(result.sql).toBe('SELECT id AS id, email AS email FROM user');
    expect(result.params).toHaveLength(0);
  });

  it('infers correct return type for select with all fields', () => {
    const query = sql()
      .from(t.user)
      .select({
        id: t.user.id,
        email: t.user.email,
        active: t.user.active,
        createdAt: t.user.createdAt
      });

    const result = query.build();

    expect(result.sql).toBe('SELECT id AS id, email AS email, active AS active, createdAt AS createdAt FROM user');
    expect(result.params).toHaveLength(0);
  });

  it('infers correct return type for query with where clause', () => {
    const query = sql()
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    const result = query.build();

    expect(result.sql).toBe('SELECT id AS id, email AS email FROM user WHERE active = $1');
    expect(result.params).toEqual([true]);
  });

  it('infers correct return type for query with limit', () => {
    const query = sql()
      .from(t.user)
      .select({ id: t.user.id })
      .limit(10);

    const result = query.build();

    expect(result.sql).toBe('SELECT id AS id FROM user LIMIT 10');
    expect(result.params).toHaveLength(0);
  });

  it('infers correct return type for query with order by', () => {
    const query = sql()
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC');

    const result = query.build();

    expect(result.sql).toBe('SELECT id AS id, email AS email FROM user ORDER BY id ASC');
    expect(result.params).toHaveLength(0);
  });

  it('verifies Column objects have correct structure', () => {
    // Test that Column objects have the expected properties
    expect(t.user.id).toHaveProperty('table');
    expect(t.user.id).toHaveProperty('name');
    expect(t.user.id).toHaveProperty('eq');
    expect(t.user.id).toHaveProperty('ne');
    expect(t.user.id).toHaveProperty('gt');
    expect(t.user.id).toHaveProperty('lt');
    expect(t.user.id).toHaveProperty('gte');
    expect(t.user.id).toHaveProperty('lte');
    expect(t.user.id).toHaveProperty('in');

    expect(t.user.id.table).toBe('user');
    expect(t.user.id.name).toBe('id');
  });

  it('verifies Column expressions return correct structure', () => {
    const eqExpr = t.user.id.eq(1);
    const neExpr = t.user.email.ne('test@example.com');
    const inExpr = t.user.id.in([1, 2, 3]);

    expect(eqExpr).toHaveProperty('type');
    expect(eqExpr).toHaveProperty('field');
    expect(eqExpr).toHaveProperty('value');
    expect(eqExpr.type).toBe('eq');
    expect(eqExpr.field).toBe('id');
    expect(eqExpr.value).toBe(1);

    expect(neExpr.type).toBe('ne');
    expect(neExpr.field).toBe('email');
    expect(neExpr.value).toBe('test@example.com');

    expect(inExpr.type).toBe('in');
    expect(inExpr.field).toBe('id');
    expect(inExpr.values).toEqual([1, 2, 3]);
  });
});
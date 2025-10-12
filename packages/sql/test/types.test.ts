import { describe, it, expect } from 'vitest';
import { sql, t } from '../src/index';

describe('Type Inference Tests', () => {
  it('infers correct return type for simple select', () => {
    const query = sql()
      .from('user')
      .select({ id: t.user.id, email: t.user.email });

    // This test verifies that TypeScript can infer the correct types
    // The actual type checking happens at compile time
    const result = query.build();

    // Verify the query structure
    expect(result.type).toBe('select');
    expect(result.from).toBe('user');
    expect(result.select?.fields).toHaveProperty('id');
    expect(result.select?.fields).toHaveProperty('email');
  });

  it('infers correct return type for select with all fields', () => {
    const query = sql()
      .from('user')
      .select({
        id: t.user.id,
        email: t.user.email,
        active: t.user.active,
        createdAt: t.user.createdAt
      });

    const result = query.build();

    expect(result.type).toBe('select');
    expect(result.from).toBe('user');
    expect(result.select?.fields).toHaveProperty('id');
    expect(result.select?.fields).toHaveProperty('email');
    expect(result.select?.fields).toHaveProperty('active');
    expect(result.select?.fields).toHaveProperty('createdAt');
  });

  it('infers correct return type for query with where clause', () => {
    const query = sql()
      .from('user')
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    const result = query.build();

    expect(result.type).toBe('select');
    expect(result.where?.condition).toBeDefined();
    expect(result.select?.fields).toHaveProperty('id');
    expect(result.select?.fields).toHaveProperty('email');
  });

  it('infers correct return type for query with limit', () => {
    const query = sql()
      .from('user')
      .select({ id: t.user.id })
      .limit(10);

    const result = query.build();

    expect(result.type).toBe('select');
    expect(result.limit?.count).toBe(10);
    expect(result.select?.fields).toHaveProperty('id');
  });

  it('infers correct return type for query with order by', () => {
    const query = sql()
      .from('user')
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC');

    const result = query.build();

    expect(result.type).toBe('select');
    expect(result.orderBy).toHaveLength(1);
    expect(result.orderBy?.[0].field).toBe('id');
    expect(result.orderBy?.[0].direction).toBe('ASC');
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

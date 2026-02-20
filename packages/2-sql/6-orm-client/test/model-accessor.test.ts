import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import { createTestContract } from './helpers';

describe('createModelAccessor', () => {
  const contract = createTestContract();

  function expectBinaryExpr(
    actual: unknown,
    table: string,
    column: string,
    op: string,
    value: unknown,
  ) {
    expect(actual).toEqual({
      kind: 'bin',
      op,
      left: {
        kind: 'col',
        table,
        column,
      },
      right: {
        kind: 'literal',
        value,
      },
    });
  }

  it('creates FilterExpr with eq operator', () => {
    const accessor = createModelAccessor(contract, 'User');
    const filter = accessor['name']!.eq('Alice');
    expectBinaryExpr(filter, 'users', 'name', 'eq', 'Alice');
  });

  it('creates FilterExpr with neq operator', () => {
    const accessor = createModelAccessor(contract, 'User');
    const filter = accessor['email']!.neq('test@example.com');
    expectBinaryExpr(filter, 'users', 'email', 'neq', 'test@example.com');
  });

  it('creates FilterExpr with gt operator', () => {
    const accessor = createModelAccessor(contract, 'Post');
    const filter = accessor['views']!.gt(1000);
    expectBinaryExpr(filter, 'posts', 'views', 'gt', 1000);
  });

  it('creates FilterExpr with lt operator', () => {
    const accessor = createModelAccessor(contract, 'Post');
    const filter = accessor['views']!.lt(100);
    expectBinaryExpr(filter, 'posts', 'views', 'lt', 100);
  });

  it('creates FilterExpr with gte operator', () => {
    const accessor = createModelAccessor(contract, 'Post');
    const filter = accessor['id']!.gte(5);
    expectBinaryExpr(filter, 'posts', 'id', 'gte', 5);
  });

  it('creates FilterExpr with lte operator', () => {
    const accessor = createModelAccessor(contract, 'Post');
    const filter = accessor['id']!.lte(10);
    expectBinaryExpr(filter, 'posts', 'id', 'lte', 10);
  });

  it('maps field names to column names via fieldToColumn', () => {
    const accessor = createModelAccessor(contract, 'Post');
    const filter = accessor['userId']!.eq(42);
    expectBinaryExpr(filter, 'posts', 'user_id', 'eq', 42);
  });

  it('uses field name as column name when no mapping exists', () => {
    const accessor = createModelAccessor(contract, 'Post');
    const filter = accessor['id']!.eq(1);
    expectBinaryExpr(filter, 'posts', 'id', 'eq', 1);
  });

  it('creates like and ilike operators', () => {
    const accessor = createModelAccessor(contract, 'User');
    expectBinaryExpr(accessor['name']!.like('%Ali%'), 'users', 'name', 'like', '%Ali%');
    expectBinaryExpr(accessor['name']!.ilike('%ali%'), 'users', 'name', 'ilike', '%ali%');
  });

  it('creates listLiteral nodes for in and notIn operators', () => {
    const accessor = createModelAccessor(contract, 'Post');
    expect(accessor['id']!.in([1, 2, 3])).toEqual({
      kind: 'bin',
      op: 'in',
      left: { kind: 'col', table: 'posts', column: 'id' },
      right: {
        kind: 'listLiteral',
        values: [
          { kind: 'literal', value: 1 },
          { kind: 'literal', value: 2 },
          { kind: 'literal', value: 3 },
        ],
      },
    });
    expect(accessor['id']!.notIn([4, 5])).toEqual({
      kind: 'bin',
      op: 'notIn',
      left: { kind: 'col', table: 'posts', column: 'id' },
      right: {
        kind: 'listLiteral',
        values: [
          { kind: 'literal', value: 4 },
          { kind: 'literal', value: 5 },
        ],
      },
    });
  });

  it('creates null check expressions', () => {
    const accessor = createModelAccessor(contract, 'User');
    expect(accessor['email']!.isNull()).toEqual({
      kind: 'nullCheck',
      expr: { kind: 'col', table: 'users', column: 'email' },
      isNull: true,
    });
    expect(accessor['email']!.isNotNull()).toEqual({
      kind: 'nullCheck',
      expr: { kind: 'col', table: 'users', column: 'email' },
      isNull: false,
    });
  });

  it('creates order directives with asc and desc', () => {
    const accessor = createModelAccessor(contract, 'Post');
    expect(accessor['id']!.asc()).toEqual({ column: 'id', direction: 'asc' });
    expect(accessor['id']!.desc()).toEqual({ column: 'id', direction: 'desc' });
  });
});

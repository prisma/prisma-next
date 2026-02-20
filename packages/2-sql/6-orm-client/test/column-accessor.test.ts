import { describe, expect, it } from 'vitest';
import { createColumnAccessor } from '../src/column-accessor';
import { createTestContract } from './helpers';

describe('createColumnAccessor', () => {
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
    const accessor = createColumnAccessor(contract, 'User');
    const filter = accessor['name']!.eq('Alice');
    expectBinaryExpr(filter, 'users', 'name', 'eq', 'Alice');
  });

  it('creates FilterExpr with neq operator', () => {
    const accessor = createColumnAccessor(contract, 'User');
    const filter = accessor['email']!.neq('test@example.com');
    expectBinaryExpr(filter, 'users', 'email', 'neq', 'test@example.com');
  });

  it('creates FilterExpr with gt operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['views']!.gt(1000);
    expectBinaryExpr(filter, 'posts', 'views', 'gt', 1000);
  });

  it('creates FilterExpr with lt operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['views']!.lt(100);
    expectBinaryExpr(filter, 'posts', 'views', 'lt', 100);
  });

  it('creates FilterExpr with gte operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['id']!.gte(5);
    expectBinaryExpr(filter, 'posts', 'id', 'gte', 5);
  });

  it('creates FilterExpr with lte operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['id']!.lte(10);
    expectBinaryExpr(filter, 'posts', 'id', 'lte', 10);
  });

  it('maps field names to column names via fieldToColumn', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['userId']!.eq(42);
    expectBinaryExpr(filter, 'posts', 'user_id', 'eq', 42);
  });

  it('uses field name as column name when no mapping exists', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['id']!.eq(1);
    expectBinaryExpr(filter, 'posts', 'id', 'eq', 1);
  });
});

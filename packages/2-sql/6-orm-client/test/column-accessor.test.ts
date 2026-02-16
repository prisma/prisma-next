import { describe, expect, it } from 'vitest';
import { createColumnAccessor } from '../src/column-accessor';
import { createTestContract } from './helpers';

describe('createColumnAccessor', () => {
  const contract = createTestContract();

  it('creates FilterExpr with eq operator', () => {
    const accessor = createColumnAccessor(contract, 'User');
    const filter = accessor['name']!.eq('Alice');
    expect(filter).toEqual({ column: 'name', op: 'eq', value: 'Alice' });
  });

  it('creates FilterExpr with neq operator', () => {
    const accessor = createColumnAccessor(contract, 'User');
    const filter = accessor['email']!.neq('test@example.com');
    expect(filter).toEqual({
      column: 'email',
      op: 'neq',
      value: 'test@example.com',
    });
  });

  it('creates FilterExpr with gt operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['views']!.gt(1000);
    expect(filter).toEqual({ column: 'views', op: 'gt', value: 1000 });
  });

  it('creates FilterExpr with lt operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['views']!.lt(100);
    expect(filter).toEqual({ column: 'views', op: 'lt', value: 100 });
  });

  it('creates FilterExpr with gte operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['id']!.gte(5);
    expect(filter).toEqual({ column: 'id', op: 'gte', value: 5 });
  });

  it('creates FilterExpr with lte operator', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['id']!.lte(10);
    expect(filter).toEqual({ column: 'id', op: 'lte', value: 10 });
  });

  it('maps field names to column names via fieldToColumn', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['userId']!.eq(42);
    expect(filter).toEqual({ column: 'user_id', op: 'eq', value: 42 });
  });

  it('uses field name as column name when no mapping exists', () => {
    const accessor = createColumnAccessor(contract, 'Post');
    const filter = accessor['id']!.eq(1);
    expect(filter).toEqual({ column: 'id', op: 'eq', value: 1 });
  });
});

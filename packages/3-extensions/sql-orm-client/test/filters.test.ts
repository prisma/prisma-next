import { describe, expect, it } from 'vitest';
import { all, and, not, or, shorthandToWhereExpr } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { getTestContract } from './helpers';

describe('filters', () => {
  const contract = getTestContract();

  it('and() composes multiple expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = and(user['name']!.eq('Alice'), user['email']!.neq('bob@example.com'));

    expect(expr).toMatchObject({
      kind: 'and',
      exprs: [
        { kind: 'bin', op: 'eq' },
        { kind: 'bin', op: 'neq' },
      ],
    });
  });

  it('or() composes multiple expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = or(user['name']!.eq('Alice'), user['name']!.eq('Bob'));

    expect(expr).toMatchObject({
      kind: 'or',
      exprs: [
        { kind: 'bin', op: 'eq' },
        { kind: 'bin', op: 'eq' },
      ],
    });
  });

  it('not() negates binary expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = not(user['name']!.eq('Alice'));

    expect(expr).toMatchObject({
      kind: 'bin',
      op: 'neq',
      left: { kind: 'col', table: 'users', column: 'name' },
      right: { kind: 'literal', value: 'Alice' },
    });
  });

  it('not() toggles exists and nullCheck expressions', () => {
    const user = createModelAccessor(contract, 'User');

    const existsExpr = user['posts']!.some();
    const nullCheckExpr = user['email']!.isNull();

    expect(not(existsExpr)).toMatchObject({
      kind: 'exists',
      not: true,
    });
    expect(not(nullCheckExpr)).toMatchObject({
      kind: 'nullCheck',
      isNull: false,
    });
  });

  it('not() applies De Morgan for and/or expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = not(
      and(user['name']!.eq('Alice'), or(user['email']!.eq('a'), user['email']!.eq('b'))),
    );

    expect(expr).toMatchObject({
      kind: 'or',
      exprs: [
        { kind: 'bin', op: 'neq' },
        {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'neq' },
            { kind: 'bin', op: 'neq' },
          ],
        },
      ],
    });
  });

  it('all() returns a tautology sentinel expression', () => {
    expect(all()).toEqual({
      kind: 'and',
      exprs: [],
    });
  });

  it('negates all supported scalar binary operators', () => {
    const user = createModelAccessor(contract, 'User');

    expect(not(user['id']!.neq(1))).toMatchObject({ kind: 'bin', op: 'eq' });
    expect(not(user['id']!.lt(1))).toMatchObject({ kind: 'bin', op: 'gte' });
    expect(not(user['id']!.gte(1))).toMatchObject({ kind: 'bin', op: 'lt' });
    expect(not(user['id']!.lte(1))).toMatchObject({ kind: 'bin', op: 'gt' });
    expect(not(user['id']!.in([1, 2]))).toMatchObject({ kind: 'bin', op: 'notIn' });
    expect(not(user['id']!.notIn([1, 2]))).toMatchObject({ kind: 'bin', op: 'in' });
  });

  it('throws when negating like or ilike operators', () => {
    const user = createModelAccessor(contract, 'User');

    expect(() => not(user['name']!.like('%a%'))).toThrow(/not negatable/i);
    expect(() => not(user['name']!.ilike('%a%'))).toThrow(/not negatable/i);
  });

  it('throws for unknown where expression or operator kinds', () => {
    expect(() => not({ kind: 'unknown' } as never)).toThrow(/Unsupported where expression kind/);
    expect(() =>
      not({
        kind: 'bin',
        op: 'unknown',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: { kind: 'literal', value: 1 },
      } as never),
    ).toThrow(/Unknown binary operator/);
  });

  it('shorthandToWhereExpr() maps nulls, skips undefined, and combines multiple fields', () => {
    const expr = shorthandToWhereExpr(contract, 'Post', {
      id: 1,
      userId: null,
      views: undefined,
    });

    expect(expr).toEqual({
      kind: 'and',
      exprs: [
        {
          kind: 'bin',
          op: 'eq',
          left: { kind: 'col', table: 'posts', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
        {
          kind: 'nullCheck',
          expr: { kind: 'col', table: 'posts', column: 'user_id' },
          isNull: true,
        },
      ],
    });
  });

  it('shorthandToWhereExpr() returns undefined for empty filters and supports storage fallback', () => {
    expect(shorthandToWhereExpr(contract, 'User', {})).toBeUndefined();

    const withoutModelToTable = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {},
      },
    } as typeof contract;

    const expr = shorthandToWhereExpr(withoutModelToTable, 'User', {
      email: 'alice@example.com',
    });

    expect(expr).toEqual({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'users', column: 'email' },
      right: { kind: 'literal', value: 'alice@example.com' },
    });
  });

  it('shorthandToWhereExpr() falls back to model name and raw field names when mappings are missing', () => {
    const withoutMappings = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {},
        fieldToColumn: {},
      },
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          storage: {},
        },
      },
    } as typeof contract;

    const expr = shorthandToWhereExpr(withoutMappings, 'User', {
      unknownField: 123,
    } as never);

    expect(expr).toEqual({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'User', column: 'unknownField' },
      right: { kind: 'literal', value: 123 },
    });
  });
});

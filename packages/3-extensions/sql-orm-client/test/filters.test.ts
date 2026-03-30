import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { all, and, not, or, shorthandToWhereExpr } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { getTestContext, getTestContract } from './helpers';

describe('filters', () => {
  const contract = getTestContract();
  const context = getTestContext();

  it('and(), or(), not(), and all() use rich where objects', () => {
    const user = createModelAccessor(context, 'User');

    const andExpr = and(user['name']!.eq('Alice'), user['email']!.neq('bob@example.com'));
    expect(andExpr).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
        BinaryExpr.neq(ColumnRef.of('users', 'email'), LiteralExpr.of('bob@example.com')),
      ]),
    );

    const orExpr = or(user['name']!.eq('Alice'), user['name']!.eq('Bob'));
    expect(orExpr).toEqual(
      OrExpr.of([
        BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
        BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Bob')),
      ]),
    );

    expect(not(user['name']!.eq('Alice'))).toEqual(
      BinaryExpr.neq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    );
    expect(not(user['posts']!.some()).kind).toBe('exists');
    expect(not(user['email']!.isNull())).toEqual(
      NullCheckExpr.isNotNull(ColumnRef.of('users', 'email')),
    );
    expect(
      not(and(user['name']!.eq('Alice'), or(user['email']!.eq('a'), user['email']!.eq('b')))),
    ).toEqual(
      OrExpr.of([
        BinaryExpr.neq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
        AndExpr.of([
          BinaryExpr.neq(ColumnRef.of('users', 'email'), LiteralExpr.of('a')),
          BinaryExpr.neq(ColumnRef.of('users', 'email'), LiteralExpr.of('b')),
        ]),
      ]),
    );
    expect(all()).toEqual(AndExpr.true());
  });

  it('negates supported scalar binary operators', () => {
    const user = createModelAccessor(context, 'User');

    expect(not(user['id']!.neq(1))).toEqual(
      BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1)),
    );
    expect(not(user['id']!.lt(1))).toEqual(
      BinaryExpr.gte(ColumnRef.of('users', 'id'), LiteralExpr.of(1)),
    );
    expect(not(user['id']!.gte(1))).toEqual(
      BinaryExpr.lt(ColumnRef.of('users', 'id'), LiteralExpr.of(1)),
    );
    expect(not(user['id']!.lte(1))).toEqual(
      BinaryExpr.gt(ColumnRef.of('users', 'id'), LiteralExpr.of(1)),
    );
    expect(not(user['id']!.in([1, 2]))).toEqual(
      BinaryExpr.notIn(ColumnRef.of('users', 'id'), ListLiteralExpr.fromValues([1, 2])),
    );
    expect(not(user['id']!.notIn([1, 2]))).toEqual(
      BinaryExpr.in(ColumnRef.of('users', 'id'), ListLiteralExpr.fromValues([1, 2])),
    );
  });

  it('throws when negating like or ilike operators', () => {
    const user = createModelAccessor(context, 'User');

    expect(() => not(user['name']!.like('%a%'))).toThrow(/not negatable/i);
    expect(() => not(user['name']!.ilike('%a%'))).toThrow(/not negatable/i);
  });

  it('shorthandToWhereExpr() maps nulls, skips undefined, and combines multiple fields', () => {
    const expr = shorthandToWhereExpr(context, 'Post', {
      id: 1,
      userId: null,
      views: undefined,
    });

    expect(expr).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'id'), LiteralExpr.of(1)),
        NullCheckExpr.isNull(ColumnRef.of('posts', 'user_id')),
      ]),
    );
  });

  it('shorthandToWhereExpr() supports storage and model-name fallbacks', () => {
    expect(shorthandToWhereExpr(context, 'User', {})).toBeUndefined();

    const withoutModelToTable = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {},
      },
    } as typeof contract;

    // Table resolves via modelToTable fallback; isNull is always available
    expect(
      shorthandToWhereExpr({ ...context, contract: withoutModelToTable } as never, 'User', {
        email: 'alice@example.com',
      }),
    ).toEqual(BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('alice@example.com')));

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

    // Table resolves to model name; field has no codec → fail-closed → no eq
    // isNull is still available (traits: [])
    expect(
      shorthandToWhereExpr({ ...context, contract: withoutMappings } as never, 'User', {
        unknownField: null,
      } as never),
    ).toEqual(NullCheckExpr.isNull(ColumnRef.of('User', 'unknownField')));
  });
});

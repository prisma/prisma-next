import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ListExpression,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  OrExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { all, and, not, or, shorthandToWhereExpr } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { getTestContext, getTestContract } from './helpers';

describe('filters', () => {
  const contract = getTestContract();
  const context = getTestContext();

  function paramRef(table: string, column: string, value: unknown): ParamRef {
    const tables = context.contract.storage.tables as Record<
      string,
      { columns: Record<string, { codecId?: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? ParamRef.of(value, { codecId }) : ParamRef.of(value);
  }

  it('and(), or(), not(), and all() use rich where objects', () => {
    const user = createModelAccessor(context, 'User');

    const andExpr = and(user['name']!.eq('Alice'), user['email']!.neq('bob@example.com'));
    expect(andExpr).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice')),
        BinaryExpr.neq(
          ColumnRef.of('users', 'email'),
          paramRef('users', 'email', 'bob@example.com'),
        ),
      ]),
    );

    const orExpr = or(user['name']!.eq('Alice'), user['name']!.eq('Bob'));
    expect(orExpr).toEqual(
      OrExpr.of([
        BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice')),
        BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Bob')),
      ]),
    );

    expect(not(user['name']!.eq('Alice'))).toEqual(
      new NotExpr(BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice'))),
    );
    expect(not(user['posts']!.some()).kind).toBe('not');
    expect(not(user['email']!.isNull())).toEqual(
      new NotExpr(NullCheckExpr.isNull(ColumnRef.of('users', 'email'))),
    );
    expect(
      not(and(user['name']!.eq('Alice'), or(user['email']!.eq('a'), user['email']!.eq('b')))),
    ).toEqual(
      new NotExpr(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice')),
          OrExpr.of([
            BinaryExpr.eq(ColumnRef.of('users', 'email'), paramRef('users', 'email', 'a')),
            BinaryExpr.eq(ColumnRef.of('users', 'email'), paramRef('users', 'email', 'b')),
          ]),
        ]),
      ),
    );
    expect(all()).toEqual(AndExpr.true());
  });

  it('wraps scalar binary operators in NotExpr', () => {
    const user = createModelAccessor(context, 'User');

    expect(not(user['id']!.neq(1))).toEqual(
      new NotExpr(BinaryExpr.neq(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.lt(1))).toEqual(
      new NotExpr(BinaryExpr.lt(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.gte(1))).toEqual(
      new NotExpr(BinaryExpr.gte(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.lte(1))).toEqual(
      new NotExpr(BinaryExpr.lte(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.in([1, 2]))).toEqual(
      new NotExpr(
        BinaryExpr.in(
          ColumnRef.of('users', 'id'),
          ListExpression.of([paramRef('users', 'id', 1), paramRef('users', 'id', 2)]),
        ),
      ),
    );
    expect(not(user['id']!.notIn([1, 2]))).toEqual(
      new NotExpr(
        BinaryExpr.notIn(
          ColumnRef.of('users', 'id'),
          ListExpression.of([paramRef('users', 'id', 1), paramRef('users', 'id', 2)]),
        ),
      ),
    );
  });

  it('wraps like and ilike in NotExpr', () => {
    const user = createModelAccessor(context, 'User');

    expect(not(user['name']!.like('%a%'))).toEqual(
      new NotExpr(BinaryExpr.like(ColumnRef.of('users', 'name'), paramRef('users', 'name', '%a%'))),
    );
    expect(not(user['name']!.ilike('%a%'))).toEqual(
      new NotExpr(
        BinaryExpr.ilike(ColumnRef.of('users', 'name'), paramRef('users', 'name', '%a%')),
      ),
    );
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

    expect(
      shorthandToWhereExpr(context, 'User', {
        email: 'alice@example.com',
      }),
    ).toEqual(BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('alice@example.com')));

    const withoutStorageFields = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          fields: {},
          storage: { table: 'users' },
        },
      },
    } as typeof contract;

    expect(
      shorthandToWhereExpr({ ...context, contract: withoutStorageFields } as never, 'User', {
        unknownField: null,
      } as never),
    ).toEqual(NullCheckExpr.isNull(ColumnRef.of('users', 'unknownField')));
  });
});

import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ListExpression,
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

  it('and(), or(), not(), and all() use rich where objects', () => {
    const user = createModelAccessor(context, 'User');

    const andExpr = and(user['name']!.eq('Alice'), user['email']!.neq('bob@example.com'));
    expect(andExpr).toEqual(
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('users', 'name'),
          ParamRef.of('Alice', { name: 'name', codecId: 'pg/text@1' }),
        ),
        BinaryExpr.neq(
          ColumnRef.of('users', 'email'),
          ParamRef.of('bob@example.com', { name: 'email', codecId: 'pg/text@1' }),
        ),
      ]),
    );

    const orExpr = or(user['name']!.eq('Alice'), user['name']!.eq('Bob'));
    expect(orExpr).toEqual(
      OrExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('users', 'name'),
          ParamRef.of('Alice', { name: 'name', codecId: 'pg/text@1' }),
        ),
        BinaryExpr.eq(
          ColumnRef.of('users', 'name'),
          ParamRef.of('Bob', { name: 'name', codecId: 'pg/text@1' }),
        ),
      ]),
    );

    expect(not(user['name']!.eq('Alice'))).toEqual(
      new NotExpr(
        BinaryExpr.eq(
          ColumnRef.of('users', 'name'),
          ParamRef.of('Alice', { name: 'name', codecId: 'pg/text@1' }),
        ),
      ),
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
          BinaryExpr.eq(
            ColumnRef.of('users', 'name'),
            ParamRef.of('Alice', { name: 'name', codecId: 'pg/text@1' }),
          ),
          OrExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('users', 'email'),
              ParamRef.of('a', { name: 'email', codecId: 'pg/text@1' }),
            ),
            BinaryExpr.eq(
              ColumnRef.of('users', 'email'),
              ParamRef.of('b', { name: 'email', codecId: 'pg/text@1' }),
            ),
          ]),
        ]),
      ),
    );
    expect(all()).toEqual(AndExpr.true());
  });

  it('wraps scalar binary operators in NotExpr', () => {
    const user = createModelAccessor(context, 'User');

    expect(not(user['id']!.neq(1))).toEqual(
      new NotExpr(
        BinaryExpr.neq(
          ColumnRef.of('users', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      ),
    );
    expect(not(user['id']!.lt(1))).toEqual(
      new NotExpr(
        BinaryExpr.lt(
          ColumnRef.of('users', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      ),
    );
    expect(not(user['id']!.gte(1))).toEqual(
      new NotExpr(
        BinaryExpr.gte(
          ColumnRef.of('users', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      ),
    );
    expect(not(user['id']!.lte(1))).toEqual(
      new NotExpr(
        BinaryExpr.lte(
          ColumnRef.of('users', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      ),
    );
    expect(not(user['id']!.in([1, 2]))).toEqual(
      new NotExpr(
        BinaryExpr.in(
          ColumnRef.of('users', 'id'),
          ListExpression.of([
            ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
            ParamRef.of(2, { name: 'id', codecId: 'pg/int4@1' }),
          ]),
        ),
      ),
    );
    expect(not(user['id']!.notIn([1, 2]))).toEqual(
      new NotExpr(
        BinaryExpr.notIn(
          ColumnRef.of('users', 'id'),
          ListExpression.of([
            ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
            ParamRef.of(2, { name: 'id', codecId: 'pg/int4@1' }),
          ]),
        ),
      ),
    );
  });

  it('wraps like and ilike in NotExpr', () => {
    const user = createModelAccessor(context, 'User');

    expect(not(user['name']!.like('%a%'))).toEqual(
      new NotExpr(
        BinaryExpr.like(
          ColumnRef.of('users', 'name'),
          ParamRef.of('%a%', { name: 'name', codecId: 'pg/text@1' }),
        ),
      ),
    );
    expect(not(user['name']!.ilike('%a%'))).toEqual(
      new NotExpr(
        BinaryExpr.ilike(
          ColumnRef.of('users', 'name'),
          ParamRef.of('%a%', { name: 'name', codecId: 'pg/text@1' }),
        ),
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
        BinaryExpr.eq(
          ColumnRef.of('posts', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
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
    ).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('users', 'email'),
        ParamRef.of('alice@example.com', { name: 'email', codecId: 'pg/text@1' }),
      ),
    );

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

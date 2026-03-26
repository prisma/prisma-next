import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  ParamRef,
  SelectAst,
  TableSource,
  type WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { all, and, not, or } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { normalizeWhereArg } from '../src/where-interop';
import { combineWhereFilters, createBoundWhereExpr } from '../src/where-utils';
import { getTestContract } from './helpers';

function collectParamValues(expr: WhereExpr): unknown[] {
  return expr.fold<unknown[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    paramRef: (param) => [param.value],
    listLiteral: (list) =>
      list.values.flatMap((value) => (value instanceof ParamRef ? [value.value] : [])),
  });
}

describe('SQL ORM rich AST filters', () => {
  const contract = getTestContract();

  it('builds scalar and relation filters as AST instances', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = and(
      user['name']!.eq('Alice'),
      user['posts']!.some((post) => post['views']!.gt(10)),
    );

    expect(expr).toBeInstanceOf(AndExpr);
    const [nameFilter, postsFilter] = expr.exprs;
    expect(nameFilter).toBeInstanceOf(BinaryExpr);
    expect(nameFilter).toMatchObject({
      op: 'eq',
      left: ColumnRef.of('users', 'name'),
      right: LiteralExpr.of('Alice'),
    });

    expect(postsFilter).toBeInstanceOf(ExistsExpr);
    const exists = postsFilter as ExistsExpr;
    expect(exists.subquery).toBeInstanceOf(SelectAst);
    expect(exists.subquery.from).toBeInstanceOf(TableSource);
    expect(exists.subquery.where).toBeInstanceOf(AndExpr);
  });

  it('normalizes, combines, and negates bound filters', () => {
    const normalized = normalizeWhereArg(
      {
        toWhereExpr: () => ({
          expr: BinaryExpr.eq(
            ColumnRef.of('users', 'id'),
            ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
          ),
        }),
      },
      { contract },
    );

    expect(normalized?.expr).toBeInstanceOf(BinaryExpr);
    expect(collectParamValues(normalized!.expr as BinaryExpr)).toEqual([1]);

    const combined = combineWhereFilters([
      createBoundWhereExpr(BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice'))),
      createBoundWhereExpr(
        BinaryExpr.eq(
          ColumnRef.of('users', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      ),
    ]);
    expect(combined?.expr).toBeInstanceOf(AndExpr);

    expect(not(NullCheckExpr.isNull(ColumnRef.of('users', 'email')))).toEqual(
      NullCheckExpr.isNotNull(ColumnRef.of('users', 'email')),
    );
    expect(or(BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1)))).toBeInstanceOf(
      OrExpr,
    );
    expect(all()).toBeInstanceOf(AndExpr);
  });
});

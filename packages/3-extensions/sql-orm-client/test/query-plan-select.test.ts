import {
  AndExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  DerivedTableSource,
  ParamRef,
  SubqueryExpr,
  type ToWhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileSelectWithIncludeStrategy } from '../src/query-plan-select';
import { baseContract, createCollection } from './collection-fixtures';
import { isSelectAst } from './helpers';

const descriptor = (index: number) => ({ source: 'lane' as const, index });
const bound = (
  expr: BinaryExpr,
  params: readonly unknown[] = [],
  paramDescriptors = params.map((_, index) => descriptor(index + 1)),
): BoundWhereExpr => ({
  expr,
  params,
  paramDescriptors,
});
const toWhereExpr = (value: BoundWhereExpr): ToWhereExpr => ({
  toWhereExpr: () => value,
});

describe('compileSelectWithIncludeStrategy', () => {
  it('offsets include filter params after top-level params', () => {
    const { collection } = createCollection();
    const state = collection
      .where(() =>
        toWhereExpr(
          bound(BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of(1, 'name')), ['Alice']),
        ),
      )
      .include('posts', (posts) =>
        posts.where(() =>
          toWhereExpr(
            bound(BinaryExpr.gte(ColumnRef.of('posts', 'views'), ParamRef.of(1, 'views')), [100]),
          ),
        ),
      ).state;

    const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated');
    expect(plan.params).toEqual(['Alice', 100]);
    expect(plan.meta.paramDescriptors).toEqual([descriptor(1), descriptor(2)]);

    expect(isSelectAst(plan.ast)).toBe(true);
    if (!isSelectAst(plan.ast)) {
      throw new Error('Expected select AST');
    }

    expect(plan.ast.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of(1, 'name')),
    );

    const postsProjection = plan.ast.project.find((item) => item.alias === 'posts');
    expect(postsProjection?.expr).toBeInstanceOf(SubqueryExpr);
    if (!(postsProjection?.expr instanceof SubqueryExpr)) {
      throw new Error('Expected posts include projection to be a subquery');
    }

    const childRowsSource = postsProjection.expr.query.from;
    expect(childRowsSource).toBeInstanceOf(DerivedTableSource);
    if (!(childRowsSource instanceof DerivedTableSource)) {
      throw new Error('Expected include aggregate query to select from derived rows');
    }

    expect(childRowsSource.query.where).toBeInstanceOf(AndExpr);
    expect(childRowsSource.query.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        BinaryExpr.gte(ColumnRef.of('posts', 'views'), ParamRef.of(2, 'views')),
      ]),
    );
  });
});

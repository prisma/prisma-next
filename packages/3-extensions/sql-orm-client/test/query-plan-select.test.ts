import type { BoundWhereExpr, WhereArg, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileSelectWithIncludeStrategy } from '../src/query-plan-select';
import { baseContract, createCollection } from './collection-fixtures';
import { isSelectAst } from './helpers';

const col = (table: string, column: string) => ({ kind: 'col' as const, table, column });
const param = (index: number) => ({ kind: 'param' as const, index });
const descriptor = (index: number) => ({ source: 'lane' as const, index });
const bound = (
  expr: WhereExpr,
  params: readonly unknown[] = [],
  paramDescriptors = params.map((_, index) => descriptor(index + 1)),
): BoundWhereExpr => ({
  expr,
  params,
  paramDescriptors,
});
const toWhereExpr = (value: BoundWhereExpr): WhereArg => ({
  toWhereExpr: () => value,
});

describe('compileSelectWithIncludeStrategy', () => {
  it('offsets include filter params after top-level params', () => {
    const { collection } = createCollection();
    const state = collection
      .where(() =>
        toWhereExpr(
          bound(
            {
              kind: 'bin' as const,
              op: 'eq' as const,
              left: col('users', 'name'),
              right: param(1),
            },
            ['Alice'],
          ),
        ),
      )
      .include('posts', (posts) =>
        posts.where(() =>
          toWhereExpr(
            bound(
              {
                kind: 'bin' as const,
                op: 'gte' as const,
                left: col('posts', 'views'),
                right: param(1),
              },
              [100],
            ),
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

    expect(plan.ast.where).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: col('users', 'name'),
      right: param(1),
    });

    const postsProjection = plan.ast.project.find((item) => item.alias === 'posts');
    expect(postsProjection?.expr.kind).toBe('subquery');
    if (postsProjection?.expr.kind !== 'subquery') {
      throw new Error('Expected posts include projection to be a subquery');
    }

    const childRowsSource = postsProjection.expr.query.from;
    expect(childRowsSource.kind).toBe('derivedTable');
    if (childRowsSource.kind !== 'derivedTable') {
      throw new Error('Expected include aggregate query to select from derived rows');
    }

    expect(childRowsSource.query.where).toEqual({
      kind: 'and',
      exprs: [
        {
          kind: 'bin',
          op: 'eq',
          left: col('posts', 'user_id'),
          right: col('users', 'id'),
        },
        {
          kind: 'bin',
          op: 'gte',
          left: col('posts', 'views'),
          right: param(2),
        },
      ],
    });
  });
});

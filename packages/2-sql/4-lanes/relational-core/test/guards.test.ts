import { describe, expect, it } from 'vitest';
import {
  createAggregateExpr,
  createBinaryExpr,
  createColumnRef,
  createJsonArrayAggExpr,
  createJsonObjectEntry,
  createJsonObjectExpr,
  createLiteralExpr,
  createProjectionItem,
  createSelectAstBuilder,
  createSubqueryExpr,
  createTableSource,
} from '../src/exports/ast';
import { collectColumnRefs } from '../src/utils/guards';

describe('utils/guards', () => {
  it('collects column refs from jsonObject/jsonArrayAgg expression trees', () => {
    const expr = createJsonArrayAggExpr(
      createJsonObjectExpr([
        createJsonObjectEntry('id', createColumnRef('post', 'id')),
        createJsonObjectEntry('title', createColumnRef('post', 'title')),
        createJsonObjectEntry('static', createLiteralExpr('x')),
      ]),
      'emptyArray',
      [{ expr: createColumnRef('post', 'createdAt'), dir: 'desc' }],
    );

    expect(collectColumnRefs(expr)).toEqual([
      createColumnRef('post', 'id'),
      createColumnRef('post', 'title'),
      createColumnRef('post', 'createdAt'),
    ]);
  });

  it('collects column refs from aggregate expressions used in non-projection slots', () => {
    const metricExpr = createAggregateExpr('sum', createColumnRef('post', 'views'));
    const subquery = createSelectAstBuilder(createTableSource('post'))
      .project([createProjectionItem('id', createColumnRef('post', 'id'))])
      .where(createBinaryExpr('gt', metricExpr, createLiteralExpr(10)))
      .build();

    expect(collectColumnRefs(createSubqueryExpr(subquery))).toEqual([
      createColumnRef('post', 'id'),
      createColumnRef('post', 'views'),
    ]);
  });
});

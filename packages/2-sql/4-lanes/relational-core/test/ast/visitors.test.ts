import { describe, expect, it } from 'vitest';
import { createSelectAstBuilder } from '../../src/ast/builders';
import {
  createAggregateExpr,
  createColumnRef,
  createDerivedTableSource,
  createFunctionOperationExpr,
  createJsonArrayAggExpr,
  createJsonObjectEntry,
  createJsonObjectExpr,
  createLiteralExpr,
  createParamRef,
  createProjectionItem,
  createSubqueryExpr,
  createTableSource,
} from '../../src/ast/common';
import { createJoin, createJoinOnExpr } from '../../src/ast/join';
import { createOrderByItem } from '../../src/ast/order';
import {
  createAndExpr,
  createBinaryExpr,
  createExistsExpr,
  createListLiteralExpr,
  createNullCheckExpr,
  createOrExpr,
} from '../../src/ast/predicate';
import type { ColumnRef, Expression, SelectAst } from '../../src/ast/types';
import {
  foldExpression,
  foldExpressionDeep,
  mapExpression,
  mapExpressionDeep,
} from '../../src/ast/visitors';

function col(table: string, column: string): ColumnRef {
  return createColumnRef(table, column);
}

function simpleSelect(tableName: string, columns: string[]): SelectAst {
  const from = createTableSource(tableName);
  return createSelectAstBuilder(from)
    .project(columns.map((c) => createProjectionItem(c, col(tableName, c))))
    .build();
}

function opExpr(
  self: Expression,
  ...args: (Expression | ReturnType<typeof createParamRef> | ReturnType<typeof createLiteralExpr>)[]
) {
  return createFunctionOperationExpr({
    method: 'fn',
    forTypeId: 'test/type@1',
    self,
    args,
    returns: { kind: 'builtin', type: 'string' },
    // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
    template: 'fn(${self})',
  });
}

describe('mapExpression', () => {
  it('col callback renames table references', () => {
    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'renamed' }),
    });

    const result = expression(col('user', 'id'));
    expect(result).toEqual(col('renamed', 'id'));
  });

  it('identity (no callbacks) returns equivalent structure', () => {
    const { expression } = mapExpression({});

    const original = col('t', 'c');
    expect(expression(original)).toBe(original);
  });

  it('recurses into OperationExpr args (mixed Expression/ParamRef/LiteralExpr)', () => {
    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'x' }),
      param: (p) => ({ ...p, index: p.index + 10 }),
      literal: () => createLiteralExpr('mapped'),
    });

    const op = opExpr(col('t', 'a'), createParamRef(0), createLiteralExpr(1), col('t', 'b'));
    const result = expression(op);

    expect(result).toMatchObject({
      kind: 'operation',
      self: col('x', 'a'),
      args: [{ kind: 'param', index: 10 }, { kind: 'literal', value: 'mapped' }, col('x', 'b')],
    });
  });

  it('recurses into AggregateExpr', () => {
    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'y' }),
    });

    const agg = createAggregateExpr('sum', col('t', 'amount'));
    const result = expression(agg);
    expect(result).toEqual(createAggregateExpr('sum', col('y', 'amount')));
  });

  it('returns aggregate without expr unchanged', () => {
    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'y' }),
    });

    const agg = createAggregateExpr('count');
    const result = expression(agg);
    expect(result).toEqual(createAggregateExpr('count'));
  });

  it('recurses into JsonArrayAggExpr without orderBy', () => {
    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'z' }),
    });

    const jaa = createJsonArrayAggExpr(col('t', 'id'), 'emptyArray');
    const result = expression(jaa);
    expect(result).toMatchObject({
      kind: 'jsonArrayAgg',
      expr: col('z', 'id'),
    });
    expect((result as typeof jaa).orderBy).toBeUndefined();
  });

  it('recurses into JsonArrayAggExpr with orderBy', () => {
    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'z' }),
    });

    const jaa = createJsonArrayAggExpr(col('t', 'id'), 'emptyArray', [
      createOrderByItem(col('t', 'createdAt'), 'desc'),
    ]);
    const result = expression(jaa) as typeof jaa;
    expect(result.expr).toEqual(col('z', 'id'));
    expect(result.orderBy![0]!.expr).toEqual(col('z', 'createdAt'));
  });

  it('recurses into JsonObjectExpr', () => {
    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'w' }),
      literal: () => createLiteralExpr('lit'),
    });

    const jo = createJsonObjectExpr([
      createJsonObjectEntry('a', col('t', 'x')),
      createJsonObjectEntry('b', createLiteralExpr(42)),
    ]);
    const result = expression(jo);
    expect(result).toMatchObject({
      kind: 'jsonObject',
      entries: [
        { key: 'a', value: col('w', 'x') },
        { key: 'b', value: { kind: 'literal', value: 'lit' } },
      ],
    });
  });

  it('param callback transforms ParamRefs in operation args', () => {
    const { expression } = mapExpression({
      param: () => createLiteralExpr(99),
    });

    const op = opExpr(col('t', 'a'), createParamRef(0));
    const result = expression(op);
    expect(result).toMatchObject({
      kind: 'operation',
      args: [{ kind: 'literal', value: 99 }],
    });
  });

  describe('where mapper', () => {
    it('handles BinaryExpr', () => {
      const { where } = mapExpression({
        col: (e) => ({ ...e, table: 'r' }),
        param: (p) => ({ ...p, index: p.index + 1 }),
      });

      const bin = createBinaryExpr('eq', col('t', 'id'), createParamRef(0));
      const result = where(bin);
      expect(result).toMatchObject({
        kind: 'bin',
        left: col('r', 'id'),
        right: { kind: 'param', index: 1 },
      });
    });

    it('handles NullCheckExpr', () => {
      const { where } = mapExpression({
        col: (e) => ({ ...e, table: 'r' }),
      });

      const nc = createNullCheckExpr(col('t', 'name'), true);
      const result = where(nc);
      expect(result).toMatchObject({
        kind: 'nullCheck',
        expr: col('r', 'name'),
        isNull: true,
      });
    });

    it('handles AndExpr', () => {
      const { where } = mapExpression({
        col: (e) => ({ ...e, table: 'r' }),
      });

      const and = createAndExpr([
        createBinaryExpr('eq', col('t', 'a'), createParamRef(0)),
        createBinaryExpr('gt', col('t', 'b'), createParamRef(1)),
      ]);
      const result = where(and);
      expect(result.kind).toBe('and');
      if (result.kind === 'and') {
        expect(result.exprs).toHaveLength(2);
        expect(result.exprs[0]).toMatchObject({ left: col('r', 'a') });
        expect(result.exprs[1]).toMatchObject({ left: col('r', 'b') });
      }
    });

    it('handles OrExpr', () => {
      const { where } = mapExpression({
        col: (e) => ({ ...e, table: 'r' }),
      });

      const or = createOrExpr([
        createBinaryExpr('eq', col('t', 'x'), createLiteralExpr(1)),
        createNullCheckExpr(col('t', 'y'), false),
      ]);
      const result = where(or);
      expect(result.kind).toBe('or');
      if (result.kind === 'or') {
        expect(result.exprs).toHaveLength(2);
        expect(result.exprs[0]).toMatchObject({ left: col('r', 'x') });
        expect(result.exprs[1]).toMatchObject({ expr: col('r', 'y') });
      }
    });

    it('handles ExistsExpr without select callback (identity)', () => {
      const subquery = simpleSelect('post', ['id']);
      const exists = createExistsExpr(false, subquery);

      const { where } = mapExpression({
        col: (e) => ({ ...e, table: 'r' }),
      });

      const result = where(exists);
      expect(result).toBe(exists);
    });

    it('handles ExistsExpr with select callback', () => {
      const subquery = simpleSelect('post', ['id']);
      const exists = createExistsExpr(false, subquery);

      const replaced = simpleSelect('comment', ['id']);
      const { where } = mapExpression({
        select: () => replaced,
      });

      const result = where(exists);
      expect(result).toMatchObject({ kind: 'exists', subquery: replaced });
    });
  });

  describe('comparable mapper', () => {
    it('dispatches ParamRef', () => {
      const { comparable } = mapExpression({
        param: (p) => ({ ...p, index: 42 }),
      });
      expect(comparable(createParamRef(0))).toMatchObject({ kind: 'param', index: 42 });
    });

    it('dispatches LiteralExpr', () => {
      const { comparable } = mapExpression({
        literal: () => createLiteralExpr('ok'),
      });
      expect(comparable(createLiteralExpr(1))).toEqual({ kind: 'literal', value: 'ok' });
    });

    it('dispatches ListLiteralExpr with callback', () => {
      const { comparable } = mapExpression({
        listLiteral: () => createLiteralExpr('collapsed'),
      });
      const list = createListLiteralExpr([createParamRef(0), createLiteralExpr(1)]);
      expect(comparable(list)).toEqual({ kind: 'literal', value: 'collapsed' });
    });

    it('dispatches ListLiteralExpr without callback, mapping inner items', () => {
      const { comparable } = mapExpression({
        param: (p) => ({ ...p, index: p.index + 100 }),
        literal: () => createLiteralExpr('x'),
      });
      const list = createListLiteralExpr([createParamRef(0), createLiteralExpr(1)]);
      const result = comparable(list);
      expect(result).toMatchObject({
        kind: 'listLiteral',
        values: [
          { kind: 'param', index: 100 },
          { kind: 'literal', value: 'x' },
        ],
      });
    });

    it('dispatches Expression through expr mapper', () => {
      const { comparable } = mapExpression({
        col: (e) => ({ ...e, table: 'q' }),
      });
      expect(comparable(col('t', 'id'))).toEqual(col('q', 'id'));
    });
  });

  it('without select callback, subquery nodes are unchanged', () => {
    const subquery = simpleSelect('post', ['id']);
    const subqueryExpr = createSubqueryExpr(subquery);

    const { expression } = mapExpression({
      col: (e) => ({ ...e, table: 'renamed' }),
    });

    const result = expression(subqueryExpr);
    expect(result).toBe(subqueryExpr);
  });
});

describe('mapExpressionDeep', () => {
  it('recurses into SubqueryExpr SelectAst', () => {
    const subquery = simpleSelect('t', ['id']);
    const subqueryExpr = createSubqueryExpr(subquery);

    const { expression } = mapExpressionDeep({
      col: (e) => ({ ...e, table: 'deep' }),
    });

    const result = expression(subqueryExpr);
    expect(result).toMatchObject({
      kind: 'subquery',
      query: {
        kind: 'select',
        project: [{ alias: 'id', expr: col('deep', 'id') }],
      },
    });
  });

  it('recurses into ExistsExpr subquery', () => {
    const subquery = simpleSelect('t', ['id']);
    const exists = createExistsExpr(true, subquery);

    const { where } = mapExpressionDeep({
      col: (e) => ({ ...e, table: 'deep' }),
    });

    const result = where(exists);
    expect(result).toMatchObject({
      kind: 'exists',
      not: true,
      subquery: {
        project: [{ alias: 'id', expr: col('deep', 'id') }],
      },
    });
  });

  it('tableSource callback remaps table sources in SelectAst', () => {
    const subquery = simpleSelect('old', ['id']);
    const subqueryExpr = createSubqueryExpr(subquery);

    const { expression } = mapExpressionDeep({
      tableSource: (s) => ({ ...s, name: 'new' }),
    });

    const result = expression(subqueryExpr);
    expect(result).toMatchObject({
      kind: 'subquery',
      query: { from: { kind: 'table', name: 'new' } },
    });
  });

  it('joinOnEqCol callback remaps join conditions', () => {
    const from = createTableSource('user');
    const ast = createSelectAstBuilder(from)
      .project([createProjectionItem('id', col('user', 'id'))])
      .joins([
        createJoin(
          'inner',
          createTableSource('post'),
          createJoinOnExpr(col('user', 'id'), col('post', 'userId')),
        ),
      ])
      .build();
    const subqueryExpr = createSubqueryExpr(ast);

    const { expression } = mapExpressionDeep({
      joinOnEqCol: (on) => ({
        ...on,
        left: { ...on.left, table: 'u' },
        right: { ...on.right, table: 'p' },
      }),
    });

    const result = expression(subqueryExpr);
    expect(result).toMatchObject({
      kind: 'subquery',
      query: {
        joins: [
          {
            on: {
              kind: 'eqCol',
              left: col('u', 'id'),
              right: col('p', 'userId'),
            },
          },
        ],
      },
    });
  });
});

describe('foldExpression', () => {
  /** Collect all ColumnRefs found in the tree. */
  function collectCols() {
    return foldExpression<ColumnRef[]>({
      empty: [],
      combine: (a, b) => [...a, ...b],
      col: (e) => [e],
    });
  }

  it('collects ColumnRefs from expression tree', () => {
    const { expression } = collectCols();

    const op = opExpr(col('t', 'a'), col('t', 'b'));
    expect(expression(op)).toEqual([col('t', 'a'), col('t', 'b')]);
  });

  it('collects ColumnRefs from nested operation', () => {
    const { expression } = collectCols();

    const inner = opExpr(col('t', 'x'));
    const outer = opExpr(col('t', 'y'), inner);
    expect(expression(outer)).toEqual([col('t', 'y'), col('t', 'x')]);
  });

  it('short-circuits with isAbsorbing (boolean detection of ParamRef)', () => {
    const { expression } = foldExpression<boolean>({
      empty: false,
      combine: (a, b) => a || b,
      isAbsorbing: (v) => v,
      param: () => true,
    });

    const op = opExpr(col('t', 'a'), createParamRef(0), col('t', 'b'));
    expect(expression(op)).toBe(true);
  });

  it('short-circuit skips rest after absorbing value', () => {
    let callCount = 0;
    const { expression } = foldExpression<boolean>({
      empty: false,
      combine: (a, b) => a || b,
      isAbsorbing: (v) => v,
      col: () => {
        callCount++;
        return false;
      },
      param: () => {
        callCount++;
        return true;
      },
    });

    // self=col(0), args=[param(1), col(2)] — param is absorbing, col(2) should be skipped
    const op = opExpr(col('t', 'a'), createParamRef(0), col('t', 'b'));
    expression(op);
    // col('t','a') -> called (1), param(0) -> called (2), col('t','b') -> skipped
    expect(callCount).toBe(2);
  });

  describe('folds across WhereExpr kinds', () => {
    it('BinaryExpr', () => {
      const { where } = collectCols();
      const bin = createBinaryExpr('eq', col('t', 'id'), col('t', 'other'));
      expect(where(bin)).toEqual([col('t', 'id'), col('t', 'other')]);
    });

    it('NullCheckExpr', () => {
      const { where } = collectCols();
      const nc = createNullCheckExpr(col('t', 'x'), true);
      expect(where(nc)).toEqual([col('t', 'x')]);
    });

    it('AndExpr', () => {
      const { where } = collectCols();
      const and = createAndExpr([
        createBinaryExpr('eq', col('t', 'a'), createParamRef(0)),
        createNullCheckExpr(col('t', 'b'), false),
      ]);
      expect(where(and)).toEqual([col('t', 'a'), col('t', 'b')]);
    });

    it('OrExpr', () => {
      const { where } = collectCols();
      const or = createOrExpr([
        createBinaryExpr('eq', col('t', 'x'), createLiteralExpr(1)),
        createBinaryExpr('gt', col('t', 'y'), createLiteralExpr(2)),
      ]);
      expect(where(or)).toEqual([col('t', 'x'), col('t', 'y')]);
    });

    it('ExistsExpr without select callback returns empty', () => {
      const { where } = collectCols();
      const subquery = simpleSelect('sub', ['id']);
      const exists = createExistsExpr(false, subquery);
      expect(where(exists)).toEqual([]);
    });
  });

  it('without select callback, subqueries contribute empty', () => {
    const { expression } = collectCols();
    const subqueryExpr = createSubqueryExpr(simpleSelect('sub', ['id']));
    expect(expression(subqueryExpr)).toEqual([]);
  });

  it('folds aggregate with inner expr', () => {
    const { expression } = collectCols();
    const agg = createAggregateExpr('sum', col('t', 'amount'));
    expect(expression(agg)).toEqual([col('t', 'amount')]);
  });

  it('folds aggregate without expr to empty', () => {
    const { expression } = collectCols();
    const agg = createAggregateExpr('count');
    expect(expression(agg)).toEqual([]);
  });

  it('folds jsonArrayAgg with orderBy', () => {
    const { expression } = collectCols();
    const jaa = createJsonArrayAggExpr(col('t', 'id'), 'emptyArray', [
      createOrderByItem(col('t', 'ts'), 'desc'),
    ]);
    expect(expression(jaa)).toEqual([col('t', 'id'), col('t', 'ts')]);
  });

  it('folds jsonObject entries', () => {
    const { expression } = collectCols();
    const jo = createJsonObjectExpr([
      createJsonObjectEntry('a', col('t', 'x')),
      createJsonObjectEntry('b', col('t', 'y')),
    ]);
    expect(expression(jo)).toEqual([col('t', 'x'), col('t', 'y')]);
  });

  it('comparable folds listLiteral elements', () => {
    const { comparable } = foldExpression<number>({
      empty: 0,
      combine: (a, b) => a + b,
      param: (p) => p.index,
      literal: () => 1,
    });

    const list = createListLiteralExpr([createParamRef(5), createLiteralExpr('x')]);
    expect(comparable(list)).toBe(6); // 5 + 1
  });
});

describe('foldExpressionDeep', () => {
  function collectColsDeep() {
    return foldExpressionDeep<ColumnRef[]>({
      empty: [],
      combine: (a, b) => [...a, ...b],
      col: (e) => [e],
    });
  }

  it('collects from nested SubqueryExpr', () => {
    const inner = simpleSelect('inner', ['id']);
    const subqueryExpr = createSubqueryExpr(inner);

    const { expression } = collectColsDeep();
    expect(expression(subqueryExpr)).toEqual([col('inner', 'id')]);
  });

  it('collects from ExistsExpr subquery', () => {
    const subquery = simpleSelect('sub', ['name']);
    const exists = createExistsExpr(false, subquery);

    const { where } = collectColsDeep();
    expect(where(exists)).toEqual([col('sub', 'name')]);
  });

  it('collects from derived table sources', () => {
    const innerSelect = simpleSelect('inner', ['val']);
    const derived = createDerivedTableSource('d', innerSelect);

    const ast = createSelectAstBuilder(derived)
      .project([createProjectionItem('val', col('d', 'val'))])
      .build();

    const { select } = collectColsDeep();
    const result = select(ast);
    // outer col('d','val') + inner col('inner','val')
    expect(result).toEqual([col('inner', 'val'), col('d', 'val')]);
  });

  it('collects from joins', () => {
    const ast = createSelectAstBuilder(createTableSource('user'))
      .project([createProjectionItem('id', col('user', 'id'))])
      .joins([
        createJoin(
          'inner',
          createTableSource('post'),
          // Use a WhereExpr (bin) as the join condition to verify recursion
          createBinaryExpr('eq', col('user', 'id'), col('post', 'userId')),
        ),
      ])
      .build();

    const { select } = collectColsDeep();
    const result = select(ast);
    // project: col('user','id'), join on: col('user','id'), col('post','userId')
    expect(result).toEqual([col('user', 'id'), col('user', 'id'), col('post', 'userId')]);
  });

  it('collects from where and orderBy of nested select', () => {
    const ast = createSelectAstBuilder(createTableSource('t'))
      .project([createProjectionItem('a', col('t', 'a'))])
      .where(createBinaryExpr('eq', col('t', 'b'), createParamRef(0)))
      .orderBy([createOrderByItem(col('t', 'c'), 'asc')])
      .build();

    const { select } = collectColsDeep();
    const result = select(ast);
    // project: a, where: b, orderBy: c
    expect(result).toEqual([col('t', 'a'), col('t', 'b'), col('t', 'c')]);
  });

  it('eqCol join conditions contribute empty in deep fold', () => {
    const ast = createSelectAstBuilder(createTableSource('user'))
      .project([createProjectionItem('id', col('user', 'id'))])
      .joins([
        createJoin(
          'inner',
          createTableSource('post'),
          createJoinOnExpr(col('user', 'id'), col('post', 'userId')),
        ),
      ])
      .build();

    const { select } = collectColsDeep();
    const result = select(ast);
    // Only project col, eqCol join returns empty
    expect(result).toEqual([col('user', 'id')]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '../../src/exports/ast';
import { shiftParamRef } from './test-helpers';

const userEmailRefs = { table: 'user', column: 'email' } as const;

function selectWithEmailFilter(ref: ParamRef): SelectAst {
  return SelectAst.from(TableSource.named('user'))
    .withProjection([
      ProjectionItem.of('email', ColumnRef.of('user', 'email'), 'sql/varchar@1', userEmailRefs),
    ])
    .withWhere(AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'email'), ref)]));
}

describe('ParamRef refs — AST rewriter propagation', () => {
  it('ParamRef.rewrite with no paramRef rewriter returns the same instance (refs preserved)', () => {
    const original = ParamRef.of('a@b.com', {
      name: 'p1',
      codecId: 'sql/varchar@1',
      refs: userEmailRefs,
    });
    const rewritten = original.rewrite({});
    expect(rewritten).toBe(original);
  });

  it('SelectAst.rewrite with an identity paramRef rewriter preserves refs on every ParamRef', () => {
    const ref = ParamRef.of('a@b.com', {
      name: 'p1',
      codecId: 'sql/varchar@1',
      refs: userEmailRefs,
    });
    const ast = selectWithEmailFilter(ref);

    const rewritten = ast.rewrite({ paramRef: (p) => p });

    const rewrittenWhere = rewritten.where as AndExpr;
    const eq = rewrittenWhere.exprs[0] as BinaryExpr;
    const right = eq.right as ParamRef;
    expect(right.refs).toEqual(userEmailRefs);
    expect(right.codecId).toBe('sql/varchar@1');
  });

  it('SelectAst.rewrite with a non-identity paramRef rewriter that propagates refs preserves them', () => {
    const ref = ParamRef.of(7, {
      name: 'p1',
      codecId: 'sql/int@1',
      refs: { table: 'user', column: 'age' },
    });
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'age'), ref)]));

    const rewritten = ast.rewrite({ paramRef: shiftParamRef(10) });

    const where = rewritten.where as AndExpr;
    const eq = where.exprs[0] as BinaryExpr;
    const right = eq.right as ParamRef;
    expect(right.value).toBe(17);
    expect(right.refs).toEqual({ table: 'user', column: 'age' });
  });

  it('SelectAst.rewrite preserves ProjectionItem refs through rewriteProjectionItem', () => {
    const ref = ParamRef.of('a@b.com', {
      name: 'p1',
      codecId: 'sql/varchar@1',
      refs: userEmailRefs,
    });
    const ast = selectWithEmailFilter(ref);

    const rewritten = ast.rewrite({
      columnRef: (c) => (c.table === 'user' ? ColumnRef.of('member', c.column) : c),
    });

    const projection = rewritten.projection[0];
    expect(projection?.refs).toEqual(userEmailRefs);
    expect(projection?.codecId).toBe('sql/varchar@1');
  });

  it('ProjectionItem.withCodecId preserves refs', () => {
    const item = ProjectionItem.of(
      'email',
      ColumnRef.of('user', 'email'),
      'sql/varchar@1',
      userEmailRefs,
    );
    const updated = item.withCodecId('sql/varchar@2');
    expect(updated.codecId).toBe('sql/varchar@2');
    expect(updated.refs).toEqual(userEmailRefs);
  });
});

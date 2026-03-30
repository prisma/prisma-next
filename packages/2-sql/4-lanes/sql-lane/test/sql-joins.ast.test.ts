import {
  ColumnRef,
  EqColJoinOn,
  JoinAst,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';

describe('Join AST types', () => {
  it('defines eq-column join predicates as rich objects', () => {
    const onExpr = EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId'));

    expect(onExpr.left).toEqual(ColumnRef.of('user', 'id'));
    expect(onExpr.right).toEqual(ColumnRef.of('post', 'userId'));
  });

  it('defines joins with source, join type, and predicate', () => {
    const joinAst = JoinAst.inner(
      TableSource.named('post'),
      EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
    );

    expect(joinAst.joinType).toBe('inner');
    expect(joinAst.source).toEqual(TableSource.named('post'));
  });

  it('allows selects with and without joins', () => {
    const withJoin = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withJoins([
        JoinAst.left(
          TableSource.named('post'),
          EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
        ),
      ]);
    const withoutJoin = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
    ]);

    expect(withJoin.joins?.[0]?.joinType).toBe('left');
    expect(withoutJoin.joins).toBeUndefined();
  });

  it.each(['inner', 'left', 'right', 'full'] as const)('supports %s joins', (joinType) => {
    const join = new JoinAst(
      joinType,
      TableSource.named('post'),
      EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
    );

    expect(join.joinType).toBe(joinType);
  });
});

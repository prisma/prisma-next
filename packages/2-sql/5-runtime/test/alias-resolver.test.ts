import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { makeAliasResolver } from '../src/codecs/alias-resolver';

describe('makeAliasResolver', () => {
  it('returns identity when ast is undefined', () => {
    const resolver = makeAliasResolver(undefined);
    expect(resolver('post')).toBe('post');
    expect(resolver('p1')).toBe('p1');
  });

  it('maps table aliases to source names for SELECT', () => {
    const ast = SelectAst.from(TableSource.named('post', 'p1')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('p1', 'id')),
    ]);
    const resolver = makeAliasResolver(ast);
    expect(resolver('p1')).toBe('post');
    expect(resolver('post')).toBe('post');
    expect(resolver('unknown')).toBe('unknown');
  });

  it('records sources from join clauses (self-join aliases)', () => {
    const ast = SelectAst.from(TableSource.named('post', 'p1'))
      .withJoins([
        JoinAst.inner(
          TableSource.named('post', 'p2'),
          EqColJoinOn.of(ColumnRef.of('p1', 'id'), ColumnRef.of('p2', 'id')),
        ),
      ])
      .withProjection([ProjectionItem.of('id', ColumnRef.of('p1', 'id'))]);
    const resolver = makeAliasResolver(ast);
    expect(resolver('p1')).toBe('post');
    expect(resolver('p2')).toBe('post');
  });

  it('records derived table sources by their alias', () => {
    const inner = SelectAst.from(TableSource.named('post')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('post', 'id')),
    ]);
    const ast = SelectAst.from(DerivedTableSource.as('p', inner)).withProjection([
      ProjectionItem.of('id', ColumnRef.of('p', 'id')),
    ]);
    const resolver = makeAliasResolver(ast);
    expect(resolver('p')).toBe('p');
  });

  it('records the target table for mutation ASTs (DELETE)', () => {
    const ast = DeleteAst.from(TableSource.named('post', 'p1')).withWhere(
      BinaryExpr.eq(ColumnRef.of('p1', 'id'), ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } })),
    );
    const resolver = makeAliasResolver(ast);
    expect(resolver('p1')).toBe('post');
  });
});

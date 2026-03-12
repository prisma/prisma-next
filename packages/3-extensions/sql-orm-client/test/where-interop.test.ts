import {
  AndExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  EqColJoinOn,
  ExistsExpr,
  JoinAst,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  type ToWhereExpr,
  type WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { normalizeWhereArg } from '../src/where-interop';

const col = (table: string, column: string) => ColumnRef.of(table, column);
const param = (index: number, name?: string) => ParamRef.of(index, name);
const literal = (value: unknown) => LiteralExpr.of(value);
const descriptor = (index: number) => ({ source: 'lane' as const, index });

function bound(
  expr: WhereExpr,
  params: readonly unknown[] = [],
  paramDescriptors = params.map((_, index) => descriptor(index + 1)),
): BoundWhereExpr {
  return {
    expr,
    params: [...params],
    paramDescriptors,
  };
}

function toWhereExpr(expr: BoundWhereExpr): ToWhereExpr {
  return {
    toWhereExpr: () => expr,
  };
}

function op(self: ColumnRef, args: Array<ColumnRef | ParamRef | LiteralExpr>): OperationExpr {
  return new OperationExpr({
    method: 'op',
    forTypeId: 'sql/text@1',
    self,
    args,
    returns: {} as never,
    lowering: {} as never,
  });
}

describe('where interop', () => {
  it('rejects null where args', () => {
    expect(() => normalizeWhereArg(null as unknown as ToWhereExpr)).toThrow(/cannot be null/i);
  });

  it('preserves bound params for runtime and adapter handling', () => {
    const arg = {
      toWhereExpr: () => ({
        expr: BinaryExpr.eq(col('users', 'name'), param(1, 'name')),
        params: ['Alice'],
        paramDescriptors: [{ source: 'lane' as const }],
      }),
    } satisfies ToWhereExpr;

    expect(normalizeWhereArg(arg)).toEqual(
      bound(BinaryExpr.eq(col('users', 'name'), param(1, 'name')), ['Alice']),
    );
  });

  it('preserves nested and/or params across exists subqueries', () => {
    const expr = AndExpr.of([
      BinaryExpr.eq(col('users', 'id'), param(1, 'id')),
      AndExpr.of([
        BinaryExpr.eq(col('users', 'email'), param(2, 'email')),
        ExistsExpr.exists(
          SelectAst.from(TableSource.named('posts'))
            .withProject([ProjectionItem.of('id', col('posts', 'id'))])
            .withWhere(BinaryExpr.eq(col('posts', 'user_id'), param(3, 'postUserId'))),
        ),
      ]),
    ]);

    expect(normalizeWhereArg(toWhereExpr(bound(expr, [1, 'a@b.c', 99])))).toEqual(
      bound(expr, [1, 'a@b.c', 99]),
    );
  });

  it('rejects bare WhereExpr with ParamRef', () => {
    expect(() => normalizeWhereArg(BinaryExpr.eq(col('users', 'id'), param(1, 'id')))).toThrow(
      /bare WhereExpr.*ParamRef/i,
    );
  });

  it('accepts bare param-free where expressions and comparables', () => {
    const expr = BinaryExpr.eq(col('users', 'kind'), literal('admin'));
    expect(normalizeWhereArg(expr)).toEqual(bound(expr));

    const opExpr = BinaryExpr.eq(
      col('users', 'email'),
      op(col('users', 'email'), [col('users', 'id'), literal('x')]),
    );
    expect(normalizeWhereArg(opExpr)).toEqual(bound(opExpr));
  });

  it('accepts bare exists with join predicates and list literals when param-free', () => {
    const expr = ExistsExpr.exists(
      SelectAst.from(TableSource.named('users'))
        .withJoins([
          JoinAst.left(
            TableSource.named('posts'),
            EqColJoinOn.of(col('users', 'id'), col('posts', 'user_id')),
          ),
          JoinAst.inner(
            TableSource.named('profiles'),
            BinaryExpr.eq(col('users', 'id'), literal('u1')),
          ),
        ])
        .withProject([ProjectionItem.of('id', col('users', 'id'))])
        .withWhere(
          BinaryExpr.in(col('users', 'id'), ListLiteralExpr.of([literal('u1'), literal('u2')])),
        ),
    );

    expect(normalizeWhereArg(expr)).toEqual(bound(expr));
  });

  it('rejects bare null checks whose operation args contain ParamRef', () => {
    const expr = NullCheckExpr.isNotNull(op(col('users', 'email'), [param(1, 'email')]));
    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('rejects wrapped unsupported where nodes', () => {
    const bad = { kind: 'unsupported' } as unknown as WhereExpr;

    expect(() =>
      normalizeWhereArg(
        toWhereExpr({
          expr: bad,
          params: [],
          paramDescriptors: [],
        }),
      ),
    ).toThrow();
  });

  it('validates bound payload alignment and ParamRef indexing', () => {
    expect(() =>
      normalizeWhereArg(
        toWhereExpr({
          expr: BinaryExpr.eq(col('users', 'id'), param(1, 'id')),
          params: [1],
          paramDescriptors: [],
        }),
      ),
    ).toThrow(/paramDescriptors/i);

    expect(() =>
      normalizeWhereArg(
        toWhereExpr({
          expr: BinaryExpr.eq(col('users', 'id'), param(2, 'id')),
          params: ['a', 'b'],
          paramDescriptors: [{ source: 'lane' }, { source: 'lane' }],
        }),
      ),
    ).toThrow(/start at 1/i);

    expect(() =>
      normalizeWhereArg(
        toWhereExpr({
          expr: AndExpr.of([
            BinaryExpr.eq(col('users', 'id'), param(1, 'id')),
            BinaryExpr.eq(col('users', 'email'), param(3, 'email')),
          ]),
          params: ['a', 'b', 'c'],
          paramDescriptors: [{ source: 'lane' }, { source: 'lane' }, { source: 'lane' }],
        }),
      ),
    ).toThrow(/contiguous/i);

    expect(() =>
      normalizeWhereArg(
        toWhereExpr({
          expr: BinaryExpr.eq(col('users', 'id'), param(1, 'id')),
          params: ['a', 'b'],
          paramDescriptors: [{ source: 'lane' }, { source: 'lane' }],
        }),
      ),
    ).toThrow(/max ParamRef index/i);
  });

  it('accepts param-free bound payloads and rejects params with no ParamRef', () => {
    const expr = BinaryExpr.eq(col('users', 'kind'), literal('admin'));

    expect(normalizeWhereArg(toWhereExpr(bound(expr)))).toEqual(bound(expr));

    expect(() =>
      normalizeWhereArg(
        toWhereExpr({
          expr,
          params: ['admin'],
          paramDescriptors: [{ source: 'lane' }],
        }),
      ),
    ).toThrow(/does not contain ParamRef/i);
  });

  it('preserves params inside operations, list literals, and null checks', () => {
    const expr = AndExpr.of([
      BinaryExpr.eq(
        op(col('users', 'email'), [param(1, 'lhs'), literal('@example.com')]),
        op(col('users', 'email'), [param(2, 'rhs')]),
      ),
      BinaryExpr.in(col('users', 'id'), ListLiteralExpr.of([param(3, 'first'), literal('u2')])),
    ]);

    expect(normalizeWhereArg(toWhereExpr(bound(expr, ['prefix', 'rhs', 'u1'])))).toEqual(
      bound(expr, ['prefix', 'rhs', 'u1']),
    );

    const nullCheck = NullCheckExpr.isNotNull(
      op(col('users', 'email'), [col('users', 'email'), param(1, 'needle'), literal('x')]),
    );
    expect(normalizeWhereArg(toWhereExpr(bound(nullCheck, ['needle'])))).toEqual(
      bound(nullCheck, ['needle']),
    );
  });
});

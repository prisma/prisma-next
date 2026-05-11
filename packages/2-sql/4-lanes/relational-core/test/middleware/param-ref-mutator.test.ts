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
import { createSqlParamRefMutator } from '../../src/exports/middleware';
import type { SqlExecutionPlan } from '../../src/sql-execution-plan';

function planWith(ref: ParamRef, value: unknown): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'email'), ref)]));
  return {
    sql: 'select "id" from "user" where "email" = $1',
    params: [value],
    ast,
    meta: {} as SqlExecutionPlan['meta'],
  } as SqlExecutionPlan;
}

describe('createSqlParamRefMutator entries()', () => {
  it('propagates ref.refs into ParamRefEntry.column', () => {
    const ref = ParamRef.of('a@b.com', {
      name: 'p1',
      codecId: 'sql/varchar@1',
      refs: { table: 'user', column: 'email' },
    });
    const mutator = createSqlParamRefMutator(planWith(ref, 'a@b.com'));

    const [entry] = [...mutator.entries()];

    expect(entry?.codecId).toBe('sql/varchar@1');
    expect(entry?.column).toEqual({ table: 'user', name: 'email' });
  });

  it('omits column for ParamRefs constructed without a refs binding', () => {
    const ref = ParamRef.of(42, { name: 'p1', codecId: 'sql/int@1' });
    const mutator = createSqlParamRefMutator(planWith(ref, 42));

    const [entry] = [...mutator.entries()];

    expect(entry?.codecId).toBe('sql/int@1');
    expect(entry?.column).toBeUndefined();
  });
});

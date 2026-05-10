import { describe, expect, it } from 'vitest';
import {
  type AnyQueryAst,
  isQueryAst,
  ParamRef,
  queryAstKinds,
  RawSqlExpr,
} from '../../src/exports/ast';

describe('RawSqlExpr', () => {
  it('exposes kind "raw-sql"', () => {
    const node = new RawSqlExpr(['SELECT 1'], []);
    expect(node.kind).toBe('raw-sql');
  });

  it('static of() and constructor produce frozen instances', () => {
    const fromCtor = new RawSqlExpr(['SELECT 1'], []);
    const fromOf = RawSqlExpr.of(['SELECT 1'], []);
    expect(Object.isFrozen(fromCtor)).toBe(true);
    expect(Object.isFrozen(fromOf)).toBe(true);
    expect(Object.isFrozen(fromCtor.fragments)).toBe(true);
    expect(Object.isFrozen(fromCtor.args)).toBe(true);
  });

  it('throws when fragments.length !== args.length + 1', () => {
    expect(() => new RawSqlExpr([], [])).toThrow(/fragments\.length must equal args\.length \+ 1/);
    expect(() => new RawSqlExpr(['a', 'b', 'c'], [ParamRef.of(1)])).toThrow(
      /fragments\.length must equal args\.length \+ 1/,
    );
    expect(() => RawSqlExpr.of(['only-one'], [ParamRef.of(1)])).toThrow(
      /fragments\.length must equal args\.length \+ 1/,
    );
  });

  it('accepts ParamRef args at the gaps between fragments', () => {
    const ref = ParamRef.of('a@example.com', { codecId: 'pg/text@1' });
    const node = RawSqlExpr.of(
      ['SELECT eql.eq(', ', ', ')'],
      [ParamRef.of('email', { codecId: 'pg/text@1' }), ref],
    );
    expect(node.fragments).toHaveLength(3);
    expect(node.args).toHaveLength(2);
    expect(node.args[1]).toBe(ref);
  });

  it('AnyQueryAst includes "raw-sql" arm (assignability)', () => {
    const node: AnyQueryAst = RawSqlExpr.of(['SELECT 1'], []);
    expect(node.kind).toBe('raw-sql');
  });

  it('queryAstKinds and isQueryAst recognize "raw-sql"', () => {
    expect(queryAstKinds.has('raw-sql')).toBe(true);
    expect(isQueryAst(RawSqlExpr.of(['SELECT 1'], []))).toBe(true);
    expect(isQueryAst({ kind: 'raw-sql' })).toBe(true);
    expect(isQueryAst({ kind: 'unknown' })).toBe(false);
  });

  it('collectParamRefs returns the embedded ParamRefs in declaration order', () => {
    const a = ParamRef.of('a', { codecId: 'pg/text@1' });
    const b = ParamRef.of('b', { codecId: 'pg/text@1' });
    const node = RawSqlExpr.of(['fn(', ', ', ')'], [a, b]);
    expect(node.collectParamRefs()).toEqual([a, b]);
  });

  it('collectParamRefs returns an empty array when there are no args', () => {
    const node = RawSqlExpr.of(['SELECT 1'], []);
    expect(node.collectParamRefs()).toEqual([]);
  });
});

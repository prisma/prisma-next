import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  type AnyExpression,
  type ExprVisitor,
  ParamRef,
  RawExpr,
} from '../../src/exports/ast';
import { col, lit, param } from './test-helpers';

describe('ast/RawExpr', () => {
  const returnsSpec = { codecId: 'pg/text@1', nullable: false } as const;

  it('holds zero-interpolation parts as a single string element', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    expect(expr.kind).toBe('raw-sql');
    expect(expr.parts).toEqual(['now()']);
    expect(expr.returns).toEqual(returnsSpec);
  });

  it('holds mixed string and expression parts', () => {
    const ref = param(1, 'id');
    const expr = new RawExpr({
      parts: ['user_id = ', ref, ' AND active'],
      returns: returnsSpec,
    });
    expect(expr.parts).toHaveLength(3);
    expect(expr.parts[0]).toBe('user_id = ');
    expect(expr.parts[1]).toBe(ref);
    expect(expr.parts[2]).toBe(' AND active');
  });

  it('holds nested expression elements in parts', () => {
    const nested = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    const outer = new RawExpr({
      parts: ['created_at > ', nested],
      returns: returnsSpec,
    });
    expect(outer.parts[1]).toBe(nested);
  });

  it('freezes the parts array so mutation attempts throw', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    expect(() => {
      // Attempting to mutate the frozen array
      (expr.parts as string[]).push('extra');
    }).toThrow(TypeError);
  });

  it('is frozen so property assignment attempts throw in strict mode', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing freeze invariant
      (expr as any).parts = [];
    }).toThrow(TypeError);
  });

  it('inherits baseColumnRef throw from the base Expression class', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    expect(() => expr.baseColumnRef()).toThrow('RawExpr does not expose a base column reference');
  });

  it('dispatches to the rawSql arm of ExprVisitor', () => {
    const ref = param(1, 'x');
    const expr = new RawExpr({ parts: ['x = ', ref], returns: returnsSpec });

    const visited: string[] = [];
    // ExprVisitor.rawSql is a required arm — this object satisfies the full interface.
    // (Structural compile-time property: omitting rawSql would be a TypeScript error.)
    const visitor: ExprVisitor<string> = {
      columnRef: () => 'columnRef',
      identifierRef: () => 'identifierRef',
      subquery: () => 'subquery',
      operation: () => 'operation',
      aggregate: () => 'aggregate',
      jsonObject: () => 'jsonObject',
      jsonArrayAgg: () => 'jsonArrayAgg',
      binary: () => 'binary',
      and: () => 'and',
      or: () => 'or',
      exists: () => 'exists',
      nullCheck: () => 'nullCheck',
      not: () => 'not',
      literal: () => 'literal',
      param: (e) => {
        visited.push(`param:${String(e.value)}`);
        return 'param';
      },
      preparedParam: () => 'preparedParam',
      list: () => 'list',
      rawSql: (e) => {
        visited.push(`rawSql:${e.parts.length}`);
        return 'rawSql';
      },
    };

    const result = expr.accept(visitor);
    expect(result).toBe('rawSql');
    expect(visited).toEqual(['rawSql:2']);
  });

  it('rewrites expression parts through the optional rawSql rewriter arm', () => {
    const ref = param(1, 'x');
    const expr = new RawExpr({ parts: ['prefix ', ref, ' suffix'], returns: returnsSpec });

    const newRef = param(99, 'x');
    const rewritten = expr.rewrite({
      rawSql: (e) =>
        new RawExpr({
          parts: e.parts.map((p) => (p instanceof ParamRef ? newRef : p)) as ReadonlyArray<
            string | AnyExpression
          >,
          returns: e.returns,
        }),
    });

    expect(rewritten).toBeInstanceOf(RawExpr);
    expect((rewritten as RawExpr).parts[1]).toBe(newRef);
  });

  it('returns self from rewrite when no rawSql arm is provided', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    const rewritten = expr.rewrite({});
    expect(rewritten).toBe(expr);
  });

  it('folds using the optional rawSql folder arm when provided', () => {
    const ref = param(1, 'x');
    const expr = new RawExpr({ parts: ['prefix ', ref], returns: returnsSpec });

    const result = expr.fold<string>({
      empty: '',
      combine: (a, b) => `${a}+${b}`,
      rawSql: (e) => `raw:${e.parts.length}`,
    });

    expect(result).toBe('raw:2');
  });

  it('falls back to empty when no rawSql folder arm is provided', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });

    const result = expr.fold<string[]>({
      empty: [],
      combine: (a, b) => [...a, ...b],
    });

    expect(result).toEqual([]);
  });

  it('collects param refs from expression elements in parts', () => {
    const ref1 = param(1, 'x');
    const ref2 = col('user', 'id');
    const ref3 = param(2, 'y');

    const expr = new RawExpr({
      parts: [ref1, ref2, ref3],
      returns: returnsSpec,
    });

    const collected = expr.collectParamRefs();
    expect(collected).toContain(ref1);
    expect(collected).toContain(ref3);
  });

  it('baseColumnRef throws the same message as AggregateExpr.count()', () => {
    const rawExpr = new RawExpr({ parts: ['1'], returns: returnsSpec });
    const countExpr = AggregateExpr.count();

    expect(() => rawExpr.baseColumnRef()).toThrow('does not expose a base column reference');
    expect(() => countExpr.baseColumnRef()).toThrow('does not expose a base column reference');
  });

  it('preserves empty-string parts from back-to-back interpolations', () => {
    const a = lit(1);
    const b = lit(2);
    const expr = new RawExpr({
      parts: ['', a, '', b, ''],
      returns: returnsSpec,
    });
    expect(expr.parts).toEqual(['', a, '', b, '']);
  });
});

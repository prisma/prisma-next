import { describe, expect, it } from 'vitest';
import { ColumnRef, IdentifierRef, LiteralExpr, OperationExpr, ParamRef } from '../src/ast/types';
import { buildOperation, type Expression, refsOf, toExpr } from '../src/expression';

const infixLowering = {
  targetFamily: 'sql',
  strategy: 'infix',
  template: '{{self}} ILIKE {{arg0}}',
} as const;

describe('toExpr', () => {
  it('wraps raw values in a ParamRef without codecId', () => {
    const result = toExpr('hello');
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBe('hello');
    expect((result as ParamRef).codecId).toBeUndefined();
  });

  it('wraps raw values in a ParamRef tagged with codecId when provided', () => {
    const result = toExpr(42, 'pg/int4@1');
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBe(42);
    expect((result as ParamRef).codecId).toBe('pg/int4@1');
  });

  it('unwraps an Expression by calling its buildAst()', () => {
    const column = ColumnRef.of('users', 'email');
    const expression: Expression<{ codecId: 'pg/text@1'; nullable: false }> = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => column,
    };
    expect(toExpr(expression)).toBe(column);
  });

  it('wraps null and undefined as ParamRef values', () => {
    expect((toExpr(null) as ParamRef).value).toBeNull();
    expect((toExpr(undefined) as ParamRef).value).toBeUndefined();
  });

  it('treats objects without buildAst as raw values', () => {
    const value = { notAnExpression: true };
    const result = toExpr(value, 'pg/jsonb@1');
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBe(value);
  });

  it('treats objects whose buildAst is not a function as raw values', () => {
    const value = { buildAst: 'not a function' };
    const result = toExpr(value);
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBe(value);
  });

  it('threads refs onto the resulting ParamRef when provided', () => {
    const result = toExpr('alice@example.com', 'sql/varchar@1', {
      table: 'user',
      column: 'email',
    });
    expect(result).toBeInstanceOf(ParamRef);
    const ref = result as ParamRef;
    expect(ref.codecId).toBe('sql/varchar@1');
    expect(ref.refs).toEqual({ table: 'user', column: 'email' });
  });
});

describe('refsOf', () => {
  it('reads refs from a ColumnRef AST', () => {
    const expr: Expression<{ codecId: 'pg/text@1'; nullable: false }> = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => ColumnRef.of('user', 'email'),
    };
    expect(refsOf(expr)).toEqual({ table: 'user', column: 'email' });
  });

  it('reads refs from an Expression wrapper that carries refs metadata directly', () => {
    const expr: Expression<{ codecId: 'pg/text@1'; nullable: false }> & {
      refs: { table: string; column: string };
    } = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => IdentifierRef.of('email'),
      refs: { table: 'user', column: 'email' },
    };
    expect(refsOf(expr)).toEqual({ table: 'user', column: 'email' });
  });

  it('returns undefined for an Expression backed by a non-column AST and no refs metadata', () => {
    const expr: Expression<{ codecId: 'pg/text@1'; nullable: false }> = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => LiteralExpr.of('foo'),
    };
    expect(refsOf(expr)).toBeUndefined();
  });

  it('returns undefined for raw values', () => {
    expect(refsOf('plain string')).toBeUndefined();
    expect(refsOf(42)).toBeUndefined();
  });
});

describe('buildOperation', () => {
  it('exposes the return spec as returnType', () => {
    const self = ColumnRef.of('users', 'email');
    const returns = { codecId: 'pg/bool@1', nullable: false } as const;
    const expression = buildOperation({
      method: 'ilike',
      args: [self, LiteralExpr.of('%foo%')],
      returns,
      lowering: infixLowering,
    });
    expect(expression.returnType).toBe(returns);
  });

  it('produces an OperationExpr AST node populated from the spec', () => {
    const self = ColumnRef.of('users', 'email');
    const pattern = LiteralExpr.of('%foo%');
    const expression = buildOperation({
      method: 'ilike',
      args: [self, pattern],
      returns: { codecId: 'pg/bool@1', nullable: false },
      lowering: infixLowering,
    });

    const ast = expression.buildAst();
    expect(ast).toBeInstanceOf(OperationExpr);
    const op = ast as OperationExpr;
    expect(op.method).toBe('ilike');
    expect(op.self).toBe(self);
    expect(op.args).toEqual([pattern]);
    expect(op.returns).toEqual({ codecId: 'pg/bool@1', nullable: false });
    expect(op.lowering).toBe(infixLowering);
  });

  it('omits the args list in the AST when only self is supplied', () => {
    const self = ColumnRef.of('posts', 'body');
    const expression = buildOperation({
      method: 'length',
      args: [self],
      returns: { codecId: 'pg/int4@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'length({{self}})' },
    });

    const op = expression.buildAst() as OperationExpr;
    expect(op.self).toBe(self);
    expect(op.args).toEqual([]);
  });

  it('buildAst is idempotent — each call returns the same node', () => {
    const self = ColumnRef.of('t', 'c');
    const expression = buildOperation({
      method: 'upper',
      args: [self],
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'upper({{self}})' },
    });
    expect(expression.buildAst()).toBe(expression.buildAst());
  });

  it('result of buildOperation is itself an Expression consumable by toExpr', () => {
    const inner = buildOperation({
      method: 'upper',
      args: [ColumnRef.of('t', 'c')],
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'upper({{self}})' },
    });
    expect(toExpr(inner)).toBe(inner.buildAst());
  });
});

import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  type BinaryExpr,
  FunctionSource,
  IdentifierRef,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
  TableSource,
} from '../../src/exports/ast';
import { CfExpr, cfExpr, exprSelect } from '../../src/exports/contract-free';

describe('FunctionSource', () => {
  it('creates a frozen function-source node with name and args', () => {
    const arg = ParamRef.of('test');
    const src = FunctionSource.of('pragma_table_info', [arg]);
    expect(src.kind).toBe('function-source');
    expect(src.fn).toBe('pragma_table_info');
    expect(src.args).toHaveLength(1);
    expect(src.args[0]).toBe(arg);
    expect(src.alias).toBeUndefined();
    expect(Object.isFrozen(src)).toBe(true);
  });

  it('supports an optional alias', () => {
    const src = FunctionSource.of('pragma_table_info', [ParamRef.of('t')], 'pti');
    expect(src.alias).toBe('pti');
  });

  it('toFromSource() returns itself', () => {
    const src = FunctionSource.of('f', []);
    expect(src.toFromSource()).toBe(src);
  });
});

describe('cfExpr.fn — catalog function-call helper', () => {
  it('assembles an OperationExpr with function strategy from template + self', () => {
    const expr = cfExpr.fn({
      method: 'to_regclass',
      template: 'to_regclass({{self}})',
      self: cfExpr.param('"public"."users"', 'pg/text@1'),
      returns: { codecId: 'pg/text@1', nullable: true },
    });

    const op = expr.ast as OperationExpr;
    expect(op.kind).toBe('operation');
    expect(op.method).toBe('to_regclass');
    expect(op.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: 'to_regclass({{self}})',
    });
    expect(op.returns).toEqual({ codecId: 'pg/text@1', nullable: true });
    const self = op.self as ParamRef;
    expect(self.kind).toBe('param-ref');
    expect(self.value).toBe('"public"."users"');
    expect(self.codec?.codecId).toBe('pg/text@1');
    expect(op.args).toEqual([]);
  });

  it('threads optional args as expressions', () => {
    const expr = cfExpr.fn({
      method: 'format_type',
      template: 'format_type({{self}}, {{arg0}})',
      self: cfExpr.identifierRef('atttypid'),
      args: [cfExpr.identifierRef('atttypmod')],
      returns: { codecId: 'pg/text@1', nullable: false },
    });
    const op = expr.ast as OperationExpr;
    expect(op.args).toHaveLength(1);
    expect((op.args[0] as IdentifierRef).name).toBe('atttypmod');
  });

  it('composes with CfExpr combinators (isNull)', () => {
    const expr = cfExpr
      .fn({
        method: 'to_regclass',
        template: 'to_regclass({{self}})',
        self: cfExpr.param('"users"', 'pg/text@1'),
        returns: { codecId: 'pg/text@1', nullable: true },
      })
      .isNull();
    const nullCheck = expr.ast as NullCheckExpr;
    expect(nullCheck.kind).toBe('null-check');
    expect(nullCheck.isNull).toBe(true);
    expect((nullCheck.expr as OperationExpr).kind).toBe('operation');
  });
});

describe('SelectAst — optional FROM', () => {
  it('SelectAst.noFrom() builds a FROM-less SelectAst', () => {
    const ast = SelectAst.noFrom();
    expect(ast.from).toBeUndefined();
    expect(ast.kind).toBe('select');
    expect(Object.isFrozen(ast)).toBe(true);
  });

  it('collects param refs from projection when FROM is absent', () => {
    const p = ParamRef.of('val');
    const ast = SelectAst.noFrom().withProjection([
      { kind: 'projection-item', alias: 'x', expr: p, codec: undefined } as never,
    ]);
    const refs = ast.collectParamRefs();
    expect(refs).toHaveLength(1);
    expect(refs[0]).toBe(p);
  });

  it('rewrite() returns a new SelectAst with no from when original has none', () => {
    const ast = SelectAst.noFrom();
    const rewritten = ast.rewrite({});
    expect(rewritten.from).toBeUndefined();
  });
});

describe('CfExpr — additional expression helpers', () => {
  it('isNull() wraps with NullCheckExpr.isNull', () => {
    const inner = new OperationExpr({
      method: 'toRegclass',
      self: LiteralExpr.of('x'),
      args: undefined,
      returns: { nullable: true },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'to_regclass({{self}})' },
    });
    const expr = new CfExpr(inner).isNull();
    expect(expr.ast).toBeInstanceOf(NullCheckExpr);
    const nullCheck = expr.ast as NullCheckExpr;
    expect(nullCheck.isNull).toBe(true);
    expect(nullCheck.expr).toBe(inner);
  });

  it('isNotNull() wraps with NullCheckExpr.isNotNull', () => {
    const inner = LiteralExpr.of('x');
    const expr = new CfExpr(inner).isNotNull();
    const nullCheck = expr.ast as NullCheckExpr;
    expect(nullCheck.isNull).toBe(false);
  });

  it('eqLit(value) wraps with BinaryExpr.eq against a LiteralExpr', () => {
    const inner = AggregateExpr.count();
    const expr = new CfExpr(inner).eqLit(0);
    const binary = expr.ast as BinaryExpr;
    expect(binary.op).toBe('eq');
    expect(binary.left).toBe(inner);
    const right = binary.right as LiteralExpr;
    expect(right.value).toBe(0);
  });

  it('gtLit(value) wraps with BinaryExpr.gt against a LiteralExpr', () => {
    const inner = AggregateExpr.count();
    const expr = new CfExpr(inner).gtLit(0);
    const binary = expr.ast as BinaryExpr;
    expect(binary.op).toBe('gt');
  });
});

describe('cfExpr helpers', () => {
  it('cfExpr.countStar() wraps AggregateExpr.count()', () => {
    const e = cfExpr.countStar();
    expect(e.ast).toBeInstanceOf(AggregateExpr);
    expect((e.ast as AggregateExpr).fn).toBe('count');
    expect((e.ast as AggregateExpr).expr).toBeUndefined();
  });

  it('cfExpr.lit(value) wraps LiteralExpr.of', () => {
    const e = cfExpr.lit(42);
    expect(e.ast).toBeInstanceOf(LiteralExpr);
    expect((e.ast as LiteralExpr).value).toBe(42);
  });

  it('cfExpr.identifierRef(name) wraps IdentifierRef.of', () => {
    const e = cfExpr.identifierRef('name');
    expect(e.ast).toBeInstanceOf(IdentifierRef);
    expect((e.ast as IdentifierRef).name).toBe('name');
  });

  it('cfExpr.param(value, codecId) wraps ParamRef with codec', () => {
    const e = cfExpr.param('test-val', 'pg/text@1');
    expect(e.ast).toBeInstanceOf(ParamRef);
    const p = e.ast as ParamRef;
    expect(p.value).toBe('test-val');
    expect(p.codec?.codecId).toBe('pg/text@1');
  });
});

describe('exprSelect()', () => {
  it('builds a FROM-less SELECT with a computed projection', () => {
    const countEqZero = cfExpr.countStar().eqLit(0);
    const ast = exprSelect().project('result', countEqZero).build();
    expect(ast.kind).toBe('select');
    expect(ast.from).toBeUndefined();
    expect(ast.projection).toHaveLength(1);
    expect(ast.projection[0]?.alias).toBe('result');
    expect(ast.projection[0]?.codec).toBeUndefined();
  });

  it('builds a SELECT with FROM FunctionSource, projection, and WHERE', () => {
    const tableNameParam = cfExpr.param('my_table', 'sqlite/text@1');
    const source = FunctionSource.of('pragma_table_info', [tableNameParam.ast]);
    const countEqZero = cfExpr.countStar().eqLit(0);
    const whereExpr = cfExpr.identifierRef('name').eqParam('my_col', 'sqlite/text@1');

    const ast = exprSelect().from(source).project('result', countEqZero).where(whereExpr).build();

    expect(ast.from).toBe(source);
    expect(ast.where).toBeDefined();
    const where = ast.where as BinaryExpr;
    expect(where.op).toBe('eq');
    const right = where.right as ParamRef;
    expect(right.value).toBe('my_col');
    expect(right.codec?.codecId).toBe('sqlite/text@1');
  });

  it('chaining is immutable — each call returns a new instance', () => {
    const base = exprSelect();
    const withProj = base.project('x', cfExpr.countStar());
    expect(base).not.toBe(withProj);
    expect(base.build().projection).toHaveLength(0);
    expect(withProj.build().projection).toHaveLength(1);
  });

  it('from() replaces the source', () => {
    const s1 = FunctionSource.of('f1', []);
    const s2 = TableSource.named('t1');
    const ast = exprSelect().from(s1).from(s2).build();
    expect(ast.from).toBe(s2);
  });
});

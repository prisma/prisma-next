import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  IdentifierRef,
  ListExpression,
  OperationExpr,
  OrExpr,
  ParamRef,
  SelectAst,
  SubqueryExpr,
} from '@prisma-next/sql-relational-core/ast';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Functions } from '../../src/expression';
import { ExpressionImpl } from '../../src/runtime/expression-impl';
import { createFieldProxy } from '../../src/runtime/field-proxy';
import { createAggregateFunctions, createFunctions } from '../../src/runtime/functions';
import { ParamCollector } from '../../src/runtime/param-collector';
import type { ScopeField } from '../../src/scope';
import { joinedScope, makeSubquery, usersScope } from './test-helpers';

const f = () => createFieldProxy(usersScope);
const jf = () => createFieldProxy(joinedScope);

describe('createFunctions', () => {
  let pc: ParamCollector;
  let fns: ReturnType<typeof createFunctions>;

  beforeEach(() => {
    pc = new ParamCollector();
    fns = createFunctions(pc, {});
  });

  describe('comparison operators', () => {
    it('eq produces BinaryExpr with op eq', () => {
      const result = fns.eq(f().id, 1);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast).toBeInstanceOf(BinaryExpr);
      expect(ast.op).toBe('eq');
      expect(ast.left).toBeInstanceOf(IdentifierRef);
      expect((ast.left as IdentifierRef).name).toBe('id');
      expect(ast.right).toBeInstanceOf(ParamRef);
      expect(pc.getValues()).toEqual([1]);
    });

    it('ne produces BinaryExpr with op neq', () => {
      const result = fns.ne(f().id, 1);
      expect((result.buildAst() as BinaryExpr).op).toBe('neq');
    });

    it('gt produces BinaryExpr with op gt', () => {
      const result = fns.gt(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('gt');
    });

    it('gte produces BinaryExpr with op gte', () => {
      const result = fns.gte(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('gte');
    });

    it('lt produces BinaryExpr with op lt', () => {
      const result = fns.lt(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('lt');
    });

    it('lte produces BinaryExpr with op lte', () => {
      const result = fns.lte(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('lte');
    });

    it('eq with two expressions produces BinaryExpr with both ColumnRefs', () => {
      const fields = jf();
      const result = fns.eq(fields.users.id, fields.posts.user_id);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('eq');
      expect(ast.left).toBeInstanceOf(ColumnRef);
      expect(ast.right).toBeInstanceOf(ColumnRef);
      expect((ast.left as ColumnRef).table).toBe('users');
      expect((ast.right as ColumnRef).table).toBe('posts');
    });
  });

  describe('logical operators', () => {
    it('and produces AndExpr', () => {
      const fields = f();
      const eq1 = fns.eq(fields.id, 1);
      const eq2 = fns.eq(fields.name, 'alice');
      const result = fns.and(eq1, eq2);
      const ast = result.buildAst() as AndExpr;

      expect(ast).toBeInstanceOf(AndExpr);
      expect(ast.exprs).toHaveLength(2);
      expect(ast.exprs[0]).toBeInstanceOf(BinaryExpr);
      expect(ast.exprs[1]).toBeInstanceOf(BinaryExpr);
    });

    it('or produces OrExpr', () => {
      const fields = f();
      const eq1 = fns.eq(fields.id, 1);
      const eq2 = fns.eq(fields.id, 2);
      const result = fns.or(eq1, eq2);
      const ast = result.buildAst() as OrExpr;

      expect(ast).toBeInstanceOf(OrExpr);
      expect(ast.exprs).toHaveLength(2);
    });
  });

  describe('subquery predicates', () => {
    it('exists produces ExistsExpr', () => {
      const result = fns.exists(makeSubquery() as never);
      const ast = result.buildAst() as ExistsExpr;

      expect(ast).toBeInstanceOf(ExistsExpr);
      expect(ast.notExists).toBe(false);
      expect(ast.subquery).toBeInstanceOf(SelectAst);
    });

    it('notExists produces ExistsExpr with notExists=true', () => {
      const result = fns.notExists(makeSubquery() as never);
      const ast = result.buildAst() as ExistsExpr;

      expect(ast).toBeInstanceOf(ExistsExpr);
      expect(ast.notExists).toBe(true);
    });
  });

  describe('in / notIn', () => {
    it('in with array produces BinaryExpr with ListExpression', () => {
      const result = fns.in(f().id, [1, 2, 3]);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast).toBeInstanceOf(BinaryExpr);
      expect(ast.op).toBe('in');
      expect(ast.left).toBeInstanceOf(IdentifierRef);
      expect(ast.right).toBeInstanceOf(ListExpression);
      expect(pc.getValues()).toEqual([1, 2, 3]);
    });

    it('in with subquery produces BinaryExpr with SubqueryExpr', () => {
      const result = fns.in(f().id, makeSubquery() as never);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('in');
      expect(ast.right).toBeInstanceOf(SubqueryExpr);
    });

    it('notIn with array produces BinaryExpr with op notIn', () => {
      const result = fns.notIn(f().id, [1, 2]);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('notIn');
      expect(ast.right).toBeInstanceOf(ListExpression);
    });

    it('notIn with subquery produces BinaryExpr with SubqueryExpr', () => {
      const result = fns.notIn(f().id, makeSubquery() as never);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('notIn');
      expect(ast.right).toBeInstanceOf(SubqueryExpr);
    });
  });
});

describe('createAggregateFunctions', () => {
  let pc: ParamCollector;
  let fns: ReturnType<typeof createAggregateFunctions>;

  beforeEach(() => {
    pc = new ParamCollector();
    fns = createAggregateFunctions(pc, {});
  });

  it('count() produces AggregateExpr with fn count and no expr', () => {
    const result = fns.count();
    const ast = result.buildAst() as AggregateExpr;

    expect(ast).toBeInstanceOf(AggregateExpr);
    expect(ast.fn).toBe('count');
    expect(ast.expr).toBeUndefined();
    expect((result as ExpressionImpl).field).toEqual({ codecId: 'pg/int8@1', nullable: false });
  });

  it('count(expr) produces AggregateExpr with fn count and the given expr', () => {
    const result = fns.count(f().id);
    const ast = result.buildAst() as AggregateExpr;

    expect(ast.fn).toBe('count');
    expect(ast.expr).toBeInstanceOf(IdentifierRef);
  });

  it('sum produces AggregateExpr with fn sum', () => {
    const result = fns.sum(f().id);
    const ast = result.buildAst() as AggregateExpr;

    expect(ast).toBeInstanceOf(AggregateExpr);
    expect(ast.fn).toBe('sum');
    expect(ast.expr).toBeInstanceOf(IdentifierRef);
    expect((result as ExpressionImpl).field).toEqual({ codecId: 'pg/int4@1', nullable: true });
  });

  it('avg produces AggregateExpr with fn avg', () => {
    const result = fns.avg(f().id);
    expect((result.buildAst() as AggregateExpr).fn).toBe('avg');
    expect((result as ExpressionImpl).field.nullable).toBe(true);
  });

  it('min produces AggregateExpr with fn min', () => {
    const result = fns.min(f().id);
    expect((result.buildAst() as AggregateExpr).fn).toBe('min');
  });

  it('max produces AggregateExpr with fn max', () => {
    const result = fns.max(f().id);
    expect((result.buildAst() as AggregateExpr).fn).toBe('max');
  });

  it('inherits comparison operators from Functions', () => {
    const result = fns.eq(f().id, 1);
    const ast = result.buildAst() as BinaryExpr;

    expect(ast).toBeInstanceOf(BinaryExpr);
    expect(ast.op).toBe('eq');
  });
});

describe('extension functions', () => {
  it('produces OperationExpr from queryOperationTypes', () => {
    const opTypes = {
      cosineDistance: {
        args: [
          { codecId: 'pgvector/vector@1', nullable: false },
          { codecId: 'pgvector/vector@1', nullable: false },
        ],
        returns: { codecId: 'pg/float8@1', nullable: false },
        lowering: {
          targetFamily: 'sql' as const,
          strategy: 'function' as const,
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL lowering template
          template: '1 - (${self} <=> ${arg0})',
        },
      },
    };

    const pc = new ParamCollector();
    const fns = createFunctions(pc, opTypes);

    const vectorField: ScopeField = { codecId: 'pgvector/vector@1', nullable: false };
    const expr1 = new ExpressionImpl(ColumnRef.of('posts', 'embedding'), vectorField);
    const expr2 = new ExpressionImpl(ColumnRef.of('other', 'embedding'), vectorField);

    // Extension functions are added dynamically by the Proxy from queryOperationTypes.
    // Access via the typed generic parameter to validate the call.
    type TestQC = {
      readonly codecTypes: Record<string, { readonly input: unknown; readonly output: unknown }>;
      readonly capabilities: Record<string, Record<string, boolean>>;
      readonly queryOperationTypes: typeof opTypes;
    };
    const typedFns = fns as unknown as Functions<TestQC>;
    const result = typedFns.cosineDistance(expr1, expr2);

    expect(result).toBeInstanceOf(ExpressionImpl);
    const ast = result.buildAst() as OperationExpr;
    expect(ast).toBeInstanceOf(OperationExpr);
    expect(ast.method).toBe('cosineDistance');
    expect(ast.self).toBeInstanceOf(ColumnRef);
    expect((ast.self as ColumnRef).table).toBe('posts');
    expect(ast.args).toHaveLength(1);
    expect(ast.args[0]).toBeInstanceOf(ColumnRef);
    expect((result as ExpressionImpl).field).toEqual({ codecId: 'pg/float8@1', nullable: false });
  });
});

describe('parameter collection', () => {
  it('inline literal values are collected as params with correct indices', () => {
    const pc = new ParamCollector();
    const fns = createFunctions(pc, {});
    const fields = f();

    fns.eq(fields.id, 42);
    fns.eq(fields.name, 'alice');

    expect(pc.getValues()).toEqual([42, 'alice']);
    expect(pc.size).toBe(2);
  });

  it('expression-to-expression comparisons do not add params', () => {
    const pc = new ParamCollector();
    const fns = createFunctions(pc, {});
    const fields = jf();

    fns.eq(fields.users.id, fields.posts.user_id);

    expect(pc.size).toBe(0);
  });
});

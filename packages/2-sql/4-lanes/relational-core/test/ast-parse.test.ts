import type { CodecDescriptor } from '@prisma-next/framework-components/codec';
import { isRuntimeError } from '@prisma-next/framework-components/runtime';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import { parseAnyQueryAst } from '../src/ast/parse';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  DerivedTableSource,
  DoNothingConflictAction,
  DoUpdateSetConflictAction,
  EqColJoinOn,
  ExistsExpr,
  IdentifierRef,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '../src/ast/types';
import type { CodecDescriptorRegistry } from '../src/query-lane-context';

function makeRegistry(
  descriptors: Record<string, Partial<CodecDescriptor<unknown>>> = {},
): CodecDescriptorRegistry {
  return {
    descriptorFor(codecId: string) {
      const partial = descriptors[codecId];
      if (!partial) return undefined;
      return {
        codecId,
        isParameterized: false,
        targetTypes: [],
        ...partial,
      } as CodecDescriptor<unknown>;
    },
    codecRefForColumn() {
      return undefined;
    },
    *values() {},
    byTargetType() {
      return [];
    },
  };
}

function roundTrip(
  ast: SelectAst | InsertAst | UpdateAst | DeleteAst,
  registry?: CodecDescriptorRegistry,
) {
  const json = JSON.parse(JSON.stringify(ast));
  return parseAnyQueryAst(json, registry ?? makeRegistry());
}

describe('parseAnyQueryAst', () => {
  describe('round-trip: SELECT', () => {
    it('parses a minimal SELECT', () => {
      const ast = SelectAst.from(TableSource.named('user')).addProjection(
        'id',
        ColumnRef.of('user', 'id'),
      );

      const parsed = roundTrip(ast);
      expect(parsed).toBeInstanceOf(SelectAst);
      const select = parsed as SelectAst;
      expect(select.from).toBeInstanceOf(TableSource);
      expect((select.from as TableSource).name).toBe('user');
      expect(select.projection).toHaveLength(1);
      expect(select.projection[0]!.alias).toBe('id');
      expect(select.projection[0]!.expr).toBeInstanceOf(ColumnRef);
    });

    it('preserves WHERE, ORDER BY, GROUP BY, HAVING, LIMIT, OFFSET, DISTINCT', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .addProjection('id', ColumnRef.of('user', 'id'))
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1)))
        .withOrderBy([OrderByItem.desc(ColumnRef.of('user', 'id'))])
        .withGroupBy([ColumnRef.of('user', 'id')])
        .withHaving(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(0)))
        .withLimit(10)
        .withOffset(5)
        .withDistinct();

      const parsed = roundTrip(ast) as SelectAst;
      expect(parsed.where).toBeInstanceOf(BinaryExpr);
      expect(parsed.orderBy).toHaveLength(1);
      expect(parsed.orderBy![0]!.dir).toBe('desc');
      expect(parsed.groupBy).toHaveLength(1);
      expect(parsed.having).toBeInstanceOf(BinaryExpr);
      expect(parsed.limit).toBe(10);
      expect(parsed.offset).toBe(5);
      expect(parsed.distinct).toBe(true);
    });

    it('preserves JOINs with EqColJoinOn', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .addProjection('id', ColumnRef.of('user', 'id'))
        .withJoins([
          JoinAst.left(
            TableSource.named('post'),
            EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
          ),
        ]);

      const parsed = roundTrip(ast) as SelectAst;
      expect(parsed.joins).toHaveLength(1);
      expect(parsed.joins![0]!.joinType).toBe('left');
    });

    it('preserves derived table (subquery) sources', () => {
      const subquery = SelectAst.from(TableSource.named('post')).addProjection(
        'id',
        ColumnRef.of('post', 'id'),
      );
      const ast = SelectAst.from(DerivedTableSource.as('sub', subquery)).addProjection(
        'id',
        ColumnRef.of('sub', 'id'),
      );

      const parsed = roundTrip(ast) as SelectAst;
      expect(parsed.from).toBeInstanceOf(DerivedTableSource);
      expect((parsed.from as DerivedTableSource).alias).toBe('sub');
    });

    it('preserves all expression kinds', () => {
      const ast = SelectAst.from(TableSource.named('t'))
        .addProjection('a', ColumnRef.of('t', 'a'))
        .addProjection('b', IdentifierRef.of('b'))
        .addProjection('c', LiteralExpr.of(42))
        .addProjection('d', AggregateExpr.count())
        .addProjection('e', AggregateExpr.sum(ColumnRef.of('t', 'a')))
        .withWhere(
          AndExpr.of([
            OrExpr.of([
              BinaryExpr.eq(ColumnRef.of('t', 'a'), LiteralExpr.of(1)),
              NotExpr.prototype.not.call(NullCheckExpr.isNull(ColumnRef.of('t', 'b'))),
            ]),
          ]),
        );

      const parsed = roundTrip(ast) as SelectAst;
      expect(parsed.projection).toHaveLength(5);
      expect(parsed.projection[0]!.expr).toBeInstanceOf(ColumnRef);
      expect(parsed.projection[1]!.expr).toBeInstanceOf(IdentifierRef);
      expect(parsed.projection[2]!.expr).toBeInstanceOf(LiteralExpr);
      expect(parsed.projection[3]!.expr).toBeInstanceOf(AggregateExpr);
      expect(parsed.projection[4]!.expr).toBeInstanceOf(AggregateExpr);
    });
  });

  describe('round-trip: INSERT', () => {
    it('parses INSERT with column-ref, param-ref, and default-value', () => {
      const codec = { codecId: 'pg/text@1' };
      const ast = InsertAst.into(TableSource.named('user')).withValues({
        name: ParamRef.of('Alice', { codec }),
        email: ColumnRef.of('defaults', 'email'),
        createdAt: new DefaultValueExpr(),
      });

      const parsed = roundTrip(ast) as InsertAst;
      expect(parsed).toBeInstanceOf(InsertAst);
      expect(parsed.rows).toHaveLength(1);
      const row = parsed.rows[0]!;
      expect(row['name']).toBeInstanceOf(ParamRef);
      expect((row['name'] as ParamRef).codec).toEqual(codec);
      expect(row['email']).toBeInstanceOf(ColumnRef);
      expect(row['createdAt']).toBeInstanceOf(DefaultValueExpr);
    });

    it('preserves ON CONFLICT DO NOTHING', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withValues({ name: ParamRef.of('Alice', { codec: { codecId: 'pg/text@1' } }) })
        .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'email')]));

      const parsed = roundTrip(ast) as InsertAst;
      expect(parsed.onConflict).toBeDefined();
      expect(parsed.onConflict!.action).toBeInstanceOf(DoNothingConflictAction);
    });

    it('preserves ON CONFLICT DO UPDATE SET', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withValues({ name: ParamRef.of('Alice', { codec: { codecId: 'pg/text@1' } }) })
        .withOnConflict(
          InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
            name: ParamRef.of('Bob', { codec: { codecId: 'pg/text@1' } }),
          }),
        );

      const parsed = roundTrip(ast) as InsertAst;
      expect(parsed.onConflict!.action).toBeInstanceOf(DoUpdateSetConflictAction);
    });
  });

  describe('round-trip: UPDATE', () => {
    it('parses UPDATE with SET, WHERE, RETURNING', () => {
      const codec = { codecId: 'pg/text@1' };
      const ast = UpdateAst.table(TableSource.named('user'))
        .withSet({ name: ParamRef.of('Bob', { codec }) })
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1)))
        .withReturning([ProjectionItem.of('name', ColumnRef.of('user', 'name'), codec)]);

      const parsed = roundTrip(ast) as UpdateAst;
      expect(parsed).toBeInstanceOf(UpdateAst);
      expect(parsed.set['name']).toBeInstanceOf(ParamRef);
      expect((parsed.set['name'] as ParamRef).codec).toEqual(codec);
      expect(parsed.where).toBeInstanceOf(BinaryExpr);
      expect(parsed.returning).toHaveLength(1);
      expect(parsed.returning![0]!.codec).toEqual(codec);
    });
  });

  describe('round-trip: DELETE', () => {
    it('parses DELETE with WHERE', () => {
      const ast = DeleteAst.from(TableSource.named('user')).withWhere(
        BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1)),
      );

      const parsed = roundTrip(ast) as DeleteAst;
      expect(parsed).toBeInstanceOf(DeleteAst);
      expect(parsed.where).toBeInstanceOf(BinaryExpr);
    });
  });

  describe('ParamRef codec round-trip', () => {
    it('preserves CodecRef with typeParams through serialization', () => {
      const codec = { codecId: 'pg/vector@1', typeParams: { length: 1536 } };
      const ast = UpdateAst.table(TableSource.named('document')).withSet({
        embedding: ParamRef.of([1.0, 2.0], { codec }),
      });

      const parsed = roundTrip(ast) as UpdateAst;
      const paramRef = parsed.set['embedding'] as ParamRef;
      expect(paramRef.codec).toEqual(codec);
    });
  });

  describe('typeParams validation', () => {
    it('throws RUNTIME.TYPE_PARAMS_INVALID for malformed typeParams', () => {
      const voidSchema: StandardSchemaV1 = {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate(value) {
            return value === undefined
              ? { value: undefined }
              : { issues: [{ message: 'expected void' }] };
          },
        },
      };
      const registry = makeRegistry({
        'pg/text@1': {
          isParameterized: false,
          paramsSchema: voidSchema,
        },
      });

      const ast = UpdateAst.table(TableSource.named('user')).withSet({
        name: ParamRef.of('x', { codec: { codecId: 'pg/text@1', typeParams: { bad: true } } }),
      });

      expect(() => roundTrip(ast, registry)).toThrow();
      try {
        roundTrip(ast, registry);
      } catch (e) {
        expect(isRuntimeError(e)).toBe(true);
        expect((e as { code: string }).code).toBe('RUNTIME.TYPE_PARAMS_INVALID');
      }
    });

    it('does not throw when typeParams are valid', () => {
      const vectorSchema: StandardSchemaV1 = {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate(value) {
            if (typeof value === 'object' && value !== null && 'length' in value) {
              return { value };
            }
            return { issues: [{ message: 'expected {length: number}' }] };
          },
        },
      };
      const registry = makeRegistry({
        'pg/vector@1': {
          isParameterized: true,
          paramsSchema: vectorSchema,
        },
      });

      const ast = UpdateAst.table(TableSource.named('doc')).withSet({
        embedding: ParamRef.of([1, 2, 3], {
          codec: { codecId: 'pg/vector@1', typeParams: { length: 3 } },
        }),
      });

      expect(() => roundTrip(ast, registry)).not.toThrow();
    });
  });

  describe('complex expressions', () => {
    it('round-trips OperationExpr', () => {
      const ast = SelectAst.from(TableSource.named('user')).addProjection(
        'upper_name',
        new OperationExpr({
          method: 'upper',
          self: ColumnRef.of('user', 'name'),
          args: undefined,
          returns: { codecId: 'pg/text@1', nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'function', template: 'upper({{self}})' },
        }),
      );

      const parsed = roundTrip(ast) as SelectAst;
      const expr = parsed.projection[0]!.expr as OperationExpr;
      expect(expr).toBeInstanceOf(OperationExpr);
      expect(expr.method).toBe('upper');
      expect(expr.self).toBeInstanceOf(ColumnRef);
    });

    it('round-trips JsonObjectExpr', () => {
      const ast = SelectAst.from(TableSource.named('user')).addProjection(
        'json',
        JsonObjectExpr.fromEntries([
          { key: 'name', value: ColumnRef.of('user', 'name') },
          { key: 'lit', value: LiteralExpr.of(42) },
        ]),
      );

      const parsed = roundTrip(ast) as SelectAst;
      const expr = parsed.projection[0]!.expr as JsonObjectExpr;
      expect(expr).toBeInstanceOf(JsonObjectExpr);
      expect(expr.entries).toHaveLength(2);
    });

    it('round-trips ExistsExpr', () => {
      const subquery = SelectAst.from(TableSource.named('post')).addProjection(
        'id',
        ColumnRef.of('post', 'id'),
      );
      const ast = SelectAst.from(TableSource.named('user'))
        .addProjection('id', ColumnRef.of('user', 'id'))
        .withWhere(ExistsExpr.exists(subquery));

      const parsed = roundTrip(ast) as SelectAst;
      expect(parsed.where).toBeInstanceOf(ExistsExpr);
      expect((parsed.where as ExistsExpr).notExists).toBe(false);
    });

    it('round-trips ListExpression', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .addProjection('id', ColumnRef.of('user', 'id'))
        .withWhere(
          BinaryExpr.in(
            ColumnRef.of('user', 'id'),
            ListExpression.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
          ),
        );

      const parsed = roundTrip(ast) as SelectAst;
      const where = parsed.where as BinaryExpr;
      expect(where.right).toBeInstanceOf(ListExpression);
    });

    it('round-trips SubqueryExpr', () => {
      const subquery = SelectAst.from(TableSource.named('post')).addProjection(
        'userId',
        ColumnRef.of('post', 'userId'),
      );
      const ast = SelectAst.from(TableSource.named('user'))
        .addProjection('id', ColumnRef.of('user', 'id'))
        .withWhere(BinaryExpr.in(ColumnRef.of('user', 'id'), SubqueryExpr.of(subquery)));

      const parsed = roundTrip(ast) as SelectAst;
      const where = parsed.where as BinaryExpr;
      expect(where.right).toBeInstanceOf(SubqueryExpr);
    });

    it('round-trips JsonArrayAggExpr', () => {
      const ast = SelectAst.from(TableSource.named('user')).addProjection(
        'names',
        JsonArrayAggExpr.of(ColumnRef.of('user', 'name'), 'emptyArray', [
          OrderByItem.asc(ColumnRef.of('user', 'name')),
        ]),
      );

      const parsed = roundTrip(ast) as SelectAst;
      const expr = parsed.projection[0]!.expr as JsonArrayAggExpr;
      expect(expr).toBeInstanceOf(JsonArrayAggExpr);
      expect(expr.onEmpty).toBe('emptyArray');
      expect(expr.orderBy).toHaveLength(1);
    });
  });
});

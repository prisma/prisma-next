import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  ColumnRef,
  JsonArrayAggExpr,
  JsonObjectExpr,
  LiteralExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  TableSource,
} from '../../src/exports/ast';
import { col, lit, lowerExpr, param, stringReturn, table } from './test-helpers';

describe('ast/common', () => {
  it('creates table and column refs through rich objects', () => {
    const source = table('user', 'u');
    const column = col('user', 'id');

    expect(source).toBeInstanceOf(TableSource);
    expect(source).toMatchObject({ name: 'user', alias: 'u' });
    expect(column).toBeInstanceOf(ColumnRef);
    expect(column).toMatchObject({ table: 'user', column: 'id' });
  });

  it('creates param refs with value and options', () => {
    const original = param(1, 'userId');

    expect(original).toBeInstanceOf(ParamRef);
    expect(original).toMatchObject({ value: 1, name: 'userId' });

    const withCodec = ParamRef.of('test', {
      name: 'field',
      codecId: 'pg/text@1',
    });
    expect(withCodec).toMatchObject({
      value: 'test',
      name: 'field',
      codecId: 'pg/text@1',
    });
  });

  it('creates operation expressions directly and through function helpers', () => {
    const explicit = new OperationExpr({
      method: 'concat',
      forTypeId: 'pg/text@1',
      self: col('user', 'email'),
      args: [param(0, 'suffix')],
      returns: stringReturn,
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
        template: '${self} || ${arg0}',
      },
    });
    const lowered = lowerExpr(col('user', 'email'));

    expect(explicit).toBeInstanceOf(OperationExpr);
    expect(explicit).toMatchObject({ method: 'concat', args: [param(0, 'suffix')] });
    expect(explicit.baseColumnRef()).toEqual(col('user', 'email'));
    expect(lowered.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
      template: 'lower(${self})',
    });
  });

  it('creates aggregate expressions and validates required operands', () => {
    expect(AggregateExpr.count()).toEqual(new AggregateExpr('count'));
    expect(AggregateExpr.sum(col('post', 'likes'))).toEqual(
      new AggregateExpr('sum', col('post', 'likes')),
    );
    expect(() => new AggregateExpr('sum')).toThrow(
      'Aggregate function "sum" requires an expression',
    );
  });

  it('creates JSON expression nodes from rich entries and order items', () => {
    const objectExpr = JsonObjectExpr.fromEntries([
      JsonObjectExpr.entry('id', col('user', 'id')),
      JsonObjectExpr.entry('name', lit('Alice')),
    ]);
    const arrayExpr = JsonArrayAggExpr.of(col('post', 'id'), 'emptyArray', [
      OrderByItem.desc(col('post', 'createdAt')),
    ]);

    expect(objectExpr).toEqual(
      new JsonObjectExpr([
        { key: 'id', value: col('user', 'id') },
        { key: 'name', value: lit('Alice') },
      ]),
    );
    expect(arrayExpr).toEqual(
      new JsonArrayAggExpr(col('post', 'id'), 'emptyArray', [
        OrderByItem.desc(col('post', 'createdAt')),
      ]),
    );
  });

  it('creates literal expressions by value reference', () => {
    const obj = { foo: 'bar' };
    const arr = [1, 2, 3];

    expect(lit('test')).toEqual(new LiteralExpr('test'));
    expect(lit(42).value).toBe(42);
    expect(lit(true).value).toBe(true);
    expect(lit(null).value).toBeNull();
    expect(lit(obj).value).toBe(obj);
    expect(lit(arr).value).toBe(arr);
  });
});

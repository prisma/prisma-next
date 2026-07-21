import { test } from 'vitest';
import {
  ColumnRef,
  JsonArrayAggExpr,
  JsonObjectExpr,
  NativeJsonValueProjection,
} from '../../src/exports/ast';

test('JSON containers require explicit value projections', () => {
  const value = ColumnRef.of('record', 'value');
  const projection = new NativeJsonValueProjection(value);

  JsonObjectExpr.entry('value', projection);
  JsonObjectExpr.fromEntries([{ key: 'value', value: projection }]);
  new JsonObjectExpr([{ key: 'value', value: projection }]);
  JsonArrayAggExpr.of(projection);
  new JsonArrayAggExpr(projection);

  // @ts-expect-error -- JSON object values require an explicit projection variant
  JsonObjectExpr.entry('value', value);
  // @ts-expect-error -- JSON object entries cannot contain a bare expression
  JsonObjectExpr.fromEntries([{ key: 'value', value }]);
  // @ts-expect-error -- the JSON object constructor cannot contain a bare expression
  new JsonObjectExpr([{ key: 'value', value }]);
  // @ts-expect-error -- JSON array elements require an explicit projection variant
  JsonArrayAggExpr.of(value);
  // @ts-expect-error -- the JSON array constructor requires an explicit projection variant
  new JsonArrayAggExpr(value);
});

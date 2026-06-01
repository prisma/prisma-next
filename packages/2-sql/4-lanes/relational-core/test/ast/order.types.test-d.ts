import { expectTypeOf, test } from 'vitest';
import type { AnyExpression, Direction, OrderByItem } from '../../src/ast/types';

test('OrderByItem.reverse() returns an OrderByItem', () => {
  expectTypeOf<OrderByItem['reverse']>().toEqualTypeOf<() => OrderByItem>();
});

test('OrderByItem exposes readable dir and expr', () => {
  expectTypeOf<OrderByItem['dir']>().toEqualTypeOf<Direction>();
  expectTypeOf<OrderByItem['expr']>().toEqualTypeOf<AnyExpression>();
});

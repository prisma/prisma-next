import type { AnyExpression, Direction } from '@prisma-next/sql-relational-core/ast';
import { expectTypeOf, test } from 'vitest';
import type { OrderByItem } from '../src/exports';

test('OrderByItem.reverse() returns an OrderByItem', () => {
  expectTypeOf<OrderByItem['reverse']>().toEqualTypeOf<() => OrderByItem>();
});

test('OrderByItem exposes readable dir and expr', () => {
  expectTypeOf<OrderByItem['dir']>().toEqualTypeOf<Direction>();
  expectTypeOf<OrderByItem['expr']>().toEqualTypeOf<AnyExpression>();
});

import { ColumnRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { OrderByItem } from '../src/exports';

describe('OrderByItem re-export', () => {
  it('is re-exported from the public ORM client surface', () => {
    expect(OrderByItem.asc(ColumnRef.of('user', 'id'))).toBeInstanceOf(OrderByItem);
  });

  it('reverse() flips direction into a new frozen instance, preserving expr', () => {
    const expr = ColumnRef.of('user', 'id');
    const asc = OrderByItem.asc(expr);
    const reversed = asc.reverse();

    expect(reversed.dir).toBe('desc');
    expect(reversed.expr).toBe(expr);
    expect(reversed).not.toBe(asc);
    expect(asc.dir).toBe('asc');
    expect(Object.isFrozen(reversed)).toBe(true);
  });

  it('reverse() round-trips back to the original direction with expr reference preserved', () => {
    const asc = OrderByItem.asc(ColumnRef.of('post', 'title'));
    const roundTrip = asc.reverse().reverse();

    expect(roundTrip.dir).toBe('asc');
    expect(roundTrip.expr).toBe(asc.expr);
  });
});

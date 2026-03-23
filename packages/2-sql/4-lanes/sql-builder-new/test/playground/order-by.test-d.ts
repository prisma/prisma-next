import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('orderBy with select alias', () => {
  const ordered = db.users
    .select('authorName', (f) => f.name)
    .orderBy('authorName', { direction: 'desc', nulls: 'last' })
    .firstOrThrow();

  expectTypeOf(ordered).toEqualTypeOf<Promise<{ authorName: string }>>();
});

test('orderBy with expression referencing alias', () => {
  const orderedExpr = db.users
    .select('authorName', (f) => f.name)
    .orderBy((f) => f.authorName, { direction: 'asc' })
    .firstOrThrow();

  expectTypeOf(orderedExpr).toEqualTypeOf<Promise<{ authorName: string }>>();
});

test('orderBy with scope field not in select', () => {
  const orderedScope = db.users.select('name').orderBy('id').firstOrThrow();

  expectTypeOf(orderedScope).toEqualTypeOf<Promise<{ name: string }>>();
});

import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('extension function in select expression', () => {
  const withDistance = db.posts
    .select('id')
    .select('distance', (f, fns) => fns.cosineDistance(f.embedding, f.embedding))
    .firstOrThrow();

  expectTypeOf(withDistance).toEqualTypeOf<Promise<{ id: number; distance: number }>>();
});

test('extension function in orderBy', () => {
  const ordered = db.posts
    .select('id', 'title')
    .orderBy((f, fns) => fns.cosineDistance(f.embedding, [1, 2, 3]))
    .firstOrThrow();

  expectTypeOf(ordered).toEqualTypeOf<Promise<{ id: number; title: string }>>();
});

test('extension function composed with builtins in where', () => {
  const filtered = db.posts
    .select('id', 'title')
    .where((f, fns) => fns.lt(fns.cosineDistance(f.embedding, [1, 2, 3]), 0.5))
    .firstOrThrow();

  expectTypeOf(filtered).toEqualTypeOf<Promise<{ id: number; title: string }>>();
});

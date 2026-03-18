import { expectTypeOf } from 'vitest';
import { posts } from './preamble';

// Extension function in select expression
const withDistance = await posts
  .select('id')
  .select('distance', (f, fns) => fns.cosineDistance(f.embedding, f.embedding))
  .first();
expectTypeOf(withDistance).toEqualTypeOf<{ id: number; distance: number }>();

// Extension function in orderBy
const ordered = await posts
  .select('id', 'title')
  .orderBy((f, fns) => fns.cosineDistance(f.embedding, [1, 2, 3]))
  .first();
expectTypeOf(ordered).toEqualTypeOf<{ id: number; title: string }>();

// Extension function composed with builtins in where
const filtered = await posts
  .select('id', 'title')
  .where((f, fns) => fns.lt(fns.cosineDistance(f.embedding, [1, 2, 3]), 0.5))
  .first();
expectTypeOf(filtered).toEqualTypeOf<{ id: number; title: string }>();

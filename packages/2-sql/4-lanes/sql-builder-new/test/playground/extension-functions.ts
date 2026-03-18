import { expectTypeOf } from 'vitest';
import { db } from './preamble';

// Extension function in select expression
const withDistance = await db.posts
  .select('id')
  .select('distance', (f, fns) => fns.cosineDistance(f.embedding, f.embedding))
  .first();
expectTypeOf(withDistance).toEqualTypeOf<{ id: number; distance: number }>();

// Extension function in orderBy
const ordered = await db.posts
  .select('id', 'title')
  .orderBy((f, fns) => fns.cosineDistance(f.embedding, [1, 2, 3]))
  .first();
expectTypeOf(ordered).toEqualTypeOf<{ id: number; title: string }>();

// Extension function composed with builtins in where
const filtered = await db.posts
  .select('id', 'title')
  .where((f, fns) => fns.lt(fns.cosineDistance(f.embedding, [1, 2, 3]), 0.5))
  .first();
expectTypeOf(filtered).toEqualTypeOf<{ id: number; title: string }>();

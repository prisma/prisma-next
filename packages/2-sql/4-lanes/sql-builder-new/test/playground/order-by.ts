import { expectTypeOf } from 'vitest';
import { db } from './preamble';

// orderBy with select alias
const ordered = await db.users
  .select('authorName', (f) => f.name)
  .orderBy('authorName', { direction: 'desc', nulls: 'last' })
  .first();

expectTypeOf(ordered).toEqualTypeOf<{ authorName: string }>();

// orderBy with expression referencing alias
const orderedExpr = await db.users
  .select('authorName', (f) => f.name)
  .orderBy((f) => f.authorName, { direction: 'asc' })
  .first();

expectTypeOf(orderedExpr).toEqualTypeOf<{ authorName: string }>();

// orderBy with scope field (not in select)
const orderedScope = await db.users.select('name').orderBy('id').first();

expectTypeOf(orderedScope).toEqualTypeOf<{ name: string }>();

import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

/**
 * Many-to-many filter example: list posts using relation filter predicates
 * on the N:M `tags` relation. Demonstrates `.some()`, `.none()`, and
 * `.every()` applied to a M:N relation.
 *
 * @param mode  'some' | 'none' | 'every' — which predicate to apply
 * @param label Tag label to match (for some/none) or not match (for every)
 */
export async function ormClientGetPostsByTagFilter(
  mode: 'some' | 'none' | 'every',
  label: string,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);

  if (mode === 'some') {
    return db.Post.where((p) => p.tags.some((t) => t.label.eq(label))).all();
  }

  if (mode === 'none') {
    return db.Post.where((p) => p.tags.none((t) => t.label.eq(label))).all();
  }

  return db.Post.where((p) => p.tags.every((t) => t.label.neq(label))).all();
}

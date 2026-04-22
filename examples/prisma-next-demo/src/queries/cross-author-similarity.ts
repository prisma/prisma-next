import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

/**
 * "Cross-author similarity" — an SQL DSL escape-hatch query that the ORM client cannot express,
 * even after other ORM gaps (e.g. TML-2137) are closed.
 *
 * Finds the closest pairs of posts written by *different* authors, ordered by cosine distance
 * between their embeddings. For each pair, projects both posts' id/title/userId side-by-side
 * along with the distance between their embeddings.
 *
 * Why the ORM client can't express this:
 *   1. **Self-join on a non-relation predicate.** The ORM's join surface is relation-shaped —
 *      it can only follow declared relations (`include('posts', ...)`). Joining `Post` to
 *      itself on `p1.userId != p2.userId` is an arbitrary predicate join, not a relation,
 *      and has no representation in the collection model.
 *   2. **Extension op taking two column references.** `cosineDistance(f.p1.embedding,
 *      f.p2.embedding)` compares two columns from two aliases within one query. The ORM's
 *      extension-op integration (TML-2042) is `column.method(boundValue)` — method-on-receiver
 *      form where the other argument must be a materialized value. `ormClientFindSimilarPosts`
 *      works around this by running a separate query to load the reference embedding first.
 *      There is no ORM surface for "column vs column within a single query".
 *   3. **Projecting two rows of the same model as peers.** The ORM always has a single root
 *      model per query, and the output row is shaped by that root plus its relations. Two
 *      sibling `Post` rows projected flat into one output row is not a shape the collection
 *      model produces.
 *
 * Features exercised:
 *   1. Self-join via `.as()` aliasing of the same table (`post` aliased as `p1` and `p2`).
 *   2. INNER JOIN with a non-equality predicate (`ne(p1.userId, p2.userId)`).
 *   3. pgvector `cosineDistance` called with two column references from two aliases — in the
 *      SELECT projection and in the ORDER BY.
 *   4. Typed result row inferred from the SELECT projection, mixing columns from both aliases.
 */
export async function crossAuthorSimilarity(limit = 10, runtime?: Runtime) {
  const plan = db.sql.post
    .as('p1')
    .innerJoin(db.sql.post.as('p2'), (f, fns) => fns.ne(f.p1.userId, f.p2.userId))
    .select((f, fns) => ({
      postAId: f.p1.id,
      postATitle: f.p1.title,
      postAUserId: f.p1.userId,
      postBId: f.p2.id,
      postBTitle: f.p2.title,
      postBUserId: f.p2.userId,
      distance: fns.cosineDistance(f.p1.embedding, f.p2.embedding),
    }))
    .where((f, fns) => fns.and(fns.ne(f.p1.embedding, null), fns.ne(f.p2.embedding, null)))
    .orderBy((f, fns) => fns.cosineDistance(f.p1.embedding, f.p2.embedding), {
      direction: 'asc',
    })
    .orderBy((f) => f.p1.id, { direction: 'asc' })
    .orderBy((f) => f.p2.id, { direction: 'asc' })
    .limit(limit)
    .build();

  return (runtime ?? db.runtime()).execute(plan);
}

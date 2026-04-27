import type { Char } from '@prisma-next/adapter-postgres/codec-types';
import type { ModelAccessor } from '@prisma-next/sql-orm-client';
import type { VerifyMode } from '../lib/db';
import { getDb } from '../lib/db';
import type { Contract } from '../prisma/contract.d';

/**
 * Server Component #5 / 5 — pgvector similarity search via the ORM.
 *
 * Exercises the extension-contributed operator path: `pgvector` registers
 * the `cosineDistance` codec operator, and `sql-orm-client` surfaces it on
 * the `embedding` field's `ModelAccessor`. Under the hood this emits a
 * vector operator in the generated SQL that only works because the
 * extension pack is loaded in the runtime (see `src/lib/db.ts`).
 *
 * Included in the five-component mix specifically to confirm that
 * extension-contributed operators compose safely with the shared runtime
 * under concurrent rendering. Extensions mutate the execution context at
 * construction time; by the time a request is served, that context is
 * frozen, so this component is expected to behave identically to the
 * other ORM paths. The PoC verifies rather than assumes.
 *
 * Strategy: pick the first post that has an embedding as a "query vector"
 * and return the top-N most similar posts excluding itself. If the seed
 * hasn't been run, or no post has an embedding, renders an empty state.
 */
export interface SimilarPostsSampleProps {
  readonly verifyMode: VerifyMode;
  readonly poolMax?: number | undefined;
  readonly limit?: number;
}

export async function SimilarPostsSample({
  verifyMode,
  poolMax,
  limit = 5,
}: SimilarPostsSampleProps) {
  const db = getDb({ verifyMode, poolMax });

  const seed = await db.orm.Post.select('id', 'title', 'embedding')
    .orderBy((post) => post.createdAt.asc())
    .take(1)
    .all();

  const queryPost = seed[0];
  const queryEmbedding = queryPost?.embedding;

  if (!queryPost || !queryEmbedding) {
    return (
      <div className="card">
        <h2>Similar posts (pgvector)</h2>
        <p className="muted">
          <code>db.orm.Post.orderBy(cosineDistance).take({limit}).all()</code>
        </p>
        <p className="muted">
          No seed post with an embedding was found. Run <code>pnpm seed</code>.
        </p>
      </div>
    );
  }

  const cosineDistanceFrom = (post: ModelAccessor<Contract, 'Post'>) =>
    post.embedding.cosineDistance(queryEmbedding);

  const similar = await db.orm.Post.where((post) => post.id.neq(queryPost.id as Char<36>))
    .where((post) => cosineDistanceFrom(post).lt(1))
    .orderBy((post) => cosineDistanceFrom(post).asc())
    .select('id', 'title', 'userId')
    .take(limit)
    .all();

  return (
    <div className="card">
      <h2>Similar posts (pgvector)</h2>
      <p className="muted">
        <code>db.orm.Post.orderBy(cosineDistance).take({limit}).all()</code>
      </p>
      <p className="muted">
        Query: <code>{queryPost.title}</code>
      </p>
      {similar.length === 0 ? (
        <p className="muted">No similar posts within distance &lt; 1.</p>
      ) : (
        <ul>
          {similar.map((post) => (
            <li key={post.id}>
              <code>{post.title}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

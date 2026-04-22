import type { VerifyMode } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #2 / 5 — ORM with `include()`.
 *
 * Exercises the multi-query include dispatch path in `sql-orm-client`:
 * `dispatchWithMultiQueryIncludes()` acquires one runtime scope and issues
 * the parent query plus one query per include. All of that happens inside
 * a single `acquireRuntimeScope()` call, so from the pool's perspective
 * this component holds one connection for the duration of its render.
 *
 * This is the most likely place for a connection-starvation symptom under
 * pool pressure: a slow include will pin a connection, and five of these
 * rendering concurrently with a `max: 5` pool leaves zero headroom for
 * anything else.
 */
export interface PostsWithAuthorsProps {
  readonly verifyMode: VerifyMode;
  readonly limit?: number;
}

export async function PostsWithAuthors({ verifyMode, limit = 10 }: PostsWithAuthorsProps) {
  const db = getDb({ verifyMode });
  const posts = await db.orm.Post.select('id', 'title', 'userId', 'createdAt')
    .include('user', (user) => user.select('id', 'email', 'kind'))
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.asc()])
    .take(limit)
    .all();

  return (
    <div className="card">
      <h2>Posts with authors</h2>
      <p className="muted">
        <code>db.orm.Post.include('user', ...).take({limit}).all()</code>
      </p>
      {posts.length === 0 ? (
        <p className="muted">
          No posts yet. Run <code>pnpm seed</code>.
        </p>
      ) : (
        <ul>
          {posts.map((post) => (
            <li key={post.id}>
              <code>{post.title}</code>
              <span className="muted"> — </span>
              <span className="badge">{post.user.kind}</span>
              <code>{post.user.email}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

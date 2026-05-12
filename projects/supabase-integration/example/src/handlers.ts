// Request handlers exercising the three role-binding helpers from the
// supabase() facade. These are framework-agnostic — they take a small
// RequestContext and return data. The HTTP layer (Express, Hono, Next route
// handlers, whatever) wraps them.

import { db } from './prisma/db';

export interface RequestContext {
  /** JWT extracted from the Authorization header. Absent for unauthenticated requests. */
  jwt?: string;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Anonymous read endpoint: list published posts.
// ────────────────────────────────────────────────────────────────────────────
// DESIGN HOLE #10: db.asAnon() is called twice — once to get the SQL DSL, once
// to get the runtime. Either calls must be cheap (memoized handle), or callers
// should hoist into a single `const anon = db.asAnon()`. Document the cost
// contract; if expensive, the API should encourage hoisting.
export async function listPublishedPosts(): Promise<
  Array<{ id: string; title: string; publishedAt: Date | null; authorId: string }>
> {
  const anon = db.asAnon();
  const plan = anon.sql.post
    .select('id', 'title', 'publishedAt', 'authorId')
    .where((f, fns) => fns.isNotNull(f.publishedAt))
    .orderBy((f, dir) => dir.desc(f.publishedAt))
    .limit(20)
    .build();
  return anon.runtime().execute(plan);
}

// ────────────────────────────────────────────────────────────────────────────
// Authenticated read endpoint: the caller's own profile.
// ────────────────────────────────────────────────────────────────────────────
// DESIGN HOLE #13: when does the JWT get validated? Eager (here, on
// db.asUser(jwt)) or lazy (on first query)? Eager fails fast; lazy defers
// failure to query time. Lean eager.
export async function getMyProfile(
  ctx: RequestContext,
): Promise<{ id: string; username: string; bio: string | null } | null> {
  if (!ctx.jwt) throw new HttpError(401, 'Missing JWT');
  const authed = db.asUser(ctx.jwt);
  // No explicit WHERE — RLS filters to the caller's own profile via
  // (auth.uid() = user_id). The query returns at most one row by RLS.
  const plan = authed.sql.profile.select('id', 'username', 'bio').limit(1).build();
  const rows = await authed.runtime().execute(plan);
  return rows[0] ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Authenticated write endpoint: create a post for the caller.
// ────────────────────────────────────────────────────────────────────────────
// DESIGN HOLE #11: multi-statement atomicity. This handler reads the caller's
// profile, then inserts a post. Both should be in the same transaction (so the
// SET LOCAL role + JWT claims are consistent and the read-then-write is
// atomic). The current `db.asUser(jwt)` API has no obvious way to scope a
// multi-statement flow.
//
// Sketched solution: db.asUser(jwt).transaction(async (tx) => { ... })
// where `tx` is itself a role-bound Db that pins to one connection /
// transaction across the closure. Document the shape.
//
// DESIGN HOLE #14: implicit transaction for SET LOCAL. `SET LOCAL` requires a
// transaction. Each single-statement asUser(jwt).runtime().execute(plan) call
// must open one implicitly (or the SET LOCAL leaks to the next pool checkout
// — RLS bypass footgun).
export async function createPost(
  ctx: RequestContext,
  input: { title: string; body: string },
): Promise<{ id: string; createdAt: Date }> {
  if (!ctx.jwt) throw new HttpError(401, 'Missing JWT');

  // Working assumption pending DESIGN HOLE #11 resolution:
  return db.asUser(ctx.jwt).transaction(async (tx) => {
    const profilePlan = tx.sql.profile.select('id').limit(1).build();
    const [profile] = await tx.runtime().execute(profilePlan);
    if (!profile) throw new HttpError(404, 'Profile not found');

    const insertPlan = tx.sql.post
      .insert({
        authorId: profile.id,
        title: input.title,
        body: input.body,
      })
      .returning('id', 'createdAt')
      .build();
    const [row] = await tx.runtime().execute(insertPlan);
    return row;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Service-role admin endpoint: hard-delete a user's profile (and cascade-drop
// their posts). Bypasses RLS because the service_role has BYPASSRLS in the
// standard Supabase role grants.
// ────────────────────────────────────────────────────────────────────────────
// Trust boundary note: this handler MUST be called only from a trusted code
// path (server-side admin, never from a user request directly). The runtime
// can't enforce this — it's a deployment-level concern. Document loudly.
export async function adminDeleteProfile(userId: string): Promise<void> {
  const admin = db.asServiceRole();
  const plan = admin.sql.profile
    .delete()
    .where((f, fns) => fns.eq(f.userId, userId))
    .build();
  await admin.runtime().execute(plan);
}

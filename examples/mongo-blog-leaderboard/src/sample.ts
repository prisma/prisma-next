import { acc } from '@prisma-next/mongo-query-builder';
import type { Db } from './db';

type Runtime = Awaited<ReturnType<Db['runtime']>>;

/**
 * Doubled-up demo of the typed `lookup()` surface — same query as
 * `getAuthorLeaderboard` in `queries.ts`, but with deliberate typos in
 * the `on(...)` callback annotated with `// @ts-expect-error` so the
 * file fails to typecheck if the typed-lookup guards regress.
 *
 * Each `@ts-expect-error` corresponds to one of the AC-1 acceptance
 * criteria in the typed-mongo-lookup spec:
 *   - `local._idxx`  → AC-1 / TC-1 (bad local field rejected)
 *   - `foreign._idxx` → AC-1 / TC-2 (bad foreign field rejected)
 *
 * Bad-`from('usexxxrs')` typo rejection is intentionally **not**
 * demonstrated here — that is a pre-existing limitation of
 * `Contract.roots: Record<string, string>` shared with today's
 * `mongoQuery.from('badname')` baseline, deferred to TML-2400.
 */
export async function getAuthorLeaderboardWithTypos(db: Db, runtime: Runtime) {
  const leaderboard = db.query
    .from('posts')
    .group((f) => ({
      _id: f.authorId,
      postCount: acc.count(),
      latestPost: acc.max(f.createdAt),
    }))
    .sort({ postCount: -1 })
    .lookup((from) =>
      from('users')
        .on((local, foreign) => ({
          // @ts-expect-error AC-1 TC-1: '_idxx' is not a field on the post group's shape
          local: local._idxx,
          // @ts-expect-error AC-1 TC-2: '_idxx' is not a field on the User row shape
          foreign: foreign._idxx,
        }))
        .as('author'),
    )
    .build();

  return runtime.execute(leaderboard);
}

import { Suspense } from 'react';
import type { VerifyMode } from '../lib/db';
import { PostsWithAuthors } from '../server-components/posts-with-authors';
import { RecentPostsRaw } from '../server-components/recent-posts-raw';
import { SimilarPostsSample } from '../server-components/similar-posts-sample';
import { TopUsers } from '../server-components/top-users';
import { UserKindBreakdown } from '../server-components/user-kind-breakdown';
import { CreatePostForm } from './create-post-form';
import { DiagPanel } from './diag-panel';

/**
 * Shared page body for `/`, `/stress/always`, and `/stress/pool-pressure`.
 *
 * All three routes render the same five parallel Server Components plus the
 * Server Action form and the diagnostics panel; what differs is the
 * `(verifyMode, poolMax)` pair they pass to `getDb(...)`. Each unique pair
 * gets its own runtime singleton in the `lib/db` registry, so the three
 * routes never share a runtime and never contaminate each other's counters.
 *
 * Layout rules:
 * - Each Server Component is wrapped in its own `<Suspense>` so React
 *   schedules them concurrently and a slow one doesn't block the others.
 * - The Server Action form and the diag panel live outside the grid. The
 *   form is a client component; the diag panel is a Server Component
 *   whose staleness caveats are documented on the component itself.
 *
 * Props are passed through to every Server Component untouched — no
 * branching on route in this file, no target-specific knobs (consistent
 * with the repo's "no target branches, use adapters" rule).
 */
export interface ParallelReadsPageProps {
  /**
   * Verification mode for the shared runtime. `/` uses `onFirstUse` (default
   * of `@prisma-next/postgres`); `/stress/always` uses `always`.
   */
  readonly verifyMode: VerifyMode;
  /**
   * Max pg pool size. `/stress/pool-pressure` pins this to a small value
   * (e.g. 5) to exercise hypothesis H4; the other routes use the default.
   */
  readonly poolMax?: number;
  /**
   * Short human-readable label describing what this route is for. Rendered
   * at the top of the page so the browser tab makes sense when multiple
   * are open side-by-side during manual testing.
   */
  readonly heading: string;
  /**
   * One-line explanation of the route's purpose. Rendered under the heading.
   */
  readonly subtitle: React.ReactNode;
}

export function ParallelReadsPage({
  verifyMode,
  poolMax,
  heading,
  subtitle,
}: ParallelReadsPageProps) {
  return (
    <>
      <h1>{heading}</h1>
      <p className="muted">{subtitle}</p>
      <p className="muted">
        <a href="/">/</a> &middot; <a href="/stress/always">/stress/always</a> &middot;{' '}
        <a href="/stress/pool-pressure">/stress/pool-pressure</a> &middot; <a href="/diag">/diag</a>
      </p>

      <div className="grid">
        <Suspense fallback={<LoadingCard title="Top users" />}>
          <TopUsers verifyMode={verifyMode} poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Posts with authors" />}>
          <PostsWithAuthors verifyMode={verifyMode} poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Recent posts (SQL DSL)" />}>
          <RecentPostsRaw verifyMode={verifyMode} poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="User kind breakdown" />}>
          <UserKindBreakdown verifyMode={verifyMode} poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Similar posts (pgvector)" />}>
          <SimilarPostsSample verifyMode={verifyMode} poolMax={poolMax} />
        </Suspense>

        <CreatePostForm />
      </div>

      <DiagPanel verifyMode={verifyMode} poolMax={poolMax} />
    </>
  );
}

function LoadingCard({ title }: { readonly title: string }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="muted">Loading…</p>
    </div>
  );
}

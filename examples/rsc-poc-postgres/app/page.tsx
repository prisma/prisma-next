import { Suspense } from 'react';
import { CreatePostForm } from '../src/components/create-post-form';
import { DiagPanel } from '../src/components/diag-panel';
import type { VerifyMode } from '../src/lib/db';
import { PostsWithAuthors } from '../src/server-components/posts-with-authors';
import { RecentPostsRaw } from '../src/server-components/recent-posts-raw';
import { SimilarPostsSample } from '../src/server-components/similar-posts-sample';
import { TopUsers } from '../src/server-components/top-users';
import { UserKindBreakdown } from '../src/server-components/user-kind-breakdown';

export const dynamic = 'force-dynamic';

const VERIFY_MODE: VerifyMode = 'onFirstUse';

/**
 * Home page — five parallel Server Components querying through one shared
 * Prisma Next runtime, plus one Server Action.
 *
 * ## Why this layout
 *
 * Each of the five `<Component />` elements below is an `async` Server
 * Component. React Server Components kicks off each child's render as it
 * evaluates this JSX tree, so the five queries start concurrently on Node's
 * event loop. They share the single runtime returned by `getDb({ verifyMode:
 * 'onFirstUse' })`, which is the exact configuration the PoC is designed to
 * observe:
 *
 * - Hypothesis H1 (Collection cache race): five concurrent first-accesses
 *   to different models (User, Post) exercise the ORM Proxy's lazy cache.
 *   Expected: no observable effect — the `get` trap is synchronous.
 *
 * - Hypothesis H2 (redundant marker reads on cold start): because
 *   `verify.mode === 'onFirstUse'`, each of the five components' first
 *   query on a cold runtime can race through `verifyPlanIfNeeded()`
 *   before any of them flips `verified` to true. Expected: up to five
 *   marker reads visible in `<DiagPanel />` on the first page load after
 *   process start.
 *
 * - Hypothesis H4 (pool pressure): five concurrent components each borrow
 *   a pool connection for the duration of their render. With the default
 *   `poolMax = 10` there's plenty of headroom; the `pool-pressure` k6
 *   scenario forces contention with a small pool.
 *
 * Each component is wrapped in `<Suspense>` so a slow one doesn't block
 * the others from streaming their HTML. This also makes the parallelism
 * observable in the browser waterfall.
 *
 * ## What this page is NOT
 *
 * Not a general demo app. No styling beyond the PoC minimum, no fancy
 * data shapes, no error boundaries beyond React defaults. The goal is
 * to make the concurrency behavior legible, not to build a showcase.
 */
export default function Home() {
  return (
    <>
      <h1>RSC Concurrency PoC — Postgres</h1>
      <p className="muted">
        Five parallel Server Components sharing one Prisma Next runtime. Verify mode:{' '}
        <code>{VERIFY_MODE}</code>. <a href="/stress/always">Switch to /stress/always (H3)</a>.
      </p>

      <div className="grid">
        <Suspense fallback={<LoadingCard title="Top users" />}>
          <TopUsers verifyMode={VERIFY_MODE} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Posts with authors" />}>
          <PostsWithAuthors verifyMode={VERIFY_MODE} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Recent posts (SQL DSL)" />}>
          <RecentPostsRaw verifyMode={VERIFY_MODE} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="User kind breakdown" />}>
          <UserKindBreakdown verifyMode={VERIFY_MODE} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Similar posts (pgvector)" />}>
          <SimilarPostsSample verifyMode={VERIFY_MODE} />
        </Suspense>

        <CreatePostForm />
      </div>

      <DiagPanel verifyMode={VERIFY_MODE} />
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

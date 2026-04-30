import { Suspense } from 'react';
import { EventTypeStats } from '../server-components/event-type-stats';
import { OrdersWithUser } from '../server-components/orders-with-user';
import { ProductList } from '../server-components/product-list';
import { ProductsBySearch } from '../server-components/products-by-search';
import { SearchEvents } from '../server-components/search-events';
import { CreateEventForm } from './create-event-form';
import { DiagPanel } from './diag-panel';

/**
 * Shared page body for `/` and `/stress/pool-pressure`.
 *
 * Both routes render the same five parallel Server Components plus the
 * Server Action form and the diagnostics panel; what differs is the
 * `poolMax` they pass to `getDb(...)`. Each unique `poolMax` gets its
 * own Mongo runtime singleton in the `lib/db` registry, so the two
 * routes never share a runtime and never contaminate each other's
 * counters.
 *
 * Layout rules (same as the Postgres app):
 *
 * - Each Server Component is wrapped in its own `<Suspense>` so React
 *   schedules them concurrently and a slow one doesn't block the others.
 * - The Server Action form and the diag panel live outside the grid of
 *   read-only cards. The form is a client component; the diag panel is
 *   a Server Component whose staleness caveats are documented on the
 *   component itself.
 *
 * Props are passed through to every Server Component untouched — no
 * branching on route in this file, consistent with the repo's "no
 * target branches, use adapters" rule.
 *
 * Contrast with the Postgres app's `ParallelReadsPage`:
 *
 * - No `verifyMode` dimension: `MongoRuntimeImpl` has no verification
 *   state (hypothesis H5), so there's nothing to toggle.
 * - No `/stress/always` link: the always-mode route doesn't exist on
 *   the Mongo side for the same reason.
 */
export interface ParallelReadsPageProps {
  /**
   * Max size of the Mongo driver's internal connection pool
   * (`maxPoolSize` on `MongoClient`). `/stress/pool-pressure` pins a
   * small value (e.g. 5) to exercise hypothesis H4; `/` uses the
   * default.
   */
  readonly poolMax?: number | undefined;
  /**
   * Short human-readable label describing what this route is for.
   * Rendered at the top of the page so the browser tab makes sense
   * when multiple are open side-by-side during manual testing.
   */
  readonly heading: string;
  /**
   * One-line explanation of the route's purpose. Rendered under the
   * heading.
   */
  readonly subtitle: React.ReactNode;
}

export function ParallelReadsPage({ poolMax, heading, subtitle }: ParallelReadsPageProps) {
  return (
    <>
      <h1>{heading}</h1>
      <p className="muted">{subtitle}</p>
      <p className="muted">
        <a href="/">/</a> &middot; <a href="/stress/pool-pressure">/stress/pool-pressure</a>{' '}
        &middot; <a href="/diag">/diag</a>
      </p>

      <div className="grid">
        <Suspense fallback={<LoadingCard title="Products" />}>
          <ProductList poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Orders with users" />}>
          <OrdersWithUser poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Products by search (query builder)" />}>
          <ProductsBySearch poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Event type breakdown" />}>
          <EventTypeStats poolMax={poolMax} />
        </Suspense>

        <Suspense fallback={<LoadingCard title="Recent searches (polymorphism)" />}>
          <SearchEvents poolMax={poolMax} />
        </Suspense>

        <CreateEventForm />
      </div>

      <DiagPanel poolMax={poolMax} />
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

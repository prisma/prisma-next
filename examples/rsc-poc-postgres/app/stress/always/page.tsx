import { ParallelReadsPage } from '../../../src/components/parallel-reads-page';

export const dynamic = 'force-dynamic';

/**
 * `/stress/always` — same page body as `/`, but pinned to
 * `verify.mode === 'always'`.
 *
 * Purpose: confirm the revised H3 invariant under concurrency. In `always`
 * mode, `verifyPlanIfNeeded()` unconditionally sets `this.verified = false`
 * at entry and immediately checks it on the same synchronous tick, so the
 * early-return is unreachable and every execution must issue its own marker
 * read. Under K concurrent queries the expected observation is:
 *
 *     markerReads === queryCount  (one marker read per execute)
 *
 * This is the invariant the k6 `spike` scenario stresses and the
 * integration test pins.
 *
 * ## Why a separate runtime from `/`
 *
 * `getDb({ verifyMode: 'always' })` returns a distinct singleton from
 * `getDb({ verifyMode: 'onFirstUse' })` — the registry in `lib/db` keys by
 * `(verifyMode, poolMax)`. This isolation matters: if the two routes
 * shared a runtime, `onFirstUse` traffic would leave `verified = true`
 * and the first `always` request after it would still do its verify
 * (reset flips false) but the per-route semantics would be muddled in the
 * findings write-up. Keeping them separate preserves apples-to-apples.
 *
 * ## Why no routes-wide layout
 *
 * Each stress route renders the same `<ParallelReadsPage />` body; the only
 * differences are the props. We don't introduce a Next.js layout because
 * the route group itself (`app/stress/`) has no shared UI chrome beyond
 * the already-shared root layout.
 */
export default function StressAlwaysPage() {
  return (
    <ParallelReadsPage
      verifyMode="always"
      heading="RSC Concurrency PoC — /stress/always"
      subtitle={
        <>
          Same five parallel Server Components as <code>/</code>, but the shared runtime is pinned
          to <code>verify.mode === 'always'</code>. Expected invariant:{' '}
          <code>markerReads === queryCount</code>. This is the route that probes hypothesis{' '}
          <strong>H3</strong> (revised — no correctness bug predicted).
        </>
      }
    />
  );
}

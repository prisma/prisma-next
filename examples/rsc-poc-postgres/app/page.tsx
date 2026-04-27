import { ParallelReadsPage } from '../src/components/parallel-reads-page';

export const dynamic = 'force-dynamic';

/**
 * Home route — the default, `onFirstUse` verify mode, default pool size.
 *
 * This is the route that demonstrates hypothesis H2: on cold start, five
 * parallel Server Components race through `verifyPlanIfNeeded()` and each
 * one issues its own marker read before any of them flips `verified` to
 * true. Reload the page or read `/diag` after it settles to observe the
 * 5 redundant marker reads.
 *
 * See `src/components/parallel-reads-page.tsx` for the shared body used
 * by `/`, `/stress/always`, and `/stress/pool-pressure`.
 */
export default function Home() {
  return (
    <ParallelReadsPage
      verifyMode="onFirstUse"
      heading="RSC Concurrency PoC — Postgres"
      subtitle={
        <>
          Five parallel Server Components sharing one Prisma Next runtime. Verify mode:{' '}
          <code>onFirstUse</code>. This is the route that demonstrates hypothesis{' '}
          <strong>H2</strong> — redundant marker reads on cold start.
        </>
      }
    />
  );
}

import { ParallelReadsPage } from '../src/components/parallel-reads-page';

export const dynamic = 'force-dynamic';

/**
 * Home route — default `poolMax` (100, the Mongo driver default).
 *
 * Mongo counterpart to the Postgres app's `/`. There is no `verifyMode`
 * dimension here because `MongoRuntimeImpl` has no verification state
 * (hypothesis H5 in the project plan) — that's the whole reason the
 * Mongo app exists: it's the baseline that makes the Postgres-side
 * H2/H3 behavior stand out as SQL-runtime-specific rather than
 * inherent to the PoC's architecture.
 *
 * See `src/components/parallel-reads-page.tsx` for the shared body
 * used by `/` and `/stress/pool-pressure`.
 */
export default function Home() {
  return (
    <ParallelReadsPage
      heading="RSC Concurrency PoC — Mongo"
      subtitle={
        <>
          Five parallel Server Components sharing one Prisma Next Mongo runtime. Default driver pool
          (<code>maxPoolSize: 100</code>). No verify-mode analogue exists on the Mongo side — the
          runtime has no verification state, which is the whole point of running this app alongside
          the Postgres one.
        </>
      }
    />
  );
}

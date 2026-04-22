import { DiagPanel } from '../src/components/diag-panel';
import { getDb } from '../src/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Placeholder home page — proves the harness boots and that the Prisma Next
 * runtime singleton, `InstrumentedPool`, and `<DiagPanel />` hang together.
 *
 * The five parallel Server Components (H1–H4 scenarios) land in step 3 of
 * the project plan; this scaffold is deliberately boring.
 */
export default async function Home() {
  const db = getDb();
  const users = await db.orm.User.take(1).all();
  const sample = users[0];

  return (
    <>
      <h1>RSC Concurrency PoC — Postgres</h1>
      <p className="muted">
        Scaffold only. The five parallel Server Components arrive in the next PR; see{' '}
        <code>projects/rsc-concurrency-safety/plan.md</code> for the breakdown.
      </p>

      <div className="grid">
        <div className="card">
          <h2>Smoke check</h2>
          {sample ? (
            <p>
              Fetched user <code>{sample.id}</code> ({sample.email}) via the ORM client in a Server
              Component.
            </p>
          ) : (
            <p className="muted">
              No users yet — run <code>pnpm db:init</code> and <code>pnpm seed</code>.
            </p>
          )}
        </div>

        <div className="card">
          <h2>Next up</h2>
          <ul>
            <li>5 parallel Server Components (ORM, SQL DSL, include, aggregate, pgvector)</li>
            <li>
              <code>/stress/always</code> — reproduces hypothesis H3
            </li>
            <li>One Server Action (smoke-level)</li>
            <li>k6 scripts: baseline, spike, pool-pressure</li>
            <li>
              Integration test asserting <code>marker reads == query count</code> in{' '}
              <code>always</code> mode
            </li>
          </ul>
        </div>
      </div>

      <DiagPanel verifyMode="onFirstUse" />
    </>
  );
}

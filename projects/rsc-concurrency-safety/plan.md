# RSC Concurrency Safety PoC — Plan

**Linear:** [TML-2164](https://linear.app/prisma-company/issue/TML-2164/rsc-concurrency-safety-poc)
**Milestone:** VP3 of WS3 (Runtime pipeline)
**Project branch:** `tml-2164-rsc-concurrency-safety-poc`
**Status:** Shaping — draft plan, pending team validation.

This file is the **project plan**. The project spec (`spec.md`) will be
written once the plan is validated; for now the ticket + this plan define
scope.

---

## 1. Objective

Determine whether Prisma Next's runtime and ORM client behave correctly when
multiple React Server Components query through a **shared** instance under
Next.js App Router concurrent rendering.

Stop condition (from the ticket): the PoC either works correctly **or** we've
identified the specific concurrency issues and know what to fix. Pool sizing
guidance, edge runtime validation, and production-ready concurrency
guarantees are explicitly **out of scope** — those are May.

## 2. Hypotheses (what we expect to find)

These come from reading the source, not from running anything. The PoC
confirms or refutes them.

### H1 — Collection cache race is a non-issue
The `orm()` Proxy in `packages/3-extensions/sql-orm-client/src/orm.ts` has a
**synchronous** `get` trap: construct `Collection`, store in `Map`, return.
No `await` inside the trap, so concurrent first-access cannot interleave on
Node's event loop. The worst case is redundant work, which is impossible
because the trap is a single microtask-free path.

**Expected outcome:** PoC confirms. No bug to fix.

### H2 — `verified` / `startupVerified` in `onFirstUse` and `startup` modes: bug, but not a correctness bug
In `RuntimeCoreImpl.verifyPlanIfNeeded` (runtime-executor), the flag flips
monotonically `false → true`. Concurrent cold-start queries can each fire
their own marker-read roundtrip before the first one lands (`await` between
the `if (this.verified) return` check and the `this.verified = true` write).
The operations are idempotent and all succeed against the same marker, so
results are correct — but up to N-1 of those roundtrips are wasted work
that a user would (rightly) file a bug against.

**Expected outcome:** N redundant marker reads on cold start, observable via
telemetry. Results are correct; the wasted roundtrips are a real bug worth
fixing (dedupe in-flight verification via a shared promise). Severity:
low-to-moderate, not a correctness violation.

### H3 — `verified` / `startupVerified` in `always` mode: **likely a non-issue** (revised)

Original claim: under concurrent execution, one query flips
`this.verified = true` between another query's `this.verified = false`
reset and its own `if (this.verified) return` check, causing the second
query to skip verification.

Re-reading `verifyPlanIfNeeded` against the proposed interleaving, the
claim doesn't hold:

```ts
private async verifyPlanIfNeeded(_plan: ExecutionPlan): Promise<void> {
  if (this.verify.mode === 'always') {
    this.verified = false;          // (1) unconditional reset
  }
  if (this.verified) {              // (2) synchronous check on same tick
    return;
  }
  ...
  await driver.query(...)            // (3) first await
  ...
  this.verified = true;
}
```

Lines (1) and (2) are synchronous; there is no `await` between them. In
`always` mode every entry *unconditionally* sets `verified = false` and
then immediately checks it, so the early-return at (2) is unreachable in
`always` mode regardless of what any concurrent caller does to the flag.
The flag can be flipped by a peer between (2) and (3) or between (3)
and the final `this.verified = true`, but `always` mode doesn't read it
again on this path — it just proceeds to verify.

**Revised expected outcome:** `markerReads === queryCount` under
concurrency in `always` mode. No skipped verifications, no correctness
bug. The `/stress/always` route and its integration test become an
**invariant test** (lock in the expected equality) rather than a
regression reproducer.

If the test surprisingly fails under real load — e.g. the interleaving
produces some other skip I didn't anticipate — update this hypothesis
and the findings doc accordingly. Part of the PoC's value is that
running the code tells us what reading the code can't.

### H4 — Connection pool pressure is a sizing/liveness concern, not a safety bug
5 parallel Server Components × N concurrent requests contend for the pg
pool. Expected symptoms: tail-latency cliff when `concurrency × components >
pool size`; possible deadlock if a request holds a connection while waiting
for another. We measure, we don't fix (pool sizing guidance is May).

### H5 — Mongo stack has none of the hazards in H2/H3
Source-level audit:
- `MongoRuntimeImpl` (`packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`):
  no verification state, no markers — nothing to race on.
- `mongoOrm()` (`packages/2-mongo-family/5-query-builders/orm/src/mongo-orm.ts`):
  **eagerly** constructs all collections in a `for` loop at init time — no
  lazy cache.

So the Mongo app is **not** re-running the same experiment. Its value in
this PoC:
- Coverage of a second family under RSC concurrency at all.
- Baseline: if Postgres shows redundant marker reads on cold start and Mongo
  shows nothing analogous, that **localizes** the issue to the SQL runtime.
- Mongo driver pool behavior under RSC concurrency (genuinely different
  question from pg pool behavior).

The plan calls out in the findings doc that the two apps are probing
different things on purpose.

## 3. Deliverables

### 3.1 Two Next.js 16 App Router apps

Note on revised H3 (see §2): the `/stress/always` route and associated
test below were originally designed to **reproduce** a predicted race.
After re-reading the source, the race doesn't hold. The route and test
are kept as-is because they still have value — they lock in the
equality `markerReads === queryCount` as an invariant, and they provide
the direct apples-to-apples comparison to the onFirstUse path (which
*does* exhibit the benign H2 behavior). Treat them as invariant
confirmations, not race reproducers.

Both live under `examples/` so they survive project close-out.

```
examples/rsc-poc-postgres/     # Postgres + pg pool + SQL runtime
examples/rsc-poc-mongo/        # Mongo + mongo driver + mongo runtime
```

Each app:
- Next.js 16, App Router, React 19, `export const dynamic = 'force-dynamic'`.
- No Cache Components, no PPR, no `'use cache'` — caching masks the
  behavior we're trying to observe.
- HMR-safe `globalThis` singleton for the Prisma Next runtime/db in
  `src/lib/db.ts`.
- 5 parallel Server Components on `/` covering a **mix** of code paths
  (ORM + SQL DSL + includes + raw reads; see §4).
- `/stress/always` route (Postgres only): same page but with the runtime
  pinned to `verify.mode === 'always'` to confirm the revised H3 —
  `markerReads === queryCount` under concurrency.
- One Server Action (`POST`-style): proves mutations alongside concurrent
  reads don't explode (ticket says reads; we agreed to add one smoke
  action).
- Structured telemetry surfaced to a dev-only `<DiagPanel />` at page
  bottom: marker-read count, verification-fire count, connection-acquire
  count, per-component timings.
- README documenting how to run, what to look at, known-clean /
  known-broken routes.

### 3.2 Load script per app

```
examples/rsc-poc-postgres/scripts/stress.k6.js
examples/rsc-poc-mongo/scripts/stress.k6.js
```

**Tool:** k6.

Scenarios:
- `baseline`: 10 VUs × 30s hitting `/`.
- `spike` (Postgres only): 50 VUs × 30s hitting `/stress/always`, designed
  to reproduce H3 by maximizing async interleaving.
- `pool-pressure`: gradually ramp VUs 1 → 100 against `/` with a small pool
  (`max: 5`) to characterize H4.

Scripts emit JSON summaries we can commit as reference output.

### 3.3 One integration test (Postgres)

`examples/rsc-poc-postgres/test/always-mode-invariant.test.ts`

Asserts the H3 invariant (revised):

> When `verify.mode === 'always'` and K concurrent queries share a runtime,
> the number of verification marker reads **equals** K.

Implemented against the running app's `/diag` endpoint so the assertion
runs against the real pool + real runtime + real RSC rendering, not a
mock. If the invariant holds (expected), the test locks it in as a
regression guard. If it fails, the findings doc gets a new surprise to
document and H3 gets revised again.

Observational output remains the primary deliverable per §3.1; this test
exists specifically to pin the invariant.

### 3.4 Findings doc (final)

During execution: notes live under
`projects/rsc-concurrency-safety/notes.md`.

At close-out: migrate to `docs/reference/rsc-concurrency-findings.md`
covering:
- What we observed on each app under each scenario.
- Whether H1–H5 held.
- Concrete fixes for whatever's broken (or argument for "safe as-is").
- Recommended user-facing pattern (the `globalThis` singleton).
- Explicit list of things deferred to May.

### 3.5 ADR (conditional)

The revised H3 expects no correctness bug in `always` mode, so the most
likely driver of an ADR is now **H2**: the redundant cold-start marker
reads are wasted work that users will file as a bug. A simple fix
(dedupe in-flight verification via a shared promise) resolves it
cleanly. If the PoC confirms H2 and the team agrees on the fix, draft
an ADR under
`projects/rsc-concurrency-safety/adr-draft-verification-dedupe.md` and
migrate to `docs/architecture docs/adrs/` at close-out.

If the PoC turns up something genuinely surprising (e.g. a new race
the source-level re-reading didn't catch), the ADR covers that instead.

## 4. The 5 Server Components (shape)

Postgres app, `/`:
1. `<TopUsers />` — ORM: `db.User.orderBy(...).take(10).all()`
2. `<RecentPosts />` — ORM with include: `db.Post.include('user').take(10).all()`
   (exercises multi-query include dispatch)
3. `<PostsBySearch />` — SQL DSL: `db.sql.post.where(...).select(...).build()`
   then `runtime.execute(plan)`
4. `<UserStats />` — ORM aggregate: `db.User.groupBy(...).aggregate(...)`
5. `<SimilarPosts />` — pgvector similarity search via ORM

Mongo app, `/`: five analogous queries over the retail-store domain
(products / orders / categories). Exact shapes decided during
implementation; the point is "five concurrent reads, varied shapes".

Server Action: `submitFeedback` (Postgres) / `addToCart` (Mongo). One
insert. Invoked manually from a form on `/`; not hit by k6.

## 5. Out of scope

Explicit non-goals so reviewers don't ask:
- Pool sizing guidance (May).
- Edge runtime validation (May).
- Transaction semantics across Server Components (VP1).
- Production-ready concurrency guarantees (May).
- Fixing H3 itself in this PoC, beyond documenting and (if shaped enough)
  an ADR draft. The fix belongs in a follow-on issue under the same VP3.
- Cache Components / PPR / `'use cache'` (would mask the behavior).
- Benchmarks (Side-quest milestone).

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| H3 invariant unexpectedly fails (`markerReads !== queryCount`) | Capture the failing counts and revisit whether there's a newly-identified race or an instrumentation bug. Update H3 and the findings doc. |
| pg driver's own internal serialization hides the race | Inspect `@prisma-next/driver-postgres` to confirm whether queries are serialized per connection; design stress to use N connections. |
| Next.js 16 churn: RSC semantics / caching defaults shift under us during the PoC | Pin a specific Next.js 16 minor; document version in each app's README. |
| "Telemetry counting" conflates retries, middleware hooks, and actual marker reads | Count at the driver level (spy), not at middleware level, for the H3 assertion. |
| Two apps double the maintenance burden | Keep them minimal; no shared UI kit; copy-paste over abstraction. |

## 7. Work breakdown & sequencing

Each bullet is a candidate PR. Branches off `tml-2164-rsc-concurrency-safety-poc`.

1. **Shaping PR** — this plan + a short `spec.md` under
   `projects/rsc-concurrency-safety/`. Validate with team before starting
   implementation. *(Blocks everything else.)*
2. **Postgres app scaffold** — `examples/rsc-poc-postgres/` with one trivial
   Server Component, `globalThis` singleton, dev-only diag panel, READMEs.
   Reuses `prisma-next-demo`'s contract/schema to avoid re-writing it.
3. **Postgres: 5 Server Components + Server Action** — the actual page.
4. **Postgres: `/stress/always` route + k6 scripts** — confirm the H3
   invariant observationally.
5. **Postgres: integration test for H3 invariant** — assert
   `markerReads === queryCount` in `always` mode under concurrency.
6. **Mongo app scaffold** — `examples/rsc-poc-mongo/`, reusing
   `retail-store`'s contract/seed.
7. **Mongo: 5 Server Components + Server Action + k6 scripts**.
8. **Findings write-up** — `projects/rsc-concurrency-safety/notes.md`
   consolidated; decide whether an ADR is needed based on results.
9. **Close-out PR** — migrate findings to `docs/reference/`, (optionally)
   ADR to `docs/architecture docs/adrs/`, delete
   `projects/rsc-concurrency-safety/`. Apps stay.

Rough sizing (calibration, not a commitment): 1 is hours; 2, 6 are
half-day each; 3, 7 are a day each; 4, 5 are a day total; 8, 9 are a day.
~5 working days assuming no surprises. Surprises are the whole point, so
assume more.

## 8. Open questions (to resolve during spec validation)

- Pool size for `pool-pressure` scenario — `max: 5` is a guess designed to
  force contention quickly. Revisit after first run.

### Resolved during shaping

- **Scope of the shared runtime:** process-scoped (one runtime per Node
  process, held via the `globalThis` HMR-safe singleton pattern). Not
  request-scoped via `cache()`. This matches framework-integration-analysis
  §"Hard problem 2" and is exactly the configuration that exposes H1–H3.
- **Postgres entry point:** use the bundled `@prisma-next/postgres` runtime
  (what `prisma-next-demo` uses). It's the copy-paste path users will take.

## 9. Acceptance criteria

- [ ] Two Next.js 16 apps exist under `examples/rsc-poc-postgres/` and
  `examples/rsc-poc-mongo/`, each with 5 parallel RSC reads + 1 Server
  Action, runnable locally per README.
- [ ] k6 scripts exist and have been run at least once; summaries committed
  under `scripts/` as reference.
- [ ] `/stress/always` either reproduces H3 (confirmed via integration test)
  **or** findings doc explains why it doesn't.
- [ ] Findings doc covers H1–H5 with evidence.
- [ ] Stakeholder (project lead) signs off that VP3's stop condition is
  met.
- [ ] At close-out: findings migrated to `docs/`, (optional) ADR migrated,
  `projects/rsc-concurrency-safety/` deleted.
# RSC Concurrency Safety PoC — Findings

**Linear:** [TML-2164](https://linear.app/prisma-company/issue/TML-2164/rsc-concurrency-safety-poc)
**Milestone:** VP3 of WS3 (Runtime pipeline)
**Source artifacts:**
- Plan: [`projects/rsc-concurrency-safety/plan.md`](./plan.md)
- Postgres app: [`examples/rsc-poc-postgres/`](../../examples/rsc-poc-postgres/)
- Mongo app: [`examples/rsc-poc-mongo/`](../../examples/rsc-poc-mongo/)

This is the **findings write-up** for the PoC. At close-out it migrates
(with minor edits) to `docs/reference/rsc-concurrency-findings.md`.

---

## TL;DR

**Prisma Next's runtime and ORM work correctly under React Server
Components' concurrent rendering model, on both the Postgres and Mongo
families, for the configurations this PoC exercised.** No correctness
bugs were found. One **performance bug** (H2) and one **sizing/liveness
observation** (H4) are documented below with a recommended fix for H2.

The PoC stop condition per the plan — "either works correctly OR we've
identified the specific concurrency issues and know what to fix" — is
met. Pool sizing guidance, edge runtime validation, and production-ready
concurrency guarantees remain out of scope (deferred to May).

---

## What we built

Two Next.js 16 App Router apps, one per family, both running against a
**shared process-scoped Prisma Next runtime** pinned to `globalThis`:

- **`examples/rsc-poc-postgres/`** — Postgres (pgvector), 4 routes (`/`,
  `/stress/always`, `/stress/pool-pressure`, `/diag`), 5 parallel Server
  Components + 1 Server Action + k6 scripts + 6 invariant tests.
- **`examples/rsc-poc-mongo/`** — Mongo, 3 routes (`/`,
  `/stress/pool-pressure`, `/diag`), 5 parallel Server Components + 1
  Server Action + k6 scripts + 9 invariant tests.

Shared design:
- Process-scoped runtime via `globalThis` keyed by
  `(verifyMode, poolMax)` (PG) or `poolMax` (Mongo). Survives Next.js
  HMR in dev; collapses to a plain module-level singleton in production.
- Server Components render in parallel via `<Suspense>` boundaries. No
  Cache Components / PPR / `'use cache'` (caching masks the concurrency
  behavior).
- Structured diagnostic counters backed by `globalThis`, exposed via a
  dev-only `<DiagPanel />` and a `/diag` JSON endpoint.

Diagnostic approach per family:
- **Postgres**: subclassed `pg.Pool` as `InstrumentedPool` to count
  connection acquires (on `connect()` resolve), releases (via the
  pool's `'release'` event), and marker reads (by matching
  `prisma_contract.marker` in client SQL).
- **Mongo**: attached `CMAP` (connection monitoring) and `APM` (command
  monitoring) event listeners to `MongoClient` before `connect()`. No
  subclassing because `MongoClient` isn't designed for it.

---

## Per-hypothesis findings

### H1 — ORM Collection cache race: **non-issue**

**Prediction:** The `Map`-backed Collection cache in `orm()` might race
on concurrent first-access from parallel Server Components.

**Source-level re-read:** The Proxy's `get` trap in
`packages/3-extensions/sql-orm-client/src/orm.ts` is fully synchronous:
construct `Collection`, store in `Map`, return. No `await` inside. On
Node's event loop, synchronous code cannot interleave, so the trap is
race-free by construction.

**Observed:** No errors or duplicate-construction bugs across thousands
of concurrent requests in either app's baseline scenario. Nothing
observable to report.

**Verdict:** **Safe as-is.** No fix needed.

---

### H2 — Redundant cold-start marker reads (`onFirstUse` / `startup`): **bug, non-critical, recommend fixing**

**Prediction:** Concurrent cold queries race through
`RuntimeCoreImpl.verifyPlanIfNeeded()` before any of them flips
`verified = true`, each issuing its own marker-read round-trip.

**Source:** In `packages/1-framework/4-runtime/runtime-executor/src/runtime-core.ts`,
`verifyPlanIfNeeded()` reads the marker table then sets `verified = true`
with an `await` in between. K concurrent callers on a cold runtime all
see `verified === false` at their synchronous entry check, then all
proceed to the marker read. Only after the first one's `await` resolves
and sets `verified = true` do subsequent callers early-return.

**Observed (rsc-poc-postgres, `/` on cold start, 5 parallel Server
Components):**

```
markerReads: 5, connectionAcquires: 11, connectionReleases: 11
```

Exactly 5 marker reads for 5 concurrent first-touch queries.
Subsequent page loads show `markerReads: 5` remaining constant — no
further verification. The pinning invariant test
(`always-mode-invariant.test.ts > H2 cold-start`) asserts
`markerReads ∈ [1, K]` and `markerReads` stays at its post-cold value
on warm bursts.

**Observed (rsc-poc-mongo, `/` on cold start):**

```
commandsStarted: 5, commandsSucceeded: 5, commandsFailed: 0
```

Exactly 5 wire commands — one per Server Component query, no
verification sibling. H5's confirmation.

**Severity:** Low-to-moderate. The bug is wasted work, not incorrect
results. Cold-start cost = `(components_per_page − 1) × marker_read_RTT`,
paid once per runtime lifetime per process. For a dev server with
frequent HMR, or a serverless platform with frequent cold starts, this
is noticeable but not critical. For a long-running server it's a
negligible one-time cost.

**Verdict:** **Real bug, recommend fix.** See "Recommended fix for H2"
below.

---

### H3 — `verify.mode === 'always'` race: **non-issue (revised)**

**Original prediction:** Under concurrency, one query flips
`verified = true` between a peer's `verified = false` reset and its
peer's own `if (verified) return` check, causing the peer to skip
verification.

**Source-level re-read (mid-flight correction):** The claim doesn't
hold. Lines `verified = false` (in `always` mode) and
`if (verified) return` are **synchronous neighbors** with no `await`
between them. Every entry to `verifyPlanIfNeeded()` in `always` mode
unconditionally sets the flag false, then immediately checks it on the
same tick — the early-return is unreachable regardless of peer
behavior. The flag can be flipped by a peer later in the method body,
but `always` mode doesn't read it again on this path.

Plan §2 updated with the corrected reasoning and the retained value of
the `/stress/always` route and test (invariant confirmations rather
than race reproducers).

**Observed (`/stress/always` under 50 VUs × 30s, `k6 spike`):**

```
commandsΔ (ppg path): 266 markerReads, 447 acquires, 447 releases
iterations ≈ 238, effective ~7 queries per completed render
```

The integration test pins the strict form:
`markerReads === queryCount` for K ∈ {1, 5, 50} concurrent queries,
and for K × BURSTS across repeated bursts. All 4 cases pass.

**Verdict:** **Safe as-is.** No race, no skipped verifications. `always`
mode costs one marker round-trip per query, as advertised.

---

### H4 — Connection pool pressure: **sizing/liveness concern, not a safety bug**

**Prediction:** With `components_per_page × concurrent_requests > pool_max`,
requests queue for connections and may time out.

**Observed (rsc-poc-postgres, `/stress/pool-pressure`, ramp 1→100 VUs ×
50s, `poolMax: 5`):**

```
iterations:     15,571 over 50s (~311 req/s)
acquires Δ:     93,431
releases Δ:     93,431     # balanced under saturation
pg timeouts:    0          # with fast queries, queue drains in time
```

**Observed (rsc-poc-mongo, `/stress/pool-pressure`, ramp 1→100 VUs ×
50s, `maxPoolSize: 5`):**

```
iterations:         17,503 over 50s (~350 req/s)
commandsStarted Δ:  87,515
commandsSucceeded Δ: 87,515
commandsFailed Δ:   0          # no waitQueueTimeoutMS breaches
checkOuts Δ = checkIns Δ       # balanced
```

With the PoC's fast queries and small payloads, both drivers sustained
100 VUs × 50s on 5-slot pools without failures. Under slow queries or
heavier payloads, the picture would change — that's explicitly **out of
scope** for this PoC (plan §5). What we learned:

- **Postgres**: each query exclusively borrows a pool connection for
  its lifetime. Ratio of commands to acquires is 1:1.
- **Mongo**: the driver multiplexes commands over a smaller set of
  wire connections. 87,515 commands on a 5-slot pool means heavy
  sharing.

**Verdict:** **No safety bug.** Pool sizing guidance is deferred to May
as explicitly planned.

---

### H5 — Mongo runtime has no H2/H3 analogue: **confirmed**

**Prediction:** `MongoRuntimeImpl` has no verification state and
`mongoOrm()` eagerly builds collections, so the Postgres-side H1/H2/H3
hazards don't apply to the Mongo family.

**Source-level verification:**
- `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`:
  `MongoRuntimeImpl` has no `verified`/`startupVerified` fields, no
  marker reads. Construction → ready.
- `packages/2-mongo-family/5-query-builders/orm/src/mongo-orm.ts`:
  `mongoOrm()` eagerly constructs all collections in a `for` loop over
  `contract.roots` at init time. No lazy Map, no cache.

**Observed (rsc-poc-mongo, `/` baseline, 10 VUs × 30s):**

```
iterations:     14,003 over 30s (~467 req/s)
commandsΔ:      70,015     = exactly 5 × iterations, no multiplier
failedΔ:        0
checkOutsΔ:     70,015 = checkInsΔ
tcpCreatedΔ:    0          # connections reused
```

Compared to the Postgres baseline (`~295 req/s`, 6 acquires per
request): Mongo is ~60% faster and does 1 fewer operation per page —
the missing operation is the marker read the Postgres runtime issues
per first-touch that the Mongo runtime simply doesn't have. The
integration test (`concurrency-invariants.test.ts`) pins this as the
hard invariant: **K concurrent queries → exactly K commands**, not
K × some-multiplier.

**Verdict:** **Confirmed by construction and by measurement.** The
asymmetry is useful as a baseline: it localizes the H2 bug to the SQL
runtime rather than the PoC's architecture.

---

## Per-page operation accounting

Clarified after looking at what the counters actually report. Useful
for anyone cross-referencing the numbers against the source.

### Postgres app, `/` (onFirstUse, default pool)

| Component                    | Pool acquires | Queries | Notes                                       |
|------------------------------|--------------:|--------:|---------------------------------------------|
| `<TopUsers />`               |             1 |       1 | ORM baseline                                |
| `<PostsWithAuthors />`       |             1 |       2 | Parent + include share one `acquireRuntimeScope` |
| `<RecentPostsRaw />`         |             1 |       1 | SQL DSL via `runtime.execute(plan)`         |
| `<UserKindBreakdown />`      |             1 |       1 | Aggregate                                   |
| `<SimilarPostsSample />`     |             2 |       2 | Seed lookup + similarity (separate chains)  |
| **Total per page**           |         **6** |   **7** |                                             |

Observed steady-state: `+6 acquires per request`. Matches.

On cold start with `onFirstUse`, 5 of the 7 queries are the "first
query" of their respective Server Component and race concurrently
through `verifyPlanIfNeeded`. The 2nd queries in components that need
them (`PostsWithAuthors`, `SimilarPostsSample`) are `await`-ed **after**
the first in their component completes, so by the time they run,
`verified = true` and no marker read fires. Hence `5` marker reads,
not 7.

### Mongo app, `/` (default pool)

| Component                   | Commands | Notes                                                                     |
|-----------------------------|---------:|---------------------------------------------------------------------------|
| `<ProductList />`           |        1 | ORM baseline                                                              |
| `<OrdersWithUser />`        |        1 | `include()` becomes a `$lookup` stage in a single aggregate command       |
| `<ProductsBySearch />`      |        1 | Query-builder pipeline via `runtime.execute(plan)`                        |
| `<EventTypeStats />`        |        1 | Aggregate pipeline                                                        |
| `<SearchEvents />`          |        1 | Polymorphism variant → `$match` on discriminator                          |
| **Total per page**          |    **5** |                                                                           |

Observed: `+5 commands per request`. Matches. The Mongo ORM's include
is a single aggregation command (not a second find), which is why the
ratio is 5:5 while Postgres is 6:7.

---

## Recommended fix for H2

**Shape:** Dedupe in-flight verification via a shared promise.

Current code, paraphrased:

```ts
private verified: boolean;

async verifyPlanIfNeeded(plan) {
  if (this.verify.mode === 'always') this.verified = false;
  if (this.verified) return;
  await this.driver.query(markerSql, markerParams);   // ← every concurrent caller runs this
  this.verified = true;
}
```

Proposed change:

```ts
private verified: boolean;
private verifyInFlight: Promise<void> | undefined;

async verifyPlanIfNeeded(plan) {
  if (this.verify.mode === 'always') this.verified = false;
  if (this.verified) return;
  if (this.verifyInFlight) return this.verifyInFlight;   // ← new: join existing work
  this.verifyInFlight = this.runVerify();
  try {
    await this.verifyInFlight;
  } finally {
    this.verifyInFlight = undefined;
  }
}

private async runVerify() {
  // Full existing body of verifyPlanIfNeeded from the marker read
  // onward: driver.query, MARKER_MISSING / MARKER_MISMATCH handling
  // for storageHash and profileHash, and the final
  // this.verified = true / this.startupVerified = true assignments.
  // Omitted here for brevity; see
  // packages/1-framework/4-runtime/runtime-executor/src/runtime-core.ts
  // for the current implementation.
}
```

**Effect:** K concurrent cold-start callers produce 1 marker read, not
K. Subsequent warm calls still skip via the `if (this.verified) return`
fast path. In `always` mode the behavior is unchanged (`verified = false`
happens on the sync entry, then the check fails and every caller
joins/starts its own verify — but the invariant `markerReads === K`
still holds because `always` resets between calls).

Wait — that last claim deserves care. Under `always` mode, if caller A
has set `verifyInFlight` and is mid-flight, caller B arrives, sets
`verified = false` (no-op if already false), skips the early return,
sees `verifyInFlight`, and returns it. Result: B's verify is satisfied
by A's marker read. **That breaks `always` semantics** — B didn't
actually re-verify from its own perspective.

**Refined proposal:** Only dedupe for `onFirstUse` / `startup` modes;
`always` mode keeps its current per-call behavior.

```ts
async verifyPlanIfNeeded(plan) {
  if (this.verify.mode === 'always') {
    this.verified = false;
    // Fall through to non-deduped path below.
  } else {
    if (this.verified) return;
    if (this.verifyInFlight) return this.verifyInFlight;
    this.verifyInFlight = this.runVerify();
    try { await this.verifyInFlight; }
    finally { this.verifyInFlight = undefined; }
    return;
  }
  // always mode path, unchanged:
  await this.driver.query(markerSql, markerParams);
  this.verified = true;
}
```

**Tests to add alongside the fix:**
- H2 test tightens from `markerReads ∈ [1, K]` to `markerReads === 1`
  on cold start.
- New warm-burst test confirms `markerReads` stays at 1 after additional
  bursts.
- H3 `always`-mode tests continue to require `markerReads === K`.

**Implementation lives in:**
`packages/1-framework/4-runtime/runtime-executor/src/runtime-core.ts`,
the `verifyPlanIfNeeded()` method and the fields on `RuntimeCoreImpl`.

**Should this be an ADR?** Borderline. It's a behavior change inside a
single method, backward-compatible (observable only as fewer marker
reads), and doesn't introduce new abstractions. I'd argue it's a PR
with a good commit message, not an ADR. If anyone disagrees, drafting
one is cheap.

---

## Recommended user-facing guidance

### Process-scoped runtime singleton (the HMR-safe pattern)

Both PoC apps use the same pattern in `src/lib/db.ts`:

```ts
const REGISTRY_KEY = Symbol.for('your-app.db.registry');

type DbRegistry = Map<Key, Entry>;

function getRegistry(): DbRegistry {
  const g = globalThis as unknown as { [REGISTRY_KEY]?: DbRegistry };
  let registry = g[REGISTRY_KEY];
  if (!registry) {
    registry = new Map();
    g[REGISTRY_KEY] = registry;
  }
  return registry;
}

export function getDb(options = {}): Client {
  const registry = getRegistry();
  const key = /* derive from options */;
  let entry = registry.get(key);
  if (!entry) {
    entry = createEntry(options);
    registry.set(key, entry);
  }
  return entry.client;
}
```

Why: Next.js dev-mode HMR re-evaluates modules on every edit. A plain
module-level `let` leaks a fresh pool on every save and exhausts
Postgres connection slots within seconds. Pinning to `globalThis` via a
stable `Symbol.for(...)` key survives re-evaluation while still giving
one runtime per Node process in production.

This pattern is ready to promote to `docs/reference/` as the
recommended integration for Next.js users. Mongo and Postgres both
work with the same shape.

### Async `getDb()` on Mongo

Mongo's `getDb()` is `async` because `MongoClient` requires
`await client.connect()` before the runtime can serve requests. Server
Components that call it suspend on the first render and resolve from
the cached entry thereafter. The Postgres equivalent can be sync
because the bundled `@prisma-next/postgres` builds the pool lazily.

### Suspense boundaries per Server Component

Wrapping each parallel Server Component in its own `<Suspense>` makes
the concurrency observable in the browser waterfall and avoids one slow
component gating the others. Not required for correctness, but it's
the configuration users should copy.

---

## What's out of scope but likely next

Following the plan's explicit non-goals:

- **Pool sizing guidance.** Needs load-testing with realistic query
  latencies and payloads, not the PoC's 1 KB seed. "Expected parallel
  components per page × concurrent requests + headroom" is a starting
  heuristic but nothing more.
- **Edge runtime validation.** `InstrumentedPool` uses `pg.Pool` which
  needs Node TCP sockets — can't run on edge. HTTP drivers (Neon HTTP,
  Hyperdrive) need their own PoC. The process-scoped singleton pattern
  still applies.
- **Production-ready concurrency guarantees.** The invariant tests pin
  what the PoC observed; more stress patterns (streaming, long-lived
  cursors, AbortSignal propagation) are uncovered.
- **Transaction semantics across Server Components.** Covered by VP1,
  not this PoC.

---

## Artifacts

- **Integration tests pinning the invariants:**
  - `examples/rsc-poc-postgres/test/always-mode-invariant.test.ts` (6 tests)
  - `examples/rsc-poc-mongo/test/concurrency-invariants.test.ts` (9 tests)
- **k6 stress scripts:**
  - `examples/rsc-poc-postgres/scripts/stress.k6.js` (baseline / spike / pool-pressure)
  - `examples/rsc-poc-mongo/scripts/stress.k6.js` (baseline / pool-pressure)
- **Diagnostic endpoints:**
  - `GET /diag` on each app returns a JSON snapshot of live counters.
- **Draft PR:** [#370](https://github.com/prisma/prisma-next/pull/370)

## Two mid-flight corrections worth remembering

For anyone reading this later who wonders why the plan doesn't match
the first version a reviewer might have seen:

1. **H3 was wrong in the original plan.** The predicted "always mode
   skips verification under concurrency" race doesn't exist — the
   reset and the check are synchronous neighbors. Caught by re-reading
   the source before implementing the stress route. Plan §2 documents
   both the original claim and the correction.

2. **The PoC's pool instrumentation had two bugs of its own**
   (documented in `examples/rsc-poc-postgres/src/lib/pool.ts`):
   - Wrapping `client.release` didn't survive pg-pool's per-checkout
     reassignment of the method. Fixed by listening on the pool's
     `'release'` event.
   - Counting acquires before `super.connect()` resolved inflated the
     counter under connect-timeout rejections. Fixed by counting only
     on success.

   Both were bugs in the measurement, not in Prisma Next or pg-pool.
   Flagging them because they're the kind of thing only live load
   exposes, and future contributors to the PoC should know about them
   before trying similar instrumentation.

---

## Close-out checklist (step 9 of the plan)

- [ ] Migrate this file (lightly edited) to
      `docs/reference/rsc-concurrency-findings.md`.
- [ ] Decide whether the H2 fix needs an ADR. Current recommendation:
      no, just a PR.
- [ ] Strip repo-wide references to
      `projects/rsc-concurrency-safety/**`; replace with canonical
      `docs/reference/rsc-concurrency-findings.md` links or remove.
- [ ] Delete `projects/rsc-concurrency-safety/` in the close-out PR.
- [ ] Update Linear TML-2164 to Done; leave a summary comment
      pointing at the findings doc and the draft PR.
- [ ] Confirm VP3's stop condition met with the project lead.
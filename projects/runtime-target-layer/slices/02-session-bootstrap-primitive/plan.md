## Dispatch plan

One dispatch — a single new protected method plus its unit tests, all in `@prisma-next/sql-runtime`. "Single-package new feature" shape; test-first per the repo rule. One coherent outcome a reviewer holds in one sitting.

### Dispatch 1: executeWithSessionBootstrap + RawSessionConnection + unit tests

- **Outcome:** `SqlRuntime` has a `protected executeWithSessionBootstrap(plan, bootstrap, options?)` that opens an implicit transaction on a freshly-acquired connection, runs `bootstrap` against the transaction's raw connection below the middleware chain, runs the typed query against the same sticky transaction, and commits/rolls back/releases with the same lifecycle discipline as `withTransaction`. Covered by unit tests.
- **Builds on:** slice 1's exported `SqlRuntime` (this branch is stacked on `tml-2878`).
- **Hands to:** a tested below-middleware session-bootstrap primitive for slice 3's `SupabaseRuntime` to call with a `SET LOCAL`-issuing closure.
- **Focus:** the protected method, the narrow `RawSessionConnection` type, and the lifecycle reuse. Per open question 1, **prefer** factoring the acquire→tx→commit/rollback/release/destroy lifecycle out of `withTransaction` into a shared internal helper both call, so correctness lives in one place; faithful-mirror-with-equivalence-test is the fallback only if the refactor proves invasive. Tests use a fake/recording `SqlDriver` to assert connection identity and middleware visibility — no live DB needed. Do NOT touch `RuntimeExecuteOptions`, the public `Runtime` interface, or any Postgres/Supabase code.
- **Completed when:**
  - [ ] Test (tests-first): `bootstrap`'s connection === the typed query's connection (stickiness), via a recording fake driver.
  - [ ] Test: a registered user middleware observes only the typed `execute`, never the bootstrap SQL (below-middleware).
  - [ ] Test: bootstrap-throw and mid-stream-throw both roll back + release/destroy with no commit and no leak; commit-failure path matches `withTransaction` (envelopes `RUNTIME.TRANSACTION_COMMIT_FAILED` / `_ROLLBACK_FAILED`).
  - [ ] `executeWithSessionBootstrap` is `protected`; `RuntimeExecuteOptions` unchanged; public `Runtime` interface unchanged.
  - [ ] Gates (run after `pnpm build` to avoid stale-dist false reds — see learnings.md): `pnpm --filter @prisma-next/sql-runtime typecheck` (incl. test project) green; `pnpm --filter @prisma-next/sql-runtime test` green; `pnpm --filter @prisma-next/sql-runtime lint` clean; `pnpm lint:deps` passes.
- **Implementer tier:** sonnet-mid.

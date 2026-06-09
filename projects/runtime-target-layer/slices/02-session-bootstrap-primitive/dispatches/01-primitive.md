# Dispatch 1 — executeWithSessionBootstrap + RawSessionConnection + tests

Full design + edge cases + done-conditions: the slice spec at
`projects/runtime-target-layer/slices/02-session-bootstrap-primitive/spec.md`. Read it first.

## Task
Add `protected executeWithSessionBootstrap<Row>(plan, bootstrap, options?)` to `SqlRuntime`
(`packages/2-sql/5-runtime/src/sql-runtime.ts`). Open an implicit transaction on a freshly
acquired raw connection; run `bootstrap(view)` where `view: RawSessionConnection` exposes only
`query(sql, params)` backed by the raw `SqlTransaction.query` (BELOW middleware); then run the
typed query via the existing private `this.executeAgainstQueryable(plan, tx, { ...options,
scope: 'transaction' })`; commit on stream drain, roll back on throw/abort, release/destroy with
the SAME discipline as the existing `withTransaction` (~L756). Tests-first.

## Key constraints (from the slice spec)
- Prefer factoring the acquire→tx→commit/rollback/release/destroy lifecycle out of `withTransaction`
  into a shared internal helper both use; faithful-copy-with-equivalence-test only if the refactor is invasive.
- `RawSessionConnection`: narrow — only `query()`. No lifecycle methods leak to the closure.
- Do NOT change `RuntimeExecuteOptions` (stays `{signal?, scope?}`) or the public `Runtime` interface.
  The new method is `protected`. No Postgres/Supabase/SET LOCAL/role/JWT code — target-agnostic.

## Completed when
- [ ] Tests (fake recording `SqlDriver`, no live DB): (1) bootstrap's connection === the typed query's
      connection; (2) user middleware never sees the bootstrap SQL, only the typed execute;
      (3) bootstrap-throw and mid-stream-throw roll back + release/destroy, no commit, no leak;
      commit-failure path matches `withTransaction` envelopes.
- [ ] `executeWithSessionBootstrap` is `protected`; `RuntimeExecuteOptions` + `Runtime` unchanged.
- [ ] Run `pnpm build` FIRST (stale dist gives false reds — see projects/runtime-target-layer/learnings.md), then:
      `pnpm --filter @prisma-next/sql-runtime typecheck` (incl. test project) green;
      `pnpm --filter @prisma-next/sql-runtime test` green; `pnpm --filter @prisma-next/sql-runtime lint` clean;
      `pnpm lint:deps` passes.

## Commit
One commit on branch `tml-2879-session-bootstrap-primitive`, prefix `TML-2879:`, DCO sign-off (Will) +
Co-Authored-By trailer. Stage only the files you changed; do NOT touch `projects/`.

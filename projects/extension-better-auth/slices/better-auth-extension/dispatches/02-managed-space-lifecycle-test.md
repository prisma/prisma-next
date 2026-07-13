# Brief: D2 managed-space-lifecycle-test

## Task

Add integration coverage in `test/integration/` proving the managed extension-space lifecycle end-to-end through public surfaces only: an app whose `prisma-next.config.ts` lists the better-auth pack in `extensionPacks` gets, after `contract emit` + `db init` against a fresh PGlite database, the four tables `user` / `session` / `account` / `verification` created by the space's baseline migration with the declared uniques and FKs; a subsequent `db update` at head is a no-op; space verification is clean. **Property (test-dispatch overlay): each test fails if and only if the behaviour it claims to verify is removed or broken, and exercises it through the right surface** — the framework CLI/migrate path for the lifecycle (no manual SQL, no direct planner invocation where the CLI path is the claim), catalog introspection or public verify surfaces for the "tables exist with the right shape" assertions.

## Scope

**In:** new test file(s) under `test/integration/test/` (follow the naming conventions in `test/integration/README.md`, e.g. `extension-better-auth.lifecycle.test.ts`, plus a `*.helpers.ts` if warranted); any test fixture app config needed under `test/integration/test/fixtures/` (grep for how existing CLI/e2e fixtures wire `extensionPacks` — the `cli-e2e-test-app` fixtures are a starting point); `test/integration/package.json` dev-dep on `@prisma-next/extension-better-auth` (workspace protocol) + lockfile.

**Out:** any change to `packages/3-extensions/better-auth/**` — if the lifecycle test exposes a defect in the D1 artifacts, HALT and surface (that's a finding for the loop, not silent in-dispatch repair); `better-auth` npm packages (D4/D6); `examples/**`; framework packages.

## Completed when

- [ ] New integration test(s) green: fresh PGlite → emit + `db init` creates the four tables (asserted via introspection/catalog or the public verify surface — including `user.email` + `session.token` uniques and the two FKs); `db update` at head reports no-op; verification clean at head.
- [ ] A deliberate-red check was performed during development (e.g. temporarily pointing the fixture at an empty/mismatched space or dropping a table before `db update`) demonstrating the test discriminates — describe what you falsified in the wrap-up (do not commit the red variant).
- [ ] Gates: the new test file(s) pass under `pnpm test:integration` (or the targeted vitest invocation for the file, plus the suite's config compiles); `pnpm typecheck` (must cover `test/integration`); `pnpm --filter @prisma-next/integration-tests lint` (or the package's actual name — verify).

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## References

(You are resumed — you know the D1 artifacts. New context only.)

- Slice plan entry: `plan.md` § D2 — outcome / builds-on D1 / hands-to D6 (`runMigrations` reuses this mechanism).
- Test conventions: `test/integration/README.md`; sibling lifecycle/e2e tests — grep for existing `db init` / `db update` in-process CLI tests (`*.e2e.test.ts` naming note in the README) and for `extensionPacks` fixtures.
- Calibration: F5 (no destructive git ops), F14 (gates mirror CI — typecheck must cover the test project; lint the touched package), dod.md § Test-dispatch brief overlay (the "fails iff" criterion above), F13 (a boundary/scoping regression test must discriminate — hence the deliberate-red check).

## Operational metadata

- **Model tier:** mid — pattern-following test work against a shipped surface.
- **Time-box:** 60 min. Overrun → halt with snapshot.
- **Halt conditions:** the lifecycle path fails due to a defect in D1's shipped artifacts (surface, don't repair in-dispatch); the CLI path can't run in-process/hermetically against PGlite without framework changes; diff exceeds ~12 files.
- **Progress notes:** append to `wip/heartbeats/implementer.txt` at phase transitions.

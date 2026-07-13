# Brief: D6 conformance-and-e2e-integration

## Task

Prove the adapter against BetterAuth's own bar and the real consumer path, in `test/integration/`: (1) run BetterAuth's official adapter conformance suite (`@better-auth/test-utils/adapter` — `testAdapter` + the shipped test suites, including its join coverage with the native join path enabled) against `prismaNextAdapter` over PGlite, with `runMigrations` implemented via the framework migrate mechanism from D2 (no manual SQL, no ORM-side DDL); (2) an end-to-end test driving `betterAuth()` itself — email/password sign-up → session retrieval through the auth API — over the adapter and a PGlite-backed db. **Property: the suites fail iff adapter conformance or the real `betterAuth()` consumer path breaks.** AC-1 of the slice closes on this dispatch.

## Scope

**In:** new files under `test/integration/test/` (+ helpers/fixtures as warranted); `test/integration/package.json` dev-deps (`better-auth`, `@better-auth/test-utils` — version-aligned with the package's `^1.6` dev pin; promote both to a catalog entry if you judge the duplication warrants it, note the choice); lockfile.

**Out:** `packages/3-extensions/better-auth/**` and the contract space — defects found there are findings for the loop (halt and surface with the failing conformance case), EXCEPT the two pre-authorized carry-overs below, which you may implement here if — and only if — the conformance suite actually demands them:
- **Carry-over 1 (D4):** `Where.mode: 'insensitive'` — if conformance exercises case-insensitive matching, resolve it (adapter-side, e.g. `ilike` if the ORM comparator exists on inspection, else surface).
- **Carry-over 2 (D5):** reverse joins (one-to-many, e.g. `user → sessions`) — if conformance join coverage requires them, this is a contract-space change (add backrelations to the space's PSL + re-emit + handles/consistency updates) — implement as its own commit, flagged in the report.

## Completed when

- [ ] The official conformance suites run green over PGlite in a file matched by `pnpm test:integration`, with native joins enabled (`experimental.joins` or the suite's equivalent) and `runMigrations` using the framework path.
- [ ] The `betterAuth()` e2e test signs up a user via the auth API, retrieves the session, and asserts the persisted rows landed in the contract-space tables (catalog or collection read) — fails iff the consumer path breaks.
- [ ] Gates: `pnpm test:integration` (full suite — this dispatch's bar, per plan), `pnpm typecheck`, integration package lint, workspace `pnpm test:packages` (regression sweep).

## Standing instruction

Stay focused on the goal; control scope. Carry-overs only under the conditions above, own commits, flagged. Anything else that pulls at the adapter or space halts and surfaces.

## References

(Resumed — new context only.)

- Slice plan § D6 (incl. both carry-overs); D2's lifecycle mechanism (`runMigrations` reuse); your D5 notes (Collection #-private spy binding; `experimental.joins`; factory transaction fallback semantics).
- BetterAuth testing docs: https://www.better-auth.com/docs/guides/create-a-db-adapter § "Test your adapter" (`testAdapter`, `createTestSuite`, `runMigrations`, `onFinish`) — installed `@better-auth/test-utils` types are authoritative over docs.
- Reviewer watch item from D5: join mode delegates `select` handling to the factory's output transform — confirm conformance covers select+join combinations; a gap there is a finding.
- Calibration: F5, F14 (this dispatch's gate is the FULL integration suite + packages sweep), F13/test-overlay, F24/F25 (a red that looks pre-existing must be verified against pristine main before being claimed as such).

## Operational metadata

- **Model tier:** mid — harness integration against a complete adapter; judgment escalates via carry-over rules.
- **Time-box:** 2 h. Overrun → halt with snapshot.
- **Halt conditions:** a conformance failure whose fix falls outside the two pre-authorized carry-overs; `@better-auth/test-utils` requires vitest-version or environment features the integration package can't provide; the suite demands schema mutations the managed space can't express; diff exceeds ~15 files excluding lockfile.
- **Progress notes:** heartbeats at phase transitions; this dispatch runs long suites — ping before/after each.

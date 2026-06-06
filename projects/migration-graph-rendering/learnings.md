# Learnings — migration-graph-rendering

> Orchestrator-maintained working ledger of patterns surfaced during this run (foot-guns, escapees, severity calibrations, classes of bug the spec didn't cover). Reviewed at close-out; cross-cutting lessons migrate to durable docs, project-local ones drop with the project folder.

## `@prisma-next/cli` runs vitest `isolate: false` — "passes locally" ≠ "passes in CI"

The cli package's vitest config (`isolate: false`, `fileParallelism: false`) lets module mocks (notably `config-loader`/`loadConfig`) bleed across test files. A test that forgets to mock `config-loader` itself can pass locally by inheriting a leaked mock from a neighbouring file, then fail deterministically in CI's different file ordering with `errorConfigFileNotFound` (real `loadConfig` runs, no config file in cwd). Hit in `migration-status-missing-db.test.ts` (read-command-consistency slice, D2): green locally, red in CI #726.

**Rules going forward:**
- Every cli command test that drives a command through `loadConfig` MUST set up its own config-loader state (mock returning the intended config, or a real fixture dir with a config file) — never rely on ambient mock state. Pair with file-level `afterAll(() => { vi.doUnmock('../../src/config-loader'); vi.resetModules(); })` so it doesn't pollute neighbours either.
- "Reproduces on the base tree" / "full suite passed N×" are NOT sufficient evidence a failure is pre-existing/independent when `isolate:false` is in play — favorable ordering masks both directions. Validate under CI file-ordering (the actual failing combination) before declaring a failure "not ours." The orchestrator made this error: trusted local green + implementer claims and shipped a PR whose CI was red on our own tests.


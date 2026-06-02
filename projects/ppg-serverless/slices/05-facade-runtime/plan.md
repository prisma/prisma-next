# Slice 5 — Dispatch plan

Slice spec: [`./spec.md`](./spec.md)

## Sizing rationale

One logical state: "facade `runtime()` works through a mocked PPG driver; sql builder, orm, transactions, prepare, close, asyncDispose all wired with shape-parity to `@prisma-next/postgres`." The binding module + the runtime factory module + the `./runtime` export stub replacement + smoke tests all hang together — splitting carves at non-stable joints.

Matches **Single-package new feature** per [`drive/calibration/sizing.md`](../../../../drive/calibration/sizing.md). Estimated size ~600–900 LoC across ~5 files (2 new src + 1 export rewrite + 1–2 test files + arch config). Inside the dispatch-INVEST *Small* ceiling.

## Dispatch plan

### Dispatch 1: Port postgres.ts → facade runtime + binding + smoke tests

- **Outcome:** The facade's `./runtime` export ships a real `runtime()` factory returning `PrismaPostgresServerlessClient<TContract>` with shape-parity to `@prisma-next/postgres`'s `postgres()` factory. Bindings: `{ url }` or `{ ppgClient }`. Driver: `@prisma-next/driver-ppg-serverless/runtime`. Smoke tests at the facade boundary (≥8 tests) cover construction, sql/orm composition, transaction lifecycle, connect, close, and asyncDispose.

- **Builds on:** Slice 4 (facade scaffold — the package exists, stubs land here); Slice 3 (the driver is complete, end-to-end); the chosen design in [`./spec.md`](./spec.md).

- **Hands to:** A working facade. Slice 6 runs integration tests against `@prisma/dev`'s PPG endpoint + does README polish + close-out.

- **Focus:**
  - **Aggressive mirroring.** `postgres.ts` is ~250 LoC; the new file is ~250 LoC with 5 named deltas (driver swap, no `Pool` import, 2-variant binding, no `poolOptions` block, no `cursor` create-option). Read postgres.ts top-to-bottom before writing; preserve the comments around the `Object.assign(Object.create(txCtx), ...)` pattern (load-bearing context).
  - **Tests-first.** Scaffold `test/_fakes.ts` (local fake `Client` + `Session` slim copy — minimal surface needed for facade tests: `newSession` returning a session whose `query` returns canned resultsets, `session.close()` synchronous), then `test/prisma-postgres-serverless.test.ts` happy-path assertions, then implementation. Iterate until green.
  - **Replace, don't keep, the Slice 4 stubs in `./runtime` export file.** The new export file re-exports types + default from the new runtime module. The Slice 4 `NOT_IMPLEMENTED_MESSAGE` constant and `PrismaPostgresServerlessOptions` placeholder interface are gone.
  - **Leave `./config` and `./contract-builder` stubs alone.** No changes to those export files.
  - **Working positions on Open Questions** (operator confirmed via "continue"):
    - OQ1 — `./config` + `./contract-builder` stay as Slice 4 stubs; Slice 6 close-out evaluates.
    - OQ2 — local copy of fake at `test/_fakes.ts`.
    - OQ3 — `prepare()` shape-parity holds; collapse happens at driver layer transparently.

#### Completed when

1. `pnpm --filter @prisma-next/prisma-postgres-serverless build` exits 0; emits the same 6 `dist/*.mjs` + 6 `dist/*.d.mts` as Slice 4 (only their contents change).
2. `pnpm --filter @prisma-next/prisma-postgres-serverless test` exits 0. ≥8 tests covering: facade construction (both contract / contractJson options); sql.from(...).select(...).build() type-correctness; transaction(fn) with sql + orm rebound; connect(binding) marks driver connected; close() releases owned resources; [Symbol.asyncDispose] delegates to close().
3. `pnpm lint:deps` exits 0 (one new arch-config entry for `src/runtime/**`).
4. `pnpm --filter @prisma-next/prisma-postgres-serverless lint` exits 0.
5. `pnpm --filter @prisma-next/prisma-postgres-serverless typecheck` exits 0.
6. **No `pg` / `@types/pg`** in manifest (carried over from Slice 4 — no regression):
   ```sh
   jq -r '.dependencies, .devDependencies | keys[]?' packages/3-extensions/prisma-postgres-serverless/package.json | sort -u | grep -E '^(pg|@types/pg)$' && echo "FAIL" || echo "OK"
   ```
7. **No transient project IDs** (canonical regex):
   ```sh
   git diff --cached -U0 -- ':!projects/' | grep -E '^\+' | grep -oE '\b(T[0-9]+\.[0-9]+|TC-?[0-9]+|AC-?[0-9]+|FR[0-9]+|NFR[0-9]+|CKPT-[0-9]+|AM[0-9]+|D[0-9]+|M[0-9]+\.[0-9]+|P[0-9]+ R[0-9]+|M[0-9]+ review|Slice [0-9]+)\b' | sort -u
   ```
   Plus manual prose-attribution sweep. Both must return empty.
8. The new `./runtime` export's default function is a callable that returns a client object with **all of** `sql`, `orm`, `raw`, `context`, `stack`, `connect`, `runtime`, `transaction`, `prepare`, `close`, `[Symbol.asyncDispose]` — verified by the test assertions.
9. No bare `as` casts in production code. `castAs` / `blindCast` with documented reasons where needed.

#### Halt conditions

- Postgres's `postgres.ts` references an API from `@prisma-next/sql-runtime` or other framework packages that doesn't compose for the new facade — surface with the specific compilation error.
- Test setup hits the `@prisma/dev` server requirement (the tests should be fully mocked at the PPG-client boundary).
- Diff exceeds ~20 files OR ~1000 LoC — likely scope expansion; surface for re-decomposition.
- `./config` or `./contract-builder` substantive impls need to land to make tests pass — surface (this is Slice-6 territory; should NOT be needed for this dispatch's scope).
- An out-of-scope surface (driver, adapter, target, framework, postgres facade) needs touching — surface.

## Hand-off completeness check

Slice-DoD per [`./spec.md`](./spec.md):

- [x] Smoke tests pass — covered by Dispatch 1's `Completed when` #2.
- [x] `pnpm lint:deps` green — covered by #3.
- [x] Shape-parity with postgres's `postgres()` factory — covered by #8.

Inherited: build / typecheck / lint clean, no `pg`, no transient IDs, no bare `as`.

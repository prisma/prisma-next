# Slice 2 — Dispatch plan

Slice spec: [`./spec.md`](./spec.md)

## Sizing rationale

Slice 2's surface is the SqlDriver SPI's `SqlQueryable` contract (`execute`, `query`, `executePrepared`) plus its supporting machinery (`PpgBinding` type, row mapper, error normaliser, unbound wrapper update). The whole surface shares one substrate — the one-shot session lifecycle — and one mocking boundary in tests (PPG's `client()` factory). Splitting carves at non-stable joints: a "ship execute, then query, then executePrepared" decomposition leaves the slice DoD red in every intermediate state, and a "ship implementation, then ship tests" split violates the codebase's tests-first convention.

This matches **Single-package new feature** in [`drive/calibration/sizing.md § Dispatch-shape patterns this repo runs cleanly`](../../../../drive/calibration/sizing.md#dispatch-shape-patterns-this-repo-runs-cleanly) — one new surface (the bound driver impl), positive + edge tests, package-scoped verification. Estimated size is ~1000 LoC across ~8 new/changed files, well within the upper bound of single-dispatch-shaped work in this codebase. If WIP inspection reveals drift, mid-flight re-decomposition through `drive-plan-slice` is the relief valve.

## Dispatch plan

### Dispatch 1: Implement one-shot session driver + error normalisation + tests

- **Outcome:** `@prisma-next/driver-ppg-serverless` ships a real `SqlDriver<PpgBinding>` runtime. `execute`/`query`/`executePrepared` round-trip queries through a mocked `@prisma/ppg` client/session in unit tests. PPG errors (`DatabaseError`, `WebSocketError`, `ValidationError`, `HttpResponseError`) translate to `SqlQueryError` / `SqlConnectionError` with the same shape `driver-postgres` produces. `acquireConnection()` throws "not implemented" (Slice 3 seam). Tests parallel `driver-postgres/test/driver.basic.test.ts`, `driver.errors.test.ts`, `driver.unbound.test.ts`, plus a dedicated `normalize-error.test.ts`.

- **Builds on:** Slice 1's package shell + the chosen design pinned in [`./spec.md`](./spec.md) (binding type, lifecycle split, one-shot loop, row mapper, error normaliser).

- **Hands to:** A working data-plane driver whose top-level `SqlQueryable` methods are usable end-to-end against a real PPG instance. Slice 3 builds on this by adding `acquireConnection()` real behaviour (long-lived session) + transactions. Slice 5 builds on this by wiring the driver into the facade's `runtime()` factory. The hand-off contract:
  - `PpgBinding` type is exported from `./runtime`.
  - `createBoundDriverFromBinding(binding, options?)` is the binding-to-bound-impl factory (mirror of `postgres-driver.ts`).
  - The bound impl class is named `PpgServerlessBoundDriverImpl` and exposes a private hook (or protected method) for Slice 3 to override `acquireConnection`. Implementation detail: extend the class, or extract a shared abstract base — implementer's call.

- **Focus:**
  - Tests-first: scaffold `driver.basic.test.ts`'s mocked-PPG client + happy-path assertions before writing the bound impl. Then add the impl. Then iterate to green.
  - Mirror `postgres-driver.ts`'s bound/unbound split. The unbound wrapper in `runtime.ts` should look almost identical to `PostgresUnboundDriverImpl` (state machine, delegate routing, error semantics for "not connected" / "already connected"), substituting `PpgBinding` for `PostgresBinding`.
  - `normalize-error.ts` mirrors `driver-postgres/src/normalize-error.ts` shape — `instanceof` dispatch on PPG's error classes, mapping to `SqlQueryError` / `SqlConnectionError` from `@prisma-next/sql-errors`. Reuse the helper functions (`isTransientWebSocketClosure`) inline; no shared utility module is needed.
  - The row mapper at `src/core/row-mapper.ts` is a pure function; its test (`row-mapper.test.ts` or folded into `driver.basic.test.ts`) is small and exhaustive.
  - **Working positions on the spec's open questions** (operator confirmed implicitly via "proceed"):
    - **OQ1 — `explain()`**: out for Slice 2.
    - **OQ2 — `PpgServerlessDriverCreateOptions`**: empty interface for now.
    - **OQ3 — `Session.close()` sync vs async**: implementer should `await` defensively (e.g. `await session.close?.()` or wrap in `Promise.resolve`) and surface in the report which the runtime actually requires. If PPG's typing says `void` but the README example awaits, the truth-on-disk in `node_modules/.../dist/index.js` is the tie-breaker.
  - Architecture-config: the existing `src/core/**` glob already covers `core/row-mapper.ts`. The new top-level `src/ppg-driver.ts` and `src/normalize-error.ts` need entries (domain: targets, layer: drivers, plane: shared). Add to `architecture.config.json` in the same commit that adds those files so `pnpm lint:deps` stays green throughout.

#### Completed when

1. `pnpm --filter @prisma-next/driver-ppg-serverless build` exits 0, emits `dist/runtime.mjs` + `dist/runtime.d.mts`.
2. `pnpm --filter @prisma-next/driver-ppg-serverless test` exits 0. Coverage: ≥1 positive test per `SqlQueryable` method (`execute`, `query`, `executePrepared`), ≥1 row-mapping test (column-name keying), ≥1 unbound-state test per state transition, ≥1 normalisation test per PPG error class.
3. `pnpm lint:deps` exits 0.
4. `pnpm --filter @prisma-next/driver-ppg-serverless lint` exits 0 (biome — should work cleanly now per the rebase pulling in commit `94f43389b`).
5. `pnpm --filter @prisma-next/driver-ppg-serverless typecheck` exits 0.
6. No bare `as` casts in production code (per `.agents/rules/no-bare-casts.mdc`). The row-mapper's `castAs<Row>` is the only allowed cast and is documented with the justification from the spec.
7. No transient-ID violations in source code or README (per `.agents/rules/no-transient-project-ids-in-code.mdc`). Run `git diff --cached -U0 ':!projects/' | grep -E '^\+' | grep -oE '\b(Slice|Task|TC|AC|FR|NFR)[ -]?[0-9]+\b' | sort -u` — must return empty.
8. The descriptor's 4th type parameter is updated from `RuntimeDriverInstance<'sql', 'postgres'>` (Slice 1) to `RuntimeDriverInstance<'sql', 'postgres'> & SqlDriver<PpgBinding>` (the binding type now reachable from the public surface).
9. `acquireConnection()` throws a clear "not implemented" error mentioning that the long-lived session path is unavailable in the current build (the message must not reference "Slice 3" or other transient IDs).

#### Halt conditions

- The framework SPI's `RuntimeDriverDescriptor` or `RuntimeDriverInstance` shape has shifted since Slice 1 (e.g. new mandatory method) in a way that makes the spec's design literally not compile — halt and surface with the specific type error.
- PPG's runtime behaviour diverges from its `.d.ts` in a load-bearing way (e.g. `session.close()` is actually async at runtime) — halt and surface; don't paper over the disagreement with optional-chaining or hidden awaits without surfacing the discovery.
- The diff exceeds ~25 files OR ~1400 LoC. This is well past the dispatch-INVEST *Small* ceiling for this slice's expected shape; re-decompose mid-flight via `drive-plan-slice`.
- Any test requires a real PPG server to run (the slice is entirely mock-based — integration tests are Slice 6). If a unit test starts wanting a live PPG endpoint, the test design is wrong.
- An out-of-scope surface (facade package, adapter, target-pack, framework-components) needs touching to complete the dispatch — halt and surface; this is the spec's scope statement being falsified.

## Hand-off completeness check

Slice-DoD per [`./spec.md`](./spec.md):

- [x] Unit-test surface covers `execute`, `query`, `executePrepared`, row mapper, normaliser — covered by Dispatch 1's `Completed when` #2.
- [x] `pnpm lint:deps` green — covered by Dispatch 1's `Completed when` #3.

Inherited (project-DoD floor): no bare `as` casts (#6), no transient IDs (#7), build + typecheck + lint (#1, #4, #5).

The single dispatch's `Hands to` (working data-plane driver, exported `PpgBinding`, factory, named bound impl class with Slice-3 extensibility hook) feeds Slice 3 (long-lived session + transactions) and Slice 5 (facade wiring) — both downstream slices reach the slice-DoD's outcome through this hand-off.

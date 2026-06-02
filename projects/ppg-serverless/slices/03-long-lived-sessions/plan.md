# Slice 3 — Dispatch plan

Slice spec: [`./spec.md`](./spec.md)

## Sizing rationale

Slice 3 carries one logical state: "long-lived sessions and transactions work; the refactor preserves Slice 2's behaviour." The refactor (introducing the abstract `PpgServerlessQueryable` base) is the substrate that makes the connection + transaction classes share code with the bound impl — it ships with the new classes, not separately. Splitting "refactor first, classes second" carves at an unstable joint: the refactor alone produces a no-op diff (the bound impl still works the same way); the new classes alone duplicate code that's just been factored. The natural shape is one dispatch.

Per [`drive/calibration/sizing.md § Dispatch-shape patterns this repo runs cleanly`](../../../../drive/calibration/sizing.md#dispatch-shape-patterns-this-repo-runs-cleanly), this matches **Single-package new feature** — one new surface (connection + transaction), positive + edge tests, package-scoped verification, plus a co-located refactor that the new surface depends on. Estimated size ~800 LoC across ~4 files (1 src refactor + 2 new test files + 1 fakes extension). Below the dispatch-INVEST *Small* ceiling.

## Dispatch plan

### Dispatch 1: Refactor PpgServerlessQueryable abstract + implement Connection + Transaction + tests

- **Outcome:** `packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts` carries an abstract `PpgServerlessQueryable` base that owns `execute`/`executePrepared`/`query` against an `acquireSession`/`releaseSession` hook. Three concrete extenders: `PpgServerlessBoundDriverImpl` (one-shot session per call — unchanged behaviour), `PpgServerlessSessionConnection` (held session, no-op release), `PpgServerlessSessionTransaction` (held session, no-op release). `acquireConnection()` returns a real `SqlConnection`. `beginTransaction()` issues `BEGIN`. `commit()` / `rollback()` issue the matching statement. Slice 2's 45 tests still pass (zero regression). New tests cover the connection and transaction surfaces. Total tests: ≥60.

- **Builds on:** Slice 2's `PpgServerlessBoundDriverImpl` + `_fakes.ts` infrastructure + `normalize-error.ts` + `row-mapper.ts`. The chosen design pinned in [`./spec.md`](./spec.md) (inheritance shape, connection/transaction class bodies, refactor scope).

- **Hands to:** A complete data-plane driver. Slice 5 (facade wiring) can now wire `acquireConnection`, `beginTransaction`, `commit`, `rollback`, `release`, `destroy` end-to-end. Slice 6 (integration tests) exercises all of it against `@prisma/dev`'s PPG endpoint.

- **Focus:**
  - **Refactor preserves Slice 2 behaviour.** The Slice 2 implementer's `#executeStreaming` private method on `PpgServerlessBoundDriverImpl` becomes the abstract base's `execute()` (uses `acquireSession`/`releaseSession` hooks). Bound impl's `acquireSession` opens a new session; `releaseSession` closes it. Net: identical behaviour, different code organisation. The 45 existing tests are the regression check — they must all still pass without modification.
  - **Three classes, one substrate.** The abstract base does the work; the subclasses are thin (just provide the session-lifetime hook + their non-shared methods).
  - **Connection's `#released` guard** uses the same `throwingAsyncIterable<Row>` helper the bound impl uses for its `#closed` case (already in `runtime.ts` or `ppg-driver.ts` from Slice 2 — reuse it; don't duplicate).
  - **Fake `Session` extension**. The Slice 2 `_fakes.ts` `Session` mock returned canned resultsets. Slice 3 needs query-history tracking (an array of `{ sql, params }` per call) so transaction tests can assert `BEGIN`/`COMMIT`/`ROLLBACK` were issued in the right order. Plus a `closeCount` so connection tests can verify `release` and `destroy` both call close once and only once.
  - **`Transaction.commit()` failure surfaces as `SqlQueryError`.** The mock simulates `DatabaseError` from PPG; tests assert the normalised shape (sqlState, cause preserved). Same shape as Slice 2's `driver.errors.test.ts`.
  - **No new architecture-config entries.** No new files in `src/`.
  - **Working positions on Open Questions** (operator confirmed via "continue"):
    - **OQ1 — `destroy(reason)` propagation**: reason is captured but informational only; not logged, not rethrown.
    - **OQ2 — Naming**: `PpgServerlessSessionConnection` and `PpgServerlessSessionTransaction` (distinguishes from pool-style "connection").
    - **OQ3 — Post-commit transaction reuse**: no special handling; the connection remains usable for more queries / another `beginTransaction`.

#### Completed when

1. `pnpm --filter @prisma-next/driver-ppg-serverless build` exits 0.
2. `pnpm --filter @prisma-next/driver-ppg-serverless test` exits 0. **All 45 Slice-2 tests still pass** (regression baseline). New tests:
   - `driver.connection.test.ts` covers: `acquireConnection` opens one session per call; subsequent execute/query/executePrepared reuse the same session (`newSession` call-count == 1, not 1 per call); `release()` closes the session and prevents subsequent calls; `destroy(reason)` closes the session (reason ignored); double-release / release-after-destroy are no-ops; calls after release throw `DRIVER.CONNECTION_RELEASED`.
   - `driver.transaction.test.ts` covers: `beginTransaction()` issues `BEGIN` (query history check); transaction's execute/query reuse the connection's session; `commit()` issues `COMMIT`; `rollback()` issues `ROLLBACK`; commit-failure surfaces as `SqlQueryError` with PPG's sqlState preserved.
   - Expected total: 60–70 tests across all files.
3. `pnpm lint:deps` exits 0.
4. `pnpm --filter @prisma-next/driver-ppg-serverless lint` exits 0.
5. `pnpm --filter @prisma-next/driver-ppg-serverless typecheck` exits 0.
6. No bare `as` casts in production code (`.agents/rules/no-bare-casts.mdc`). The refactor likely introduces no new cast sites; existing `blindCast` sites stay.
7. No transient project IDs in source or README (canonical regex per `.agents/rules/no-transient-project-ids-in-code.mdc`). Run before staging:
   ```sh
   git diff --cached -U0 -- ':!projects/' | grep -E '^\+' | grep -oE '\b(T[0-9]+\.[0-9]+|TC-?[0-9]+|AC-?[0-9]+|FR[0-9]+|NFR[0-9]+|CKPT-[0-9]+|AM[0-9]+|D[0-9]+|M[0-9]+\.[0-9]+|P[0-9]+ R[0-9]+|M[0-9]+ review|Slice [0-9]+)\b' | sort -u
   ```
   Must return empty. Plus manual prose-attribution sweep: `later slice`, `per project decision`, `slice surface`, `sub-spec`, `out of scope per`. Must return empty too.
8. `PpgServerlessBoundDriverImpl` public surface (class name, `state` getter, constructor signature, `close()` semantics) is unchanged from Slice 2 — Slice 5's facade compiles unchanged.
9. The `NOT_IMPLEMENTED_ACQUIRE_CONNECTION_MESSAGE` constant and its consumer in `acquireConnection()` are removed (the message is no longer reachable).

#### Halt conditions

- The refactor regresses any Slice 2 test. Halt and surface; root-cause before continuing.
- PPG's `Session.query` doesn't accept transactional statements (`BEGIN`/`COMMIT`/`ROLLBACK`) in the way the spec assumes — read PPG's `dist/index.js` if a test fails; surface the divergence rather than papering over it with a separate transaction API.
- The diff exceeds ~20 files OR ~1200 LoC. Likely means the refactor scope expanded beyond intent; halt for re-decomposition.
- An out-of-scope surface needs touching (facade, adapter, target, framework-components) — halt and surface.
- Any test wants a real PPG server to run — surface; this slice is mock-based.

## Hand-off completeness check

Slice-DoD per [`./spec.md`](./spec.md):

- [x] Existing 45 Slice-2 tests pass + new connection/transaction tests pass — covered by Dispatch 1's `Completed when` #2.
- [x] `pnpm lint:deps` green — covered by Dispatch 1's `Completed when` #3.

Inherited (project-DoD floor): build / typecheck / lint / no bare `as` / no transient IDs — all covered by Dispatch 1's `Completed when`.

The single dispatch's `Hands to` (complete data-plane driver, all SqlDriver methods wired) feeds Slice 5 (facade wiring) and Slice 6 (integration tests) — both downstream consumers have everything they need.

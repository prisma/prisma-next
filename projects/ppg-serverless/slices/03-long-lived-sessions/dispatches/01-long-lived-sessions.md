# Brief: Refactor PpgServerlessQueryable abstract + implement Connection + Transaction + tests

## Task

Refactor `packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts` to introduce an abstract `PpgServerlessQueryable` base owning `execute`/`executePrepared`/`query` against an `acquireSession`/`releaseSession` hook. Make `PpgServerlessBoundDriverImpl` extend it (one-shot hook: `client.newSession()` + `session.close()`). Add two new concrete extenders: `PpgServerlessSessionConnection` (held session, no-op release, plus `release` / `destroy` / `beginTransaction`) and `PpgServerlessSessionTransaction` (held session, no-op release, plus `commit` / `rollback`). Replace `acquireConnection()`'s "not implemented" body with a real implementation that opens a session and returns a connection. Remove the `NOT_IMPLEMENTED_ACQUIRE_CONNECTION_MESSAGE` constant.

The full chosen design — inheritance shape, class bodies, refactor scope, behaviour invariants — is pinned in [`projects/ppg-serverless/slices/03-long-lived-sessions/spec.md § Chosen design`](../spec.md#chosen-design). Mirror it.

**Critical regression baseline:** Slice 2's 45 existing tests must still pass without modification. The refactor preserves bound-impl behaviour; only the code organisation changes.

## Scope

**In:**

- `packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts` — refactor + two new classes + updated `acquireConnection`. No other source files change.
- `packages/3-targets/7-drivers/ppg-serverless/test/driver.connection.test.ts` — new (~10–14 tests covering acquire / execute reuse / release / destroy / released-state guards).
- `packages/3-targets/7-drivers/ppg-serverless/test/driver.transaction.test.ts` — new (~8–10 tests covering begin / execute via tx / commit / rollback / commit-error normalisation).
- `packages/3-targets/7-drivers/ppg-serverless/test/_fakes.ts` — extend the `Session` fake with query-history tracking (`sessionQueryHistory: Array<{ sql, params }>`) and `closeCount`. Keep all existing surface — Slice 2 tests must still find the probes they need.

**Out:**

- Touching `runtime.ts`, `normalize-error.ts`, `core/row-mapper.ts`, `core/descriptor-meta.ts`, `architecture.config.json`, README, package.json, tsconfig*, biome.jsonc, vitest.config.ts. If any of these need touching to complete the dispatch, halt and surface.
- `explain()` on the abstract base — still optional, still out.
- Facade, adapter, target-pack, framework-components changes.
- Integration tests against a real PPG server.

## Completed when

1. `pnpm --filter @prisma-next/driver-ppg-serverless build` exits 0.
2. `pnpm --filter @prisma-next/driver-ppg-serverless test` exits 0. **All 45 Slice-2 tests pass unchanged** (regression baseline). New connection + transaction tests pass. Expected total: 60–70 tests.
3. `pnpm lint:deps` exits 0.
4. `pnpm --filter @prisma-next/driver-ppg-serverless lint` exits 0.
5. `pnpm --filter @prisma-next/driver-ppg-serverless typecheck` exits 0.
6. **No bare `as` casts in production code**. Use `castAs` / `blindCast` if needed.
7. **No transient project IDs in source or README.** Run the canonical regex before staging:
   ```sh
   git diff --cached -U0 -- ':!projects/' | grep -E '^\+' | grep -oE '\b(T[0-9]+\.[0-9]+|TC-?[0-9]+|AC-?[0-9]+|FR[0-9]+|NFR[0-9]+|CKPT-[0-9]+|AM[0-9]+|D[0-9]+|M[0-9]+\.[0-9]+|P[0-9]+ R[0-9]+|M[0-9]+ review|Slice [0-9]+)\b' | sort -u
   ```
   Must return empty. Plus manual prose-attribution sweep: `later slice`, `per project decision`, `slice surface`, `sub-spec`, `out of scope per`, `per spec`, `deferred per`. Must return empty too.
8. `PpgServerlessBoundDriverImpl`'s public surface is unchanged from Slice 2: class name, `state` getter, constructor signature, `close()` semantics, public method shapes.
9. `NOT_IMPLEMENTED_ACQUIRE_CONNECTION_MESSAGE` constant is deleted (its consumer is gone).
10. The connection/transaction's "released" error message uses neutral wording — e.g. `'driver-ppg-serverless: connection has been released; acquire a new connection before issuing further queries'`.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message.

**Source-string rule still applies.** Comments, JSDoc, error strings, README copy — all inherit the canonical transient-ID rule. Run the regex AND the prose-attribution sweep before final commit.

## References

- **Slice spec:** [`projects/ppg-serverless/slices/03-long-lived-sessions/spec.md`](../spec.md).
- **Slice plan:** [`projects/ppg-serverless/slices/03-long-lived-sessions/plan.md`](../plan.md).
- **Reference template (abstract base + connection + transaction):** [`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`](../../../../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts) lines 119–386 — `PostgresQueryable`, `PostgresConnectionImpl`, `PostgresTransactionImpl`. The shape maps directly: `acquireClient`/`releaseClient` → `acquireSession`/`releaseSession`.
- **Existing Slice 2 code (the substrate you're refactoring):** [`packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts`](../../../../../packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts).
- **SqlConnection / SqlTransaction contracts:** [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../../../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts) — read `SqlConnection`'s `release` vs `destroy` semantics (the JSDoc on destroy is load-bearing — preserve those invariants).
- **PPG Session interface:** `node_modules/.pnpm/@prisma+ppg@1.0.1/node_modules/@prisma/ppg/dist/index.d.ts` — `Session.close(): void` (sync), `Session.active: boolean`.

## Edge cases

| Edge case | Disposition |
|---|---|
| **Refactor regression risk.** The abstract base must produce identical behaviour to the Slice 2 bound impl's direct methods. | Run the Slice-2 tests after each step of the refactor; if any fail, the refactor diverged from intent. The 45 tests are the contract. |
| **PPG transactional statements via `session.query`.** Test mocks need to handle `BEGIN`/`COMMIT`/`ROLLBACK` returning an empty resultset. | Mock `Session.query` to return `{ columns: [], rows: collectableIterable([]) }` for any SQL that starts with `BEGIN`/`COMMIT`/`ROLLBACK`. |
| **`#released` flag guard on the connection's async methods.** | Use the existing `throwingAsyncIterable<Row>` pattern (Slice 2's `runtime.ts` or `ppg-driver.ts`) — don't introduce a new helper. |
| **`destroy(reason)` argument.** | Capture in parameter; ignore in body. PPG has no equivalent to pg-pool's "evict on truthy release arg" semantic. Documented in the spec; the reason field is purely advisory. |
| **`Transaction` extending `Queryable` (not `Connection`).** | Mirrors postgres-driver. The transaction has no `release`/`destroy`/`beginTransaction` of its own — only `commit`/`rollback` and the inherited `execute`/`query`/`executePrepared`. |
| **The wrapper's `acquireConnection()` routing.** | `exports/runtime.ts` already routes to the bound impl's `acquireConnection`. Should not need changes — verify by reading the existing route. If it needs adjustment, that's an out-of-scope signal; surface. |
| **Destructive git operations forbidden** (F5). The orchestrator has many untracked working files. |  |

## Operational metadata

- **Model tier:** Recommended: Sonnet or composer-2.5 (refactor + new code + tests; design is settled; pattern is from postgres-driver; strong validation gate via the 45-test regression baseline).
- **Time-box:** 100 minutes wall-clock. Overrun → halt and surface.
- **Halt conditions:**
  - Any Slice-2 test regression — root-cause before continuing.
  - PPG runtime diverges from typing in a load-bearing way — surface; don't paper over.
  - Diff exceeds ~20 files OR ~1200 LoC — surface for re-decomposition.
  - Out-of-scope surface needs touching — surface (this is unusually scope-tight; only `ppg-driver.ts` + `test/_fakes.ts` + 2 new test files).
  - A unit test wants a real PPG server — surface.

## Commit organisation

Suggested splits (your judgment):

- **Single commit:** `feat(driver-ppg-serverless): long-lived sessions + transactions via PpgServerlessQueryable refactor`.
- **Two commits:** (1) refactor (abstract base + bound impl update; Slice-2 tests still pass on this commit alone); (2) new classes + tests (connection + transaction + _fakes.ts extension).

The two-commit split is cleaner for review — the reviewer can verify the refactor is behaviour-preserving in commit 1 before evaluating commit 2's new surface. Use your judgment; surface the choice in your wrap-up.

**No `git add -A` / `git add .`** — explicit staging. **No `--amend`** on prior commits. **No push** (project-policy: single PR at project close-out).

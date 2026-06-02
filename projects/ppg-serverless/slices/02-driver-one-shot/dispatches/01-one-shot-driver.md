# Brief: Implement one-shot session driver + error normalisation + tests

## Task

Replace the placeholder driver in `@prisma-next/driver-ppg-serverless` (the package shell that landed in Slice 1) with a real `SqlDriver<PpgBinding>` implementation. Each top-level `execute` / `query` / `executePrepared` call opens a fresh `@prisma/ppg` `client.newSession()`, runs the statement, streams rows back keyed by column name, and closes the session. PPG errors (`DatabaseError`, `WebSocketError`, `ValidationError`, `HttpResponseError`) translate to `SqlQueryError` / `SqlConnectionError` (NFR4 — error-shape parity with `@prisma-next/driver-postgres`). `acquireConnection()` throws a neutral "not implemented" error (Slice 3's seam — but the source-string itself must NOT reference "Slice 3" or any transient identifier; see standing-instruction below).

The full design — binding type, lifecycle split, one-shot loop body, row mapper, error normaliser, module structure — is pinned in [`projects/ppg-serverless/slices/02-driver-one-shot/spec.md § Chosen design`](../spec.md#chosen-design). Mirror it.

## Scope

**In:**

- `packages/3-targets/7-drivers/ppg-serverless/src/ppg-driver.ts` — `PpgBinding` type, `PpgServerlessBoundDriverImpl` class, `createBoundDriverFromBinding(binding, options?)` factory, `PpgServerlessDriverCreateOptions` empty interface (open question 2 resolved as empty for now).
- `packages/3-targets/7-drivers/ppg-serverless/src/normalize-error.ts` — `normalizePpgError(error: unknown): SqlQueryError | SqlConnectionError | Error` with `instanceof` dispatch on PPG's four error classes (per spec § Error normalisation).
- `packages/3-targets/7-drivers/ppg-serverless/src/core/row-mapper.ts` — `mapRowToRecord<Row>(ppgRow, columns): Row` with documented `castAs<Row>` justification.
- `packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts` — replace the Slice-1 placeholder unbound class with a real `PpgServerlessUnboundDriverImpl` that mirrors `PostgresUnboundDriverImpl`'s state-machine + delegate-routing structure. Update the descriptor's 4th type parameter from `RuntimeDriverInstance<'sql', 'postgres'>` to `RuntimeDriverInstance<'sql', 'postgres'> & SqlDriver<PpgBinding>`.
- `packages/3-targets/7-drivers/ppg-serverless/test/` — new directory with four test files (or fewer, if folding makes sense — e.g. `row-mapper.test.ts` could be inside `driver.basic.test.ts`):
  - `driver.basic.test.ts` — happy-path tests for `execute`, `query`, `executePrepared`, row mapping. Mocks PPG at the `client()` boundary (import the `client` function, intercept it via `vi.mock` or a manual fake-client object passed via `{ kind: 'ppgClient', client: fake }`).
  - `driver.errors.test.ts` — error-path tests: PPG mock throws each of the four error classes; assert normalised shape (sqlState, transient flag, cause preserved).
  - `normalize-error.test.ts` — direct unit tests on the normaliser.
  - `driver.unbound.test.ts` — state transitions: `unbound` → `connected` → `closed`; double-connect rejection; method calls before connect throw "not connected".
- `architecture.config.json` — add two entries for `src/ppg-driver.ts` and `src/normalize-error.ts` (domain: `targets`, layer: `drivers`, plane: `shared`), placed beside the existing `ppg-serverless` entries.

**Out:**

- `acquireConnection()` real behaviour. It throws "not implemented" in this dispatch.
- Transactions (`beginTransaction`, `commit`, `rollback`). Slice 3.
- Custom PPG parsers/serializers in `PpgServerlessDriverCreateOptions`. Empty interface this dispatch (OQ2).
- `explain()` implementation. Optional on `SqlQueryable`; out of slice (OQ1).
- Touching `driver-postgres`. It is the reference template; do not edit it.
- Touching any facade, adapter, or target-pack code.
- README updates beyond what's required to remove stale TODOs that point at "Slice 2" content this dispatch now ships. **You may** update `packages/3-targets/7-drivers/ppg-serverless/README.md` to remove the `<!-- TODO: add diagram when transport layer lands -->` and `<!-- TODO: add usage example when transport binding is implemented -->` placeholders if you have time after the implementation lands AND the new content stays neutral (no transient IDs). If you can't fit it in, leave them — Slice 5 or 6 will polish the README.
- Integration tests against a real PPG server. Slice 6.

## Completed when

1. `pnpm --filter @prisma-next/driver-ppg-serverless build` exits 0, emits `dist/runtime.mjs` + `dist/runtime.d.mts`.
2. `pnpm --filter @prisma-next/driver-ppg-serverless test` exits 0. Coverage: ≥1 positive test per `SqlQueryable` method (`execute`, `query`, `executePrepared`), ≥1 row-mapping test (column-name keying), ≥1 unbound-state test per state transition, ≥1 normalisation test per PPG error class (4 minimum).
3. `pnpm lint:deps` exits 0.
4. `pnpm --filter @prisma-next/driver-ppg-serverless lint` exits 0.
5. `pnpm --filter @prisma-next/driver-ppg-serverless typecheck` exits 0.
6. **No bare `as` casts in production code** (per `.agents/rules/no-bare-casts.mdc`). Use `castAs<Row>` in `core/row-mapper.ts` with the spec's documented justification inline. `as const` and test-file casts are exempt; everywhere else, use `castAs` or `blindCast` with a reason string.
7. **No transient-ID violations in source code or README** (per `.agents/rules/no-transient-project-ids-in-code.mdc`). Before final commit, run:
   ```sh
   git diff --cached -U0 -- ':!projects/' | grep -E '^\+' | grep -oE '\b(Slice|Task|TC|AC|FR|NFR)[ -]?[0-9]+\b' | sort -u
   ```
   Must return empty. Specifically: the `acquireConnection` "not implemented" error message must NOT mention "Slice 3" — use neutral language like `"driver-ppg-serverless: long-lived sessions are not yet implemented; this driver currently supports only top-level execute/query/executePrepared via one-shot sessions"`.
8. The descriptor's 4th type parameter is `RuntimeDriverInstance<'sql', 'postgres'> & SqlDriver<PpgBinding>` (binding type reachable from the public `./runtime` export).
9. `PpgBinding` type and `createBoundDriverFromBinding` factory are exported from `./runtime` so Slice 3 + Slice 5 can import them.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

**Source-string rule (lesson from Slice 1 / R1's F1):** When this brief or the spec prescribes user-visible strings (error messages, README copy, JSDoc), those strings inherit the same `alwaysApply` rule-set as the code they land in — including `.agents/rules/no-transient-project-ids-in-code.mdc`. If you find yourself writing "Slice N" or "TC-N" or "AC-N" in any source-code string, comment, or markdown content that lands under `packages/`, stop and reword. The spec / plan / this brief are themselves under `projects/` which is transient by design — those references are fine in spec/plan/brief prose, NOT in the strings the brief prescribes.

## References

- **Slice spec:** [`projects/ppg-serverless/slices/02-driver-one-shot/spec.md`](../spec.md) — chosen design (binding type, lifecycle, one-shot loop, row mapper, error normaliser), coherence rationale, scope, pre-investigated edge cases, open questions (1–3 resolved per the plan).
- **Slice plan:** [`projects/ppg-serverless/slices/02-driver-one-shot/plan.md`](../plan.md) — sizing rationale, single-dispatch decomposition, hand-off contract.
- **Project spec:** [`projects/ppg-serverless/spec.md`](../../../spec.md) — read FR1 (binding shape), FR3 (connection-string handling), NFR3 (cast hygiene), NFR4 (error parity), D1 (WS-only transport), D2 (executePrepared collapses).
- **Reference template (mirror aggressively):** [`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`](../../../../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts), [`packages/3-targets/7-drivers/postgres/src/exports/runtime.ts`](../../../../../packages/3-targets/7-drivers/postgres/src/exports/runtime.ts), [`packages/3-targets/7-drivers/postgres/src/normalize-error.ts`](../../../../../packages/3-targets/7-drivers/postgres/src/normalize-error.ts), [`packages/3-targets/7-drivers/postgres/test/driver.basic.test.ts`](../../../../../packages/3-targets/7-drivers/postgres/test/driver.basic.test.ts), [`packages/3-targets/7-drivers/postgres/test/driver.errors.test.ts`](../../../../../packages/3-targets/7-drivers/postgres/test/driver.errors.test.ts), [`packages/3-targets/7-drivers/postgres/test/driver.unbound.test.ts`](../../../../../packages/3-targets/7-drivers/postgres/test/driver.unbound.test.ts), [`packages/3-targets/7-drivers/postgres/test/normalize-error.test.ts`](../../../../../packages/3-targets/7-drivers/postgres/test/normalize-error.test.ts).
- **SqlDriver SPI:** [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../../../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts).
- **Cast helpers:** [`packages/1-framework/0-foundation/utils/src/casts.ts`](../../../../../packages/1-framework/0-foundation/utils/src/casts.ts) — `castAs<Type>(value)` is the no-op cast for documented-shape recombinations like the row mapper.
- **`SqlQueryError` / `SqlConnectionError` shapes:** [`packages/2-sql/0-core/sql-errors/src/`](../../../../../packages/2-sql/0-core/sql-errors/src/) — read the class constructors for the options shape (cause, sqlState, transient, etc.).
- **`@prisma/ppg` v1.0.1 public surface:** `node_modules/.pnpm/@prisma+ppg@1.0.1/node_modules/@prisma/ppg/dist/index.d.ts` — Client, Session, Resultset, Row, Column, the four error classes, `client(config)` factory, `defaultClientConfig` helper.

**Calibration entries that apply:**

- [`drive/calibration/failure-modes.md § F5`](../../../../drive/calibration/failure-modes.md#f5-destructive-git-operations-executed-by-subagents-without-orchestrator-approval) — no destructive git ops (the orchestrator has 6+ untracked files: this brief, the slice spec/plan, code-review notes, learnings).
- [`drive/calibration/grep-library.md § Cross-cutting anti-patterns`](../../../../drive/calibration/grep-library.md#cross-cutting-anti-patterns) — no file-extension imports, no `: any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`. Apply when writing new code.

## Edge cases

| Edge case | Disposition |
|---|---|
| **`Session.close()` typed as `void` but README example awaits.** PPG's `.d.ts` says `close(): void` but `dist/index.js` may treat it as async. | Read `node_modules/.pnpm/@prisma+ppg@1.0.1/node_modules/@prisma/ppg/dist/index.js` to confirm runtime behaviour. Use whatever matches runtime. Report the discrepancy in your wrap-up if the typing is wrong. |
| **`Resultset.rows` is `CollectableIterator<Row>` — async iterator with a `.collect()` method.** Closing the session while still iterating is the cleanup mechanism. | `execute` yields rows from `for await (const row of resultset.rows)` inside `try`; `query` calls `await resultset.rows.collect()`. Both wrap the body in `try { ... } finally { session.close() }` so partial-consumption from upstream consumers still closes the session. |
| **`Client` from `client(config)` has no `.close()` per typings.** | Driver `close()` is a state-reset. For `{ kind: 'url' }` binding, drop the client reference. For `{ kind: 'ppgClient' }`, the user owns lifecycle — we never close it. Confirm by reading PPG's runtime if unsure. |
| **`SqlQueryError` / `SqlConnectionError` constructor options shape.** | Read [`packages/2-sql/0-core/sql-errors/src/`](../../../../../packages/2-sql/0-core/sql-errors/src/) before writing the normaliser. The shape matters — `driver-postgres/src/normalize-error.ts` is the structural template, but you should ground in the actual class definitions not infer from the consumer. |
| **PPG's `DatabaseError.details: Record<string, string>` shape vs `pg`'s top-level error fields (`constraint`, `table`, `column`, `detail`).** | PPG nests them inside `details`; `pg` puts them on the error object. Pluck from `details` when present. The exact key names PPG uses come from PostgreSQL's wire protocol — the conventional set is `constraint`, `table`, `column`, `detail`, `schema`, `hint`, `severity` etc. Surface the actual keys PPG passes through in your wrap-up if they diverge from the conventional set. |
| **Mocking PPG.** Two approaches: (a) `vi.mock('@prisma/ppg', () => ({ client: vi.fn(() => fakeClient) }))` and use the `{ kind: 'url' }` binding; (b) pass a hand-built fake `Client` via the `{ kind: 'ppgClient', client: fake }` binding. Approach (b) is cleaner (no module mocking, fully type-checked) — recommended unless tests need to verify the `client()` factory call. | Use (b) as default; reach for (a) only if a specific test requires module-level mocking. |
| **Destructive git operations forbidden** (F5). | The orchestrator has untracked artefacts on disk including this brief, the slice spec/plan, and the project's code-review notes. Do NOT run `git clean -f*`, `git reset --hard`, `git stash drop|clear`, `git checkout -- .`, `git rm -r --force`, or `rm -rf` against the worktree. |

## Operational metadata

- **Model tier:** Recommended: Sonnet or composer-2.5 (per [`drive/calibration/model-tier.md`](../../../../drive/calibration/model-tier.md) — design is settled, narrow surface, strong validation gate via tests + typecheck + lint, established pattern from `driver-postgres`). The Zed `spawn_agent` harness doesn't expose a model parameter; orchestrator notes the recommendation and accepts the harness default.
- **Time-box:** 120 minutes wall-clock. Overrun → halt and surface; do not extend without orchestrator confirmation.
- **Halt conditions:**
  - Framework SPI shape shifted in a way that makes the spec design not compile — surface with the specific type error.
  - PPG runtime diverges from typing in a load-bearing way — surface; don't paper over.
  - Diff exceeds ~25 files OR ~1400 LoC — surface for re-decomposition.
  - Out-of-scope surface (facade, adapter, target, framework-components) needs touching — surface.
  - A unit test needs a real PPG server to run — surface (the slice is mock-based by design).

## Commit organisation

Use your judgment. Two natural splits the orchestrator would accept:

- **Single commit**: "feat(driver-ppg-serverless): implement one-shot session driver + error normalisation + tests" — fine if the diff stays coherent.
- **Two commits**: (1) implementation source (`ppg-driver.ts`, `normalize-error.ts`, `core/row-mapper.ts`, updated `exports/runtime.ts`, updated `architecture.config.json`); (2) tests (`test/*.test.ts`). Lets the reviewer compare expected vs actual behaviour in two passes.

Surface your commit choice in the wrap-up report.

**No `git add -A` / `git add .`** — explicit staging only. **No `git commit --amend`** unless the orchestrator authorises it. **No push** without authorisation (the project ships as a single PR at project close-out per operator policy; no per-slice push).

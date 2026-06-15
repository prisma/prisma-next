# Brief: D7 — Delete `ExecutableStatement`; converge on `SqlExecuteRequest`

## What this dispatch does — and why

`ExecutableStatement` was a fourth redundant name for the driver-port shape `{ sql, params }`, alongside the pre-existing canonical type `SqlExecuteRequest` (in `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`). The driver port already defines this type and is the right layer to own it (driver-port type lives low in `relational-core`; driver *implementations* live high in `3-targets` and depend inward). So `ExecutableStatement` is deleted and every reference converges on `SqlExecuteRequest`.

One real shape difference the convergence had to absorb: `ExecutableStatement.params` was **required**; `SqlExecuteRequest.params` is **optional** (`params?: readonly unknown[]`). That's correct — `query(sql, params?)` and `execute(request)` both allow param-less statements. Consumers that build migration-plan steps or execute statements were adjusted to tolerate optional params (`params: x.params ?? []` at step-construction sites; `if (statement.params && statement.params.length > 0)` guards at execute sites).

## State at dispatch — edits are already applied

All source + test edits for the convergence are **already in the working tree** (applied by the orchestrator before this dispatch). `grep -rn ExecutableStatement packages` returns zero hits. Your job is **verify, fix any fallout, and commit** — not to re-derive the edits.

Key applied changes (for your map, not to redo):

- **Deleted** the `ExecutableStatement` interface from `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`.
- **`SqlExecuteRequest`** in `…/ast/driver-types.ts` is the canonical type, with a doc comment describing it as the output of the control adapter's `lowerToExecuteRequest`. Re-exported via `exports/ast.ts`.
- The adapter method is `lowerToExecuteRequest(ast, ctx): Promise<SqlExecuteRequest>` (control adapters, both targets). `lower()` rejects DDL (from D6).
- The lowerer interface type is `ExecuteRequestLowerer` (in `packages/2-sql/9-family/src/…/control-adapter.ts`, re-exported from `exports/control-adapter.ts`).
- Optional-params friction resolved at:
  - `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` (step `params: … ?? []`)
  - `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` (same)
  - `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` (precheck/execute/postcheck `params: … ?? []`)
  - `…/{postgres,sqlite}/src/core/migrations/runner.ts` — `executeStatement(driver, statement: SqlExecuteRequest)` → single `await driver.query(statement.sql, statement.params)`
  - Test fixtures: `…/6-adapters/{postgres,sqlite}/test/migrations/fixtures/runner-fixtures.ts`, `test/integration/test/postgres-bootstrap.ts` (`if (statement.params && statement.params.length > 0)` guard / `[...statement.params]` spread)
- Renamed test files (via `git mv`): `lower-to-executable-statement.test.ts` → `lower-to-execute-request.test.ts` (both targets).
- Stub lowerers in tests typed `ExecuteRequestLowerer` with `lowerToExecuteRequest: async () => ({ sql, params: [] })`.

## Your tasks, in order

1. `pnpm build` — refresh `dist/*.d.mts` for changed exported types (`relational-core`, `family-sql` at minimum; build everything to be safe).
2. `pnpm typecheck` — must be **fully green**. If anything still references `ExecutableStatement` or trips on optional `params`, fix it at the consumer (default with `?? []` at construction sites; guard with `params && params.length` at execute sites). Do **not** make `SqlExecuteRequest.params` required to dodge a fix — the optionality is intended.
3. `pnpm test:packages` — green.
4. `pnpm fixtures:check` — no unexpected regen. (The convergence is type-only; emitted SQL must not change. If a fixture diff appears, stop and report it — it means behavior drifted, which is out of scope here.)
5. `pnpm lint:deps` — run **standalone** (the pre-commit hook OOMs on lint:deps; that's why we commit `--no-verify`). Must pass.
6. `pnpm lint:casts` — must not increase the cast count. The convergence should be cast-neutral; if you must cast, use `blindCast<T,'reason'>`/`castAs<T>`, never bare `as`.
7. Targeted integration/e2e for the touched runners + bootstrap:
   - `pnpm test:integration` (PGlite-based; self-contained)
   - `pnpm test:e2e`
   - Known pre-existing flake to ignore: a PG `portal "C_n" does not exist` concurrent-query error that passes in isolation. If you hit exactly that and only that, note it and move on. Anything else is a real failure to fix.

## Commit

One commit. Stage **explicitly** (no `git add -A`), DCO sign-off, `--no-verify` (lint:deps OOM in hook — you ran it standalone above):

```
git commit --no-verify -s -m "$(cat <<'EOF'
TML-2867: delete ExecutableStatement; converge driver-port shape on SqlExecuteRequest

ExecutableStatement was a redundant fourth name for {sql, params}. The driver
port already defines SqlExecuteRequest (relational-core/ast/driver-types) and
owns the shape at the correct layer. Delete ExecutableStatement and route every
reference — adapters, runners, op-factory steps, planner, tests — through
SqlExecuteRequest. Its params field is optional; step-construction sites default
to [] and execute sites guard on length.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

(Commit author/sign-off stays the human git identity — do not set `GIT_AUTHOR_*`.)

## Do NOT

- Re-derive or rewrite the already-applied edits unless they fail to compile.
- Touch the control adapter's `lowerToExecuteRequest` **query branch** encoding gap — it's a known, separately-tracked issue, out of scope for this type convergence.
- Change emitted SQL or migration-plan semantics. This is a type-convergence + verification dispatch only.
- Push. The orchestrator handles push (bot remote) after reviewing your commit.

## Report back

- Pass/fail for each gate above, with the exact failing output if any.
- The commit SHA.
- Anything you had to fix beyond the pre-applied edits, and why.

# D5 — CI red fixes: framework-vocabulary ratchet + LSP teardown race

**Slice plan:** `projects/remove-db-attributes/slices/unify-type-channel/plan.md` · **Tier:** mid · **Branch:** `tml-2985-unify-type-channel`

## Task

PR #943 is red on two CI jobs (DCO already fixed orchestrator-side). Fix both root causes:

**(1) Lint — framework-vocabulary ratchet** (`scripts/lint-framework-vocabulary.mjs`: count 842 > threshold 836). The 6 new lines are in `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` (the `collectScalarTypeConstructors` addition):
- Reword the doc comment to be family-blind: replace the `sql.String` example with generic wording ("constructors registered under a namespace segment") and the `pg.enum` example with "entity-ref constructors". Also de-vocabulary the `nativeType` doc-prose mention if possible without losing meaning.
- The remaining lines read `output.nativeType` / declare `ScalarTypeConstructorOutput.nativeType` — a field that **already exists** in this file's `AuthoringStorageTypeTemplate` (pre-existing counted vocabulary). Raise `threshold` in `scripts/lint-framework-vocabulary.config.json` to the exact post-reword count, with the justification (in the PR-visible diff / config comment if the format allows): "collectScalarTypeConstructors reads the pre-existing AuthoringStorageTypeTemplate.nativeType field; no new family concept introduced."

**(2) Test — unhandled rejection in LSP teardown** (`test/server.test.ts`, vitest "Unhandled Rejection: Connection is disposed", stack: `publishSafely` → `connection.console.error` → `sendNotification` → `throwIfClosedOrDisposed`). Root cause: the harness `dispose()` (test/server.test.ts ~L412) calls `client.dispose()` **before** `server.dispose()`, so an in-flight `publish` rejects on the disposed connection while the server's `disposed` flag (set in `server.dispose()`, src/server.ts ~L595) is still false — the guard at `publishSafely` (~L312) doesn't fire, and `console.error` throws on the dead connection.
- Fix the ordering: `server.dispose()` first, then client + streams. Update the adjacent afterEach comment (~L549) to reflect the reasoning.
- Belt-and-suspenders in `publishSafely` is allowed if minimal (e.g. try/catch around the `console.error` call) — but only with a comment naming the race; do not restructure the publish pipeline.

## Outcome (property statement)

CI's Lint and Test jobs pass, **such that** the framework domain gains no new family concept (reworded docs are family-blind; the ratchet raise covers only reads of a pre-existing field) and the LSP server can never log through a connection that is already disposed during teardown (the `disposed` flag is set before the transport dies).

## Out

- Any behavioral change to completions, publish, or the scalar walk's semantics.
- Weakening or deleting any test.
- Touching anything outside `framework-authoring.ts` docs, the lint config, `server.test.ts`, and (optionally, minimally) `publishSafely`.

## Edge cases

| Case | Disposition |
| --- | --- |
| Threshold raise magnitude | Exact post-reword count, not a round number — the ratchet must stay taut. |
| Reword changes rendered docs meaning | Keep the semantic content (exclusion rules of the walk) intact. |
| Race is timing-dependent | Prove the ordering fix by reasoning in the commit message; run the LSP suite 5× locally (`pnpm --filter @prisma-next/language-server test` repeated) to check for regressions. |
| Destructive git operations | **Forbidden**; commit with `git commit -s`. |

## Completed when

1. `node scripts/lint-framework-vocabulary.mjs` exits 0 (this is CI's failing check; run `pnpm lint:framework-vocabulary` if a script alias exists).
2. `pnpm --filter @prisma-next/language-server test` green, 5 consecutive runs.
3. `pnpm typecheck` green; touched-package lint green.

## Report back

Post-reword vocabulary count + final threshold; the exact reword diff summary; the dispose-ordering change; 5-run result; gates; commit SHA.

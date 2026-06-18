# Slice: un-namespaced-pg-defaults-to-public — Dispatch plan

_(In-project slice. Spec: [`./spec.md`](./spec.md). Linear: [TML-2916](https://linear.app/prisma-company/issue/TML-2916).)_

## Shape

Two dispatches. The spec's first Open Question is "where exactly is the `__unbound__` drop?" — it must be answered before the fix is written, because the fix's scope (one path or two) depends on the answer. The natural hand-off boundary is **diagnosis → fix**: D1 produces a precise locus + a one-paragraph fix sketch + a failing-test stub; D2 applies the fix, makes the stub pass, regenerates fixtures, and lands the slice. This avoids the anti-pattern of bundling "find the bug" with "fix the bug + regenerate 53 fixtures" into a single dispatch where the implementer's first 30 minutes are diagnostic and the next two hours are mechanical regen — two failure modes with two different recovery paths.

### Dispatch 1: Locus diagnosis + failing-test stub

- **Outcome:** A precise written diagnosis — file:line for every place the un-namespaced PG path drops `'public'` to `'__unbound__'` — plus a paragraph naming the fix shape (which `?? UNBOUND_NAMESPACE_ID` becomes `?? target.defaultNamespaceId`, in which file, and why that satisfies ADR 223). A **failing test** is added to `packages/2-sql/2-authoring/contract-psl/test/interpreter.namespaces.test.ts` (or sibling) that emits a PG contract from a PSL doc with a bare `model user { id String @id }` and asserts:
  1. `result.value.domain.namespaces.public.models.user` is present.
  2. `result.value.storage.namespaces.public` is present with `kind: 'postgres-schema'` (after serialization round-trip if asserting the JSON form).
  3. `result.value.domain.namespaces.__unbound__` is absent.
  4. `result.value.storage.namespaces.__unbound__` is absent.
  Test runs red on `main` (the bug); the failing-test artifact is the diagnostic's deliverable. The TS-builder authoring path (`build-contract.ts`) is also inspected — diagnosis includes "TS builder is correct as-is" or "TS builder has the same bug and needs the same fix" (one of the two — record which).
- **Builds on:** None. Read-only investigation against `main` + the spec's investigated landmarks.
- **Hands to:** A diagnosis document + a failing test + a fix-sketch paragraph. D2 executes against this.
- **Focus:** Diagnosis. No production-code changes; the test is the only added artifact. The implementer is expected to spend most of the dispatch reading `buildSqlContractFromDefinition`, the PSL interpreter, and `build-contract.ts`, then write the failing test that reproduces the symptom at the IR layer (NOT at the planner layer — that's downstream noise; the IR-level test is what pins ADR 223 directly). Record findings in `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/un-namespaced-pg-defaults-to-public/diagnosis.md` (a new file the dispatch creates).

**Dispatch-INVEST check.** _Independent_ — pure read + test-add against `main`. _Negotiable_ — outcome named (locate the drop, write the failing test, sketch the fix); the implementer's grep finds the call sites. _Valuable_ — D2's fix has nowhere to land without it. _Estimable_ — binary: the diagnosis names the locus with file:line; the failing test runs red. _Small_ — one new test + one new diagnosis markdown file; no source edits. _Testable_ — `pnpm --filter @prisma-next/sql-contract-psl test` runs and the new test fails with a clear assertion message; existing tests stay green. (Single-package run, so no `:agent` variant per `.agents/rules/running-tests.mdc`.)

### Dispatch 2: Apply the fix + regenerate fixtures + verify the test passes

- **Outcome:** The fix sketched in D1's diagnosis is applied at the named locus (or loci — PSL interpreter and/or TS builder, per the diagnosis). The D1 failing test now passes. `pnpm fixtures:emit` is run; all regenerated artifacts under `examples/prisma-next-demo/fixtures/*`, `examples/*`, and any `packages/3-extensions/*/migrations/*` PG fixtures are committed. `pnpm fixtures:check:agent` is green. The grep gate `git grep -nE "targetId === 'postgres'|=== \"postgres\"" packages/{1-framework,2-sql}/` shows no namespace-defaulting branches (per ADR 223; if one slipped in pre-existing, remove it). Downstream consumers (`resolveNamespaceIdForIssue`, `verify-sql-schema.ts`, `postgres-contract-serializer.ts`) are left untouched — the diagnosis must confirm they're correct on the post-fix IR (and the spec's investigated landmarks support this). The PG extension packs (`pgvector`, `postgis`, `sql-orm-client` test fixtures) are inspected per the spec's Open Question 2: if they're un-namespaced and incidentally hit by the same bug, their regenerated `contract.d.ts` will shift to `postgres-schema` — commit. If any of them deliberately use `namespace unbound { … }` for late-binding, leave them.
- **Builds on:** D1's diagnosis + failing test.
- **Hands to:** The slice's named outcome — ADR 223 compliance for un-namespaced PG, fixtures regenerated, invariant pinned by a test that goes red without the fix.
- **Focus:** Mechanical execution against D1's sketch. The risk surface is (a) the fixture regen being incomplete (a fixture not under the `fixtures:emit` glob), (b) downstream consumers turning red because they relied on the `__unbound__` bug, and (c) the TS-builder path needing the same fix (already surfaced by D1).

**Dispatch-INVEST check.** _Independent_ — D1's sketch makes the implementation surface concrete; this dispatch executes against it. _Negotiable_ — outcome named (apply the fix; make the test pass; regenerate fixtures; verify gates). _Valuable_ — closes the slice's named outcome. _Estimable_ — binary: D1's test passes; `pnpm fixtures:check:agent` is green; the grep gate is clean. _Small_ — 1–2 source edits (the locus fix) + the regenerated fixtures. _Testable_ — `pnpm fixtures:check:agent` + the new test + `pnpm --filter @prisma-next/sql-contract-psl typecheck + test` (single-package, no `:agent`) + `pnpm test:packages:agent` to catch downstream consumers that broke on the IR change. Per `.agents/rules/running-tests.mdc`: read the printed log path; don't pipe `:agent` to grep/tail; don't re-run to refine a grep.

## Handoff contract — linearity + DoD completeness

- **Linearity.** D2 builds on D1's diagnosis + failing test (cannot start until the locus is known and the test exists).
- **DoD completeness.** The slice spec lists three DoD items:
  1. _PG demo fixtures carry `public` namespace with `kind: 'postgres-schema'`; no `__unbound__` in un-namespaced PG fixtures._ → satisfied by **D2** (fixtures regenerated).
  2. _The new emit-then-consume test passes (and goes red without the fix)._ → satisfied by **D1** (test stub red on `main`) + **D2** (test green after fix).
  3. _No `targetId === 'postgres'` namespace branch exists in framework/family/foundation packages._ → satisfied by **D2** (grep gate).

## Model-tier routing

D1 (diagnosis — wide read, requires understanding ADR 223's invariant + the interpreter's flow + the TS-builder's parallel path) → **sonnet-mid**. D2 (mechanical fix + fixture regen) → **sonnet-mid**. Reviewer pass at slice DoD → **opus-high**.

## Notes for the build loop

- **D1 must read ADR 223 first.** The fix is "make the implementation match the ADR." The diagnosis must explicitly state which ADR clauses are violated by the current code. Skipping ADR 223 risks producing a fix that introduces a per-target branch — exactly what ADR 223 forbids.
- **D1's failing test pins the IR, not the planner.** The PG planner's `resolveNamespaceIdForIssue` has a `?? UNBOUND_NAMESPACE_ID` fallback that fires when the *issue* lacks a namespaceId; that fallback is downstream symptom, not root cause. A planner-level test would catch the symptom but not pin the IR-level invariant. The D1 test must operate at the contract IR layer (`domain.namespaces` / `storage.namespaces` shape on the emitted contract) so the regression cannot return through a different code path.
- **D2's fixture regen scope.** `pnpm fixtures:emit` per the root `package.json` covers `examples/*`, `apps/*`, `@prisma-next/sql-builder`, `@prisma-next/sql-orm-client`, `@prisma-next/e2e-tests`, `@prisma-next/integration-tests`, plus `packages/3-extensions/*` via `build:contract-space`, plus `pnpm migrations:regen` + `pnpm migrations:regen:examples`. Run the full command; inspect `git status` after for any tracked `contract.json` / `contract.d.ts` / `end-contract.json` / `start-contract.json` / `*.sql` / `migration.json` / `ops.json` files that *aren't* under those globs. If any exist, surface them — they need a separate regen path or a script update.
- **D2's downstream-consumer audit.** After the fix lands, run `pnpm test:packages:agent` and `pnpm test:integration:agent` (`.agents/rules/running-tests.mdc`). Read the printed log paths to inspect failures; don't re-run the suites to refine a grep. Any test that asserts `__unbound__` for an un-namespaced PG case is asserting the bug; update its expectation to `public` with a code-comment naming TML-2916. Surface any test where the update feels load-bearing — that's where the bug was being relied on as a feature.
- **D2's grep gate.** The grep is `git grep -nE "targetId === 'postgres'|=== \"postgres\"" packages/{1-framework,2-sql}/`. If pre-existing matches turn up that aren't about defaulting (e.g. capability gating, native-type plumbing), leave them — the gate is specifically about *namespace defaulting*. The diagnosis should record which matches are legitimate and which are residual ADR-223 violations.
- **Worktree boundary.** All work stays inside `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/pedantic-pare-ed7e83`. The bot identity rules apply at PR-open time.
- **Rebase before D2.** PR #832 lands `.agents/rules/running-tests.mdc` plus the `:agent` script variants (`pnpm test:packages:agent`, `pnpm fixtures:check:agent`, `pnpm test:integration:agent`, etc.). At the time this plan was written, #832 was not yet merged into the worktree's base. Before running any slow command in D2, rebase against `main` so the `:agent` scripts exist; if for any reason they don't, fall back to redirecting the canonical command's output to `wip/<name>.<ts>.log` manually and reading the file — same workflow, just hand-rolled.

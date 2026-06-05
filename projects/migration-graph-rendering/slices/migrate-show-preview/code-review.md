# Code review — `migrate-show-preview` (TML-2771)

> The reviewer maintains this across rounds. Orchestrator owns § Subagent IDs / § Orchestrator notes.

## Summary

- **Current verdict:** SATISFIED (R2)
- **Dispatches SATISFIED:** D1, D2, D3, D4 clean
- **AC scoreboard totals:** 6 PASS / 0 FAIL / 0 NOT VERIFIED
- **Open findings:** 0 (F1 resolved in `7206dfd95`)

## Acceptance criteria scoreboard

| AC ID | Description (short) | Dispatch | Status | Evidence |
| --- | --- | --- | --- | --- |
| AC-1 | Reserved markers render `@db`/`@contract` (no `<…>`) in overlay **and** `--legend`, across graph/status/list; snapshots regenerated + consistent | D1 | PASS | `migration-list-styler.ts` (`plainMarkers`/`markers`) + `migration-graph-tree-render.ts` (`formatLegendExampleMarkers`, legend text) drop brackets; styler/legend/graph tests updated; formatter grep for `<contract`/`<db` empty. Commit `6d0a357f5`. |
| AC-2 | `parseContractRef` accepts `@db` (connection-required) + `@contract` (offline); clear error on offline `@db`; unit-tested | D2 | PASS | `contract-ref.ts:36-55`: `@contract`→`reserved-contract` (requires `ctx.contractHash`, else `not-found`); `@db`→`reserved-db` sentinel. 4 unit tests in `contract-ref.test.ts`. Offline-`@db` error surfaced by command (`migrate.ts:234-243`). Commit `ffd292879`. |
| AC-3 | `migrate --show` prints the ordered execution list; default from = live marker, explicit `--from` offline; edge cases (no-path/at-target/multi-space/`@db`-no-conn) | D3 | PASS | `migrate.ts:135-438`; ordered list + summary; edge cases covered in `migrate-show.test.ts` (no-path, at-target, `--db`-required, `@db`-no-conn). Commit `9c5bdd156`. |
| AC-4 | **Read-only:** `--show` returns before `runMigration()`; no marker/ledger/DDL writes reachable | D3 | PASS | `executeMigrateShowCommand` has no write call; client use limited to `connect`/`readAllMarkers`/`close`. Module-level `runMigration` mock throws on any call; asserted not-called (`migrate-show.test.ts:33-42,169`). Structural, not incidental. Commit `9c5bdd156`. |
| AC-5 | **Faithfulness:** path computed via `graphWalkStrategy()` — same seam as apply, not a reimplementation | D3 | PASS | Inputs now assembled in ONE shared site: `planMemberPath()` (`operations/migrate.ts:369`) feeds `graphWalkStrategy` `currentMarker: liveMarker` (full record, :413) and `targetInvariants = refInvariants ?? headRef.invariants` (:403-404). Both callers pass equivalent args: `executeMigrate:163` and show `commands/migrate.ts:346`. Divergence structurally impossible. Strengthened faithfulness tests assert call-arg equivalence (incl. invariant-bearing `--to` ref fixture). F1 resolved. Commit `7206dfd95`. |
| AC-6 | `migrate --show` graph: chosen path bright-green, off-path dimmed/unlabelled, `@`-vocabulary; reuses existing annotation hook (no parallel renderer) | D4 | PASS | `migration-graph-tree-render.ts`: extends `MigrationEdgeAnnotation` with `pathHighlight` (`on-path` greenBright+`↑ will run`; `off-path` blank name + dim hash). Command builds map from on-path hash set (`migrate.ts:381-388`). Snapshot test asserts on/off-path labelling. No parallel renderer. Commit `9bc81455f`. |

Status: `PASS` / `FAIL` / `NOT VERIFIED — <reason>` / `OUT OF SCOPE`.

## Subagent IDs

- **Implementer:** `a6794e1e5ade9c01c` (sonnet) — D1–D4 R1. Swap → `ab391f502ed0da567` (sonnet) for R2/F1 (harness exposes no resume tool; fresh subagent per round, recorded per continuity rule).
- **Reviewer:** `a8004f2c570c470fa` (opus) — R1. Swap → `a7f5d967cb649fe87` (opus) — R2 (same resume-unavailable reason).

## Findings log

### F1 — `migrate --show` assembles `graphWalkStrategy` inputs differently from real `migrate`; the previewed path can diverge

**Severity:** must-fix

**Where:** `packages/1-framework/3-tooling/cli/src/commands/migrate.ts:296,330,333` (and the dropped `--to`-ref invariants at `:183-201`) vs `packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts:160,192-206`. Consumed by `graph-walk.ts:61` → `migration-graph.ts:325`.

**What:** AC-5 requires the preview to be faithful — the path it shows must be the path `migrate` would actually run. The show command calls the same seam (`graphWalkStrategy`), but feeds it different invariant inputs:

1. **Live-marker invariants are dropped.** On the live-marker path the command reads only `marker?.storageHash` (`:296`) and then builds `currentMarker = { storageHash: fromHash, invariants: [] }` (`:333`). Real `migrate` passes the full live marker, including its `invariants` (`operations/migrate.ts:160`). Inside `graphWalkStrategy`, `required = headRef.invariants \ markerInvariants` (`graph-walk.ts:61`); with the marker's invariants discarded, the preview's `required` set is the *full* head-ref invariant set instead of the remainder.
2. **`--to`-ref invariants are ignored.** The command extracts only `toResult.value.hash` (`:183-201`) and always targets with the *file head ref's* invariants (`:330`). Real `migrate` targets with the resolved ref's invariants (`refInvariants ?? headRef.invariants`, `operations/migrate.ts:192-199`).

`required` is a genuine path-selection input — it flows into `findPathWithInvariants(graph, fromHash, toHash, required)` (`migration-graph.ts:325`) and changes which path is selected (and whether the already-at-target empty-path short-circuit at `:309` applies). So on any contract graph that uses invariants, the previewed ordered list / highlighted path can differ from what `migrate` actually runs. That is exactly the "the preview can lie" failure D-MS4 / D-MS6 exist to prevent.

(Lower-severity sibling, same root cause: empty-graph members are silently `continue`d in the preview (`:322-325`) where real `migrate` either records an at-head resolution or fails loudly via `buildNeverPlannedFailure`. Fold into the same fix; not separately blocking.)

**Why it matters:** The slice's whole purpose is a sanity check the user can trust before they advance the live DB. A preview whose path can differ from the real run on invariant-bearing graphs defeats the feature and silently misleads. The faithfulness *test* only asserts `graphWalkStrategy` was *called* (`migrate-show.test.ts:172-190`), so it does not catch this — the inputs are untested.

**Recommended next action:** Make the two callers share the input assembly so divergence is structurally impossible. Either (preferred, the spike's optional wrapper) extract a `previewMigrationPath(member, …)` helper that computes `targetHash` / `targetInvariants` / `currentMarker` once and is called by both `executeMigrate` and `executeMigrateShowCommand`; or, at minimum, in the show command: (a) carry the live marker's `invariants` through `readAllMarkers()` into `currentMarker` instead of `[]`, and (b) capture the `--to` ref's invariants and use them as the target member's `headRef.invariants`. Then strengthen the faithfulness test to assert the `graphWalkStrategy` call arguments match what `executeMigrate` would pass for the same fixture (e.g. an invariant-bearing graph where full-vs-remainder `required` selects different paths), not merely that the function was called.

**Status:** resolved (commit `7206dfd95`). Both original divergences fixed at a single assembly site (`planMemberPath`, `operations/migrate.ts:369`): (1) live-marker invariants now carried — show stores the full `marker ?? null` record (`commands/migrate.ts:316`) and the helper passes `currentMarker: liveMarker` (`:413`), so no stripped `{ invariants: [] }` shell exists on the live path; (2) `--to`-ref invariants captured from the resolved ref (`commands/migrate.ts:201-205`) and applied via `targetInvariants = refInvariants ?? headRef.invariants` (`:403-404`). Empty-graph case aligned: `at-head` → skip (show) / at-head-resolution (apply); `never-planned` → loud error in both. `executeMigrate` is a pure extraction — same error taxonomy (`buildNeverPlannedFailure`/`buildPathNotFoundFailure`/`errorNoInvariantPath`), same `atHeadResolutions`/`perSpacePlans` population, still hands to `runMigration`. Faithfulness tests strengthened to assert call-arg equivalence on an invariant-bearing `--to`-ref fixture; the second test would have failed on the original Bug #2 (asserts `headRef.invariants === ['inv-a']`, was `[]`).

## Round notes

### Slice migrate-show-preview R1 — ANOTHER ROUND NEEDED

**Scope:** D1–D4. Commits `6d0a357f5..9bc81455f`.

**Tasks:** D1 (relabel) clean. D2 (`@`-tokens) clean. D3 (`--show` read-only + list) — read-only clean, faithfulness fails (F1). D4 (graph viz) clean.

**AC delta:** AC-1/AC-2/AC-3/AC-4/AC-6 NOT VERIFIED → PASS (commits as scoreboard). AC-5 NOT VERIFIED → FAIL — preview computes `required` invariants from inputs that diverge from real `migrate`, so the previewed path can differ (F1).

**Findings:** F1 (must-fix).

**For orchestrator:** none — F1 is in-PR addressable by the implementer (align `graphWalkStrategy` inputs / add the shared `previewMigrationPath` helper, then strengthen the faithfulness test). Transient-ID scan on the round's `+` diff: zero hits.

### Slice migrate-show-preview R2 — SATISFIED

**Scope:** F1 fix. Commit `7206dfd95` (on `9bc81455f`).

**Tasks:** D3 faithfulness now clean — shared `planMemberPath` helper assembles `graphWalkStrategy` inputs once; both callers feed equivalent args. `executeMigrate` apply is a behaviour-preserving extraction.

**AC delta:** AC-5 FAIL → PASS (commit `7206dfd95`, tests `migrate-show.test.ts:209-282`). Single assembly site `operations/migrate.ts:369`; callers `executeMigrate:163` + show `:346`. Both Bug #1 (live-marker invariants) and Bug #2 (`--to`-ref invariants) structurally fixed.

**Findings:** F1 resolved. No new findings.

**For orchestrator:** none. Transient-ID scan on R2 `+` diff: zero hits. Gates trusted (typecheck + cli 1209 + migration-tools 549 green per implementer; `migration-list-json-golden` concurrent flake pre-existing, also on TML-2780).

## Orchestrator notes (R1 triage)

- **Intent-validation of R1 verdict: pass-through.** F1 confirms the faithfulness concern (Orchestrator notes #1); the verdict reflects intent — a preview that can diverge from the real `migrate` defeats the slice's reason to exist. Looping to the implementer.
- **Direction for R2:** take the **preferred** fix — extract a shared `previewMigrationPath(...)` helper that assembles `targetHash` / target-invariants / `currentMarker` (incl. live-marker invariants and the resolved `--to`-ref invariants) and runs `graphWalkStrategy`, called by BOTH `executeMigrate` and `executeMigrateShowCommand`, so faithfulness is structural, not "keep two sites in sync." Fold in the empty-graph-member sibling (preview `continue` vs real at-head-resolution/loud-fail). Strengthen the faithfulness test to assert call-argument equivalence on an invariant-bearing fixture (full-vs-remainder `required` selects different paths). Refactoring `executeMigrate` to call the helper is in-scope and must stay behaviour-preserving (its apply path unchanged).

- 4 feat commits `6d0a357f5` (D1 relabel) / `ffd292879` (D2 tokens) / `9c5bdd156` (D3 show+list) / `9bc81455f` (D4 graph). DoD pre-check: scope matches plan (migrate.ts, the 2 formatters, contract-ref + refs/types, tests); read-only + faithfulness tests present; no reserved-marker angle brackets remain; **control-api `executeMigrate`/`run-migration` bodies 0 lines changed** (no apply-path drift); deferred migration-tools apply-vocab untouched. Pre-existing concurrent-only flakes in `control-api/client.test.ts` (also seen on TML-2780) — not introduced here.
- **#1 reviewer focus — faithfulness depth (D-MS6).** The show path is a *new* `executeMigrateShowCommand` in `commands/migrate.ts` that calls `graphWalkStrategy()` directly; the control-api `executeMigrate` was NOT refactored to share a seam. The faithfulness test proves `graphWalkStrategy` is *called*, but not that it's called with the **same inputs/config** `executeMigrate` uses (aggregate, currentMarker, target-hash resolution, required invariants, per-space policy). Verify the previewed path is guaranteed identical to what real `migrate` would run — if the input assembly diverges, the preview can lie (the exact failure D-MS4/D-MS6 guard against). If it diverges, the fix is a shared `previewMigrationPath` helper both call (the spike's optional wrapper) or aligning the inputs.
- Also confirm: the `@db`-with-no-connection edge case has a clear error (D2's negative test was `@contract`-without-hash; the `@db` offline path is handled in the command — verify it's covered).

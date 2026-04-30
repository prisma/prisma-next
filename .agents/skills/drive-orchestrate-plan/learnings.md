# Learnings — `drive-orchestrate-plan`

Canonical lessons drawn from prior runs of this orchestrator. Read this when starting a new project or when you find yourself re-deriving a pattern.

These are written as **patterns to watch for**, not as commandments. The orchestrator's job is to recognize the shape and act on it.

---

## The fixture-foot-gun pattern

**Shape:** A test fails for a fixture-shape reason — e.g. a manifest and an ops list passed to two different helpers, producing internally inconsistent on-disk state. The implementer threads them correctly to fix the failing test, declares done.

**Watch for:** the broken pattern likely exists at multiple call sites. A single fix is a band-aid; a fixture-API redesign that makes the inconsistency unrepresentable by construction is the durable fix.

**Orchestrator action:** when a single fixture-shape fix lands, ask the reviewer to scan the test base for the pattern. If multiple sites exist, treat fixture-API consolidation as a finding, not a side concern.

**Origin:** TML-2264 Phase 1 R3 pivot — `writeAttestedTestPackage` collapsed into `writeTestPackage` after multiple sites were found to be threading inconsistent inputs.

---

## The cross-package validation gate gap

**Shape:** A phase deletes or renames a public export. The validation gate runs `pnpm -F @scope/<package> test` (package-scoped) and passes. Consumers in other packages or `test/integration/` still import the deleted symbol.

**Watch for:** any phase whose tasks delete or rename anything in a public surface (`exports`, top-level public types, package-level helpers).

**Orchestrator action:** before the phase begins, audit `plan.md`'s validation gate. If it doesn't include cross-package tests (`pnpm test:integration`, workspace-wide `pnpm test`) and a grep for the deleted/renamed symbol across `test/ examples/`, amend the gate. Do this in advance, not after an escapee surfaces.

**Origin:** TML-2264 Phase 1 deleted `verifyMigration`; the package-scoped gate passed; an integration test in `migration-plan-details.e2e.test.ts` continued to import it for ~73 commits before Phase 3's cross-package gate caught it.

---

## The diagnostic-equality assertion pattern

**Shape:** A spec AC says "the same diagnostic / message / output is surfaced regardless of which entry point triggered the failure". Tests assert on substring presence per entry point ("the message contains MIGRATION.HASH_MISMATCH").

**Watch for:** substring presence is necessary but not sufficient. Two entry points can both contain the substring while diverging in what surrounds it (one renders the full why/fix, another renders only the code).

**Orchestrator action:** when a uniformity AC is in scope, ensure the test plan includes a cross-entry-point text-equality assertion (`expect(new Set(diagnostics).size).toBe(1)`), not just per-entry-point presence assertions. The presence assertions catch absence; the equality assertion catches divergence.

**Origin:** TML-2264 F07 stiffening of T3.5 — the original "presence in each command" framing missed the divergence-surface; the rewrite added a single closing equality assertion over the four (then five) captured diagnostics.

---

## The honest-implementer-pushback pattern

**Shape:** A reviewer finding asserts a particular root cause for a failure (e.g. "this flake is caused by filesystem collision"). The implementer investigates and finds the actual root cause is different (e.g. "it's a 100ms timeout under CPU contention; the test config is `maxWorkers: 1`, no filesystem sharing exists; there's a prior commit that fixed three of the four cases with a timeout bump").

**Watch for:** an implementer report that contains structured pushback with file paths, prior commit SHAs, and behavior citations. This is high-value evidence, not whining.

**Orchestrator action:** route the disagreement back to the reviewer for re-evaluation, with the implementer's evidence inline. Update `code-review.md` to record the corrected diagnosis. Do not rubber-stamp the original finding just because it came from the reviewer first.

**Origin:** TML-2264 Phase 1 R3 — the `client.test.ts` flake. Reviewer initially diagnosed filesystem-path collision; implementer demonstrated with prior commit `bd19d89791` that the actual cause was a missed timeout asymmetry on a fourth test that the prior fix had skipped.

---

## The reviewer epistemic boundary pattern

**Shape:** The reviewer issues a verdict — most often `SATISFIED` — that's locally defensible against the spec and plan, but misses a subtle drift from intent that the orchestrator (with conversation history) would catch. Or: the reviewer treats existing structural choices as load-bearing constraints to validate against, rather than design decisions to question — letting questionable architecture pass through review unflagged. Once a verdict is `SATISFIED`, the next iteration treats it as ground truth, and the drift hardens.

**Watch for:** reviewer verdicts reached purely by checklist-matching artifacts. The reviewer's role is to validate that the implementation matches the spec; the orchestrator's role is to validate that *both* match the project's intent. Without an intent-validation checkpoint, reviewer mistakes imprint into subsequent rounds and rollback gets expensive.

**Why this is structural, not reviewer competence:** sub-agents have no access to the orchestrator's conversation with the user — even when the same subagent ID is resumed across rounds (see SKILL.md § Subagent continuity), what's retained is the subagent's own task transcript, not the user-orchestrator conversation that produced the spec. The implementer reasons forward from artifacts (plan tasks → diff); the reviewer reasons forward from artifacts (spec ACs → implementation match); only the orchestrator reasons forward from *intent* — user-stated non-negotiables, the strategic shape across phases, the trade-offs the user weighed when deciding the spec. The spec and plan are checklist artifacts; the conversation that produced them is not. This asymmetry is load-bearing regardless of subagent continuity.

**Orchestrator action:** apply an intent-validation pass between every reviewer verdict and the next delegation (codified in `SKILL.md` § Loop algorithm step 7). Read the verdict, the AC scoreboard delta, the new findings, and any refreshed narrative artifacts. Cross-check against the strategic shape with four questions — does the verdict reflect intent (not just artifact-match)? Did the reviewer let any architectural choice through that I should question? Are finding severities calibrated correctly given cross-phase context? Is anything missing that the conversation history would have flagged? Outcomes: pass-through (most common), re-prompt the reviewer with a focused gap, override a verdict (rare; record visibly under `## Orchestrator notes` in `code-review.md`), or refine spec/plan if the upstream-intent itself drifted.

**The cost is small; the protection is large.** Two-minute skim. The orchestrator already holds the project's mental model — applying it at the review checkpoint, not building it from scratch. Skip this step and you bake reviewer drift into the artifact trail.

**Origin:** TML-2264 — three concrete instances surfaced this pattern.

- **F03 (plane-cleanliness drift).** Phase 1 reviewer evaluated against the spec's "plane-clean" claim and didn't flag that Phase 2 added JSDoc to a framework-components file, violating that claim. The drift surfaced only because the user — applying their own intent visibility — asked about something adjacent.
- **The flake misdiagnosis.** Reviewer confidently asserted "filesystem-path collision" as the root cause for `client.test.ts` flake; only implementer pushback (with concrete evidence: prior commit SHA, vitest config, mocked emitter) caught the actual cause. The reviewer's diagnosis was authoritative-sounding but wrong; without pushback, the wrong fix would have shipped.
- **F13 (Phase 1 validation gate gap).** Phase 1 reviewer didn't flag that the gate excluded `pnpm test:integration`. The gap escaped for ~73 commits before Phase 3 surfaced a regression. A reviewer-of-reviewer pass that asked "does this gate exercise consumers outside the package?" — exactly the orchestrator's intent-frame question — would have caught it.

Each was a case where intent visibility, applied at the review checkpoint, would have prevented downstream pain.

---

## The replan-mid-loop pattern

**Shape:** During a review round, a finding surfaces that's bigger than a tactical fix — it expands the PR's scope (e.g. "we should also rename X while we're here"; "this latent inconsistency in another command should also be fixed"; "the spec needs a new AC because we discovered a UX edge case").

**Watch for:** any finding that introduces new tasks, new validation gates, or new ACs. These cannot be picked up silently in the next implementer round.

**Orchestrator action:** pause the loop. Surface to the user as a structured decision (see SKILL.md § Escalation surface). User decides scope. Translate the decision into plan/spec edits **before** re-delegating. Plan amendments live on disk; conversation memory is not durable.

**Origin:** TML-2264 multiple instances — F12 (`mapMigrationToolsError` extraction added to Phase 6), F13/2a (Phase 4 validation gate strengthened), F14 (`migration new` tamper test added as T3.8). Each was a replan trigger that landed in `plan.md` before the implementer saw it.

---

## The stale-artifact pattern

**Shape:** `system-design-review.md` and `walkthrough.md` were written during Phase 1; the loop has now run through Phase 2-3 with significant pivots. The narrative documents describe the original design, not the as-built.

**Watch for:** any time the loop has run 2+ phases past when these documents were last touched. The documents drift silently; nobody notices until someone (often the user) asks.

**Orchestrator action:** at every phase transition, evaluate freshness. If stale, ask the user whether to refresh now (delegate to the reviewer) or defer. Don't let drift accumulate across many phases.

**Origin:** TML-2264 — user noticed mid-Phase-2 that `system-design-review.md` and `walkthrough.md` were stale ("Where are the review artifacts? The ones I see are stale, from phase 2"). Should have been caught proactively at the Phase 1 → Phase 2 transition.

---

## The missing-narrative-artifact pattern

**Shape:** A reviewer returns `SATISFIED` for a phase but produces only `code-review.md`, deferring `system-design-review.md` and `walkthrough.md` to a later milestone with a justification like "design surface too small to write yet" or "wait until the runtime is concrete." The orchestrator accepts the deferral without escalating, and the user later asks "where are the review artifacts?" — discovering that the walkthrough they would have used to understand the round's output never existed.

**Why this matters more than stale-artifact:** the user reads the walkthrough as their **primary review surface** for any single round. Without it, they cannot review the round, even if `code-review.md` says `SATISFIED`. A small walkthrough is not noise; an absent walkthrough is unreviewable output. The SDR matters too: even rounds that don't change design add corroborating evidence (commits, tests, validation results), and skipping the SDR breaks the chain of evidence that lets future reviewers (and the user) verify the design held.

**Watch for:** any reviewer return that lists `code-review.md` as the only file modified. The reviewer's "Files modified" section must list all three; the orchestrator's stale-artifact check must verify it before accepting the verdict.

**Orchestrator action:**
- Treat a one-file return as a delegation-protocol failure on the same level as a missing verdict. Re-prompt the reviewer with a refresh-only delegation; do not accept the phase as `SATISFIED` until both narrative artifacts reflect HEAD.
- Stale-artifact check is no longer "ask the user whether to refresh" — it is "verify the reviewer refreshed; re-delegate if not." Codified in `SKILL.md` § Loop algorithm step 9 and § The artifact contract.

**Origin:** codec-async-single-path m1 — R1 reviewer returned `ANOTHER ROUND NEEDED` with the SDR/walkthrough deferred to m2 ("project too early"); R2 reviewer reaffirmed the deferral; orchestrator accepted both times. User asked "Where are the Drive review artifacts?" after m1 closed. Producing them retroactively (against m1 SATISFIED state) was straightforward — the cost was the user's surprise and the broken expectation that "SATISFIED" would mean "user can review the round." The miss came from interpreting the original SKILL.md "stale-artifact check" language as permitting deferral; the rewrite makes per-round refresh mandatory.

---

## The close-out vacuum pattern

**Shape:** The project reaches its final milestone with the rolling review artifacts (`reviews/code-review.md`, `reviews/system-design-review.md`, `reviews/walkthrough.md`) maintained per-round under `projects/<project>/reviews/`. The reviews directory is gitignored. The implementer's close-out commit deletes `projects/<project>/` per `drive-project-workflow.mdc`. The `rm -rf` sweeps the gitignored `reviews/` directory along with the rest of the project content. Two distinct losses follow:

1. **Lost institutional memory.** Decisions captured only in the rolling artifacts (per-round notes, severity calibration narratives, finding-closure reasoning, design rationale that didn't make it into ADRs) disappear. The ADR + subsystem doc + READMEs absorb the *durable* content during the close-out milestone, but anything the close-out forgets to migrate is gone with no recovery path.
2. **Lost final-state review surface.** The walkthrough is the user's primary review surface for any single round (see § The missing-narrative-artifact pattern). The close-out is itself a round, and without explicit production of a final walkthrough, the user inherits a PR they can read at the cumulative-diff level but not at the round-narrative level. Even if every per-round walkthrough was perfect, the cumulative branch story is *not* the sum of the per-round stories — it requires fresh-eyes synthesis against the project base.

**Why this matters more than stale-artifact:** stale artifacts are a maintenance failure (the loop didn't refresh on every round). The close-out vacuum is an architectural failure — the artifacts were refreshed correctly every round, then deliberately deleted by a separate skill (`drive-project-workflow`) that doesn't know about the rolling-artifacts contract. The two skills compose poorly without an explicit coordination point.

**Why the original SKILL.md was implicit about this:** the `drive-project-workflow` rule's close-out protocol was written assuming the reviewer's outputs are either (a) shipped artifacts under `docs/` or (b) per-PR comments — neither of which match `drive-orchestrate-plan`'s gitignored rolling artifacts. The composition gap surfaced only when both skills ran end-to-end on the same project.

**Watch for:**
- Any project where close-out is approaching and the orchestrator hasn't audited which load-bearing decisions live only in the rolling artifacts.
- Any project where the close-out review (if one exists) is a per-round refresh of the iterate-loop reviewer's narrative rather than a fresh-eyes branch-scoped review.
- The user re-engaging post-close-out and asking for "the review artifacts" — if the project dir is already deleted, you'll have to either reconstruct from process notes or accept the loss.

**Orchestrator action:**
- Run the close-out checkpoint codified in `SKILL.md § Project close-out checkpoint`. Two steps: (1) audit that every load-bearing decision in the rolling artifacts has a durable home in the repo (ADR / subsystem doc / README / follow-up ticket); (2) delegate `drive-pr-local-review` for a branch-scoped final-state review (spawn fresh; output to `wip/<project>-close-out-review/`). Both steps must pass before authorizing the project-dir delete.
- The branch-scoped review is *not* a per-round refresh. Spawn a fresh subagent (deliberately breaking the persistent-reviewer continuity rule for this one delegation; document the break in the orchestrator's process notes per § Subagent continuity). The fresh subagent reads the cumulative diff against the project base and produces artifacts whose scope matches what a PR reviewer would see — which is what the user actually needs at close-out.
- Output the close-out review to `wip/<project>-close-out-review/`, not `projects/<project>/reviews/`. The whole point is that the artifacts must survive the project-dir delete.

**Origin:** codec-model-unification close-out — M5 R1's implementer correctly executed `drive-project-workflow`'s delete step, including the gitignored `projects/codec-model-unification/reviews/` directory. The reviewer regenerated M5 R1's three artifacts under `wip/` to capture the close-out specifics, but the M1-M4 rolling-artifact deltas were lost. ADR 205 absorbed the load-bearing design content so the loss was tolerable, but the user's process post-mortem flagged that it worked out by luck rather than by protocol — a more design-decision-heavy project would have lost institutional memory at close-out without the orchestrator noticing. The user's directive: "rather than copy the last-most review artifacts, have the reviewer produce a fresh set of artifacts whose scope is the entire branch using the drive-pr-local-review skill" — the codified version is `SKILL.md § Project close-out checkpoint`.

---

## The infer-the-spec-you-just-deleted pattern

**Shape:** The close-out checkpoint sequences as: delete `projects/<project>/` first; then delegate the close-out review via `drive-pr-local-review`. The reviewer arrives at a branch with no in-repo canonical spec. `drive-pr-local-review`'s § 2 "Establish expectations" step then *infers* a spec from the PR body + diff + commit messages, writes an inferred `spec.md` into the review artifact directory, and verifies the inferred spec's ACs against the diff. The verification passes because **the inferred spec was derived from the same diff being reviewed** — the ACs are tautologically PASS. The user's original spec — with its rejected alternatives, locked decisions, non-goals, and intent that doesn't fully survive the diff — was deleted before the reviewer could read it.

**Why this matters:** the close-out review's job is to verify that the *cumulative* project satisfies the user's original intent. Inferring the spec from the diff makes the review structurally incapable of catching scope drift, dropped non-goals, or rejected alternatives the project re-introduced. The reviewer's "SATISFIED with 8 of 9 ACs PASS" verdict reads correctly but means nothing — the AC list is whatever the reviewer deduced from the diff, not the user's standard.

The defect is sequencing: delete-then-review collapses the only checkpoint that's supposed to verify against intent. Move-then-review preserves the canonical spec as input to the review.

**Watch for:**
- Close-out reviews whose spec is marked "inferred" or "constructed by reviewer" in their preamble notice.
- Close-out reviews whose AC scoreboard maps cleanly to the diff with no surprises — that's a tell that ACs and diff were derived from the same source.
- Any close-out commit that does `git rm -r projects/<project>/` BEFORE the close-out review delegation runs.

**Orchestrator action:** sequence the close-out as **move-then-review**, not delete-then-review. Move `projects/<project>/` to `wip/<project>/` first (the move is a single `git mv`; the destination is gitignored, so the project's content is untracked from git but locally retained on disk). Delegate the close-out review with the canonical spec at its moved location (`wip/<project>/spec.md`) explicitly passed as input; tell the reviewer "do not write a new spec.md; the canonical one is at `wip/<project>/spec.md`." This is codified in `SKILL.md § Project close-out checkpoint § Step 2` (move) and § Step 3 (review with explicit spec pointer).

The move-not-delete approach has a second benefit: post-close-out the user can grep, read, or copy from the moved project artifacts locally without recovering from `git show`. Useful for filing follow-up tickets that reference original task IDs, auditing decisions made during the loop, or recovering a finding's context.

**Origin:** codec-registry-unification close-out — the orchestrator's Step-2 close-out review (per the close-out checkpoint codified earlier in the same session) ran AFTER the project directory was deleted, so the reviewer inferred the spec from PR body + diff + commit messages. The reviewer's "APPROVE WITH FOLLOW-UPS, 5 of 9 ACs PASS, 4 deferred to TML-2357" verdict was structurally correct against the inferred spec but the user immediately flagged that the inferred spec wasn't anchored to the original — a circular verification. The user's directive: "Do not delete the project artifacts, move them whole to `wip/` so they're deleted from git but retained on disk. The close-out reviewer you spawned has *inferred* the project spec, which is stupid. We deleted all the acceptance criteria then asked it to recreate them." The codified fix splits the close-out into Steps 2 (move) and 3 (review-with-canonical-spec).

---

## The noise-finding pattern

**Shape:** A reviewer files a finding whose recommended action is "consider for a future phase," "address in m4 when X is reshaped," "out of scope but worth tracking," or "no action — surfacing for awareness." The finding is technically correct (the observation is real, the framing is fair) but its recommended action does not translate into an in-PR task for the implementer. The implementer's next delegation prompt now contains a finding they cannot act on.

**Why this matters:** every finding the reviewer files reaches the implementer in the next delegation. Findings that recommend "no action" or "defer to a later phase / project" produce noise — the implementer reads them, evaluates them, and then has nothing to do. Worse, real findings get harder to spot in a noisy log. `code-review.md` is a work backlog for the implementer, not a journal of observations.

**The asymmetry with `drive-pr-local-review`:** that skill is one-shot — `Deferred` and `Out of scope` sections there are legitimate output for the human reader. `drive-orchestrate-plan`'s reviewer operates inside an iterate-implement loop; everything they file is consumed by another agent in the next round. The two skills' findings discipline must diverge.

**Watch for:**
- Recommended actions that say "consider," "evaluate later," "worth thinking about," "address when X reshapes," or "file as a follow-up ticket."
- Status values like `accepted-deferral` on a freshly filed finding.
- Findings whose recommended action is for the orchestrator (plan amendment) or the user (decision), not the implementer.

**Orchestrator action:**
- Reject the finding back to the reviewer (re-prompt with a focused gap: "F<N>'s recommended action is not actionable in this PR. Either restate as a concrete in-PR action or surface to me as a plan amendment in § Items for the user's attention").
- For genuine deferral candidates, the orchestrator records them in `plan.md` (§ Open items, future phase task list, or a follow-up ticket) before the next implementer delegation runs. The implementer never sees the deferred item until the appropriate phase, when it appears as a plan task.
- Severity ladder is now `must-fix` / `should-fix` / `low / process` — all three represent in-PR actions and all three block phase `SATISFIED`. Severity is for within-round prioritization only; no severity lets a finding carry across phases. There is no `informational` tier; if a candidate doesn't translate into an in-PR action, it isn't a finding.

**Origin:** codec-async-single-path m1 — F1 ("Undocumented `as unknown as TTraits` cast in `mongoCodec()`") was filed as `low / process` with recommended action "address during m4's T4.2 reshape." Pre-existing fragility unrelated to the m1 surface; no in-m1 action; the orchestrator carried it across m2/m3/m4 review prompts as an "open" finding it could not actually action. Should have been a m4 plan task from the start, surfaced under § Items for the user's attention rather than filed as F1. User flagged the pattern after observing similar shapes in `drive-pr-local-review` outputs.

---

## The side-quest scope pattern

**Shape:** During the loop, the user requests an out-of-scope fix ("just fix the issue now"). The fix is real and unrelated to the project's spec.

**Watch for:** out-of-scope work creeping into phase commits, where it confuses the diff and the audit trail. Or, conversely, the side-quest being silently dropped because the implementer didn't get explicit authorization.

**Orchestrator action:**
- Authorize side-quests explicitly in the implementer's delegation prompt: "fix X if you encounter it; commit separately with a scope-note."
- Require separate commits for side-quest work, with the scope-note in the commit body.
- Track side-quests in the implementer's return report so the reviewer doesn't accidentally evaluate them as in-scope.

**Origin:** TML-2264 — the `client.test.ts` flake fix was a user-requested side-quest. Landed in commit `f4c5c5b9e` separately from phase work, with the scope-note clearly framing it as a pre-existing flake unrelated to the integrity work.

---

## The scoreboard-as-source-of-truth pattern

**Shape:** Mid-loop, several ACs are in flight. Some are PASS (Phase 1-2 ACs), some are NOT VERIFIED (Phase 3+ ACs), some are joint-phase. The orchestrator and user are both tracking progress informally.

**Watch for:** "is the phase done?" questions are easier to answer when the AC scoreboard is the canonical surface. Conversation can drift; scoreboard should not.

**Orchestrator action:** when the user asks "does phase N satisfy the AC?" — the answer is a delta read from `code-review.md`'s scoreboard, not from memory. The reviewer is the only agent who promotes ACs to PASS; if the scoreboard says PASS, the phase is done.

**Origin:** TML-2264 — the user's question "Does phase 2 satisfy the AC? if so, let's proceed to implement phase 3" was answered directly from the scoreboard the reviewer maintained, not by re-evaluating the phase from scratch.

---

## The fresh-subagent procedural-anomaly pattern

**Shape:** The orchestrator delegates round N to a freshly-spawned implementer or reviewer subagent (no `resume`). The fresh subagent inspects the branch and discovers commits that already cover its scope — but the orchestrator did not authorize them, and there is no continuity to determine who landed them. Possibilities considered: a prior round's reviewer subagent strayed across read-only constraints; the user committed something between rounds; another agent in another window ran on the same branch; the implementer of the prior round did extra work that the orchestrator missed in their report. The orchestrator cannot definitively distinguish these cases from the artifact trail alone.

The pattern manifests as the implementer reporting "the work appears to be already complete" or the reviewer noting "F<N> was filed in `code-review.md` but the orchestrator's prompt didn't include it." Both are symptoms of lost continuity — the round-to-round connection between orchestrator and subagent is structurally weaker than it should be.

**Why this matters:** every fresh subagent re-reads the same files, re-derives the same constraints, re-builds the same mental model of the project. That's the small cost. The larger cost is that **fresh subagents cannot cross-check their work against their prior work** — they have no prior work to cross-check against. When unauthorized commits show up on the branch, a resumed subagent would be able to say "I committed those in round 2; I remember the rationale" or "I didn't commit those; let's investigate." A fresh subagent can only observe that the commits exist.

**Watch for:**
- Implementer reports that mention "the work was already partially done" without attributing the prior work.
- Reviewer reports that file findings against commits the orchestrator hadn't seen authored as part of the round.
- Any round where the SHA range surprises the orchestrator — `<base>..HEAD` includes commits the orchestrator didn't expect.

**Orchestrator action:**
- **Default to resume.** SKILL.md § Subagent continuity codifies one persistent implementer ID and one persistent reviewer ID per project, resumed via the `Task` tool's `resume` parameter on every round after the first. Spawn fresh only on the project's first round, on a verified ID-no-longer-accessible failure, or on a deliberate role pivot the orchestrator documents explicitly.
- **Record the IDs on disk.** `code-review.md § Subagent IDs` (immediately under the AC scoreboard) — the IDs are durable artifacts so a subsequent orchestrator session can pick up the same subagents.
- **On any procedural anomaly, ask the resumed subagent.** If unauthorized commits appear on the branch and the implementer is being resumed, the implementer can examine the SHAs against its own prior transcript and report whether they're its work, the user's, or unknown. A fresh subagent cannot answer that question.

**Origin:** codec-async-single-path produced four procedural anomalies during the autonomous m2 → m5 run:
- m1 R2: commits `3a1e48a60` and `adafda3a1` appeared before the orchestrator delegated R2 implementation.
- m4 R1: four m4 commits (HEAD `69e4d527d`) pre-existed before the orchestrator delegated m4 implementation.
- m5 between R1 and R2: commit `e33635ec1` (filed F8 in the review artifacts) was authored by the user themselves, not a subagent — but the orchestrator initially had to investigate to determine that, because the subagents were fresh each round and could not corroborate.
- The PR creation itself: PR #379 already existed when `/create-pr` was delegated, with a body matching the consolidated walkthrough.

In each case the orchestrator reconciled by independently re-verifying. With persistent subagents, three of the four would have been answerable from the implementer's prior transcript, and the fourth (the user's own commit) would have been visible as "not in any subagent's transcript" — a stronger signal than "fresh subagent observes mystery commits."

---

## The deferred-item ledger pattern

**Shape:** During the loop, items are deferred for various reasons — "this should be a follow-up ticket"; "this is out-of-scope for now but worth tracking"; "we agreed to defer this, file under M11".

**Watch for:** deferred items disappearing into conversation memory and getting silently dropped at PR time.

**Orchestrator action:** every deferred item lands in one of three places:
1. **`plan.md § Open items`** — items being deferred to a future phase or explicitly accepted as out-of-PR scope.
2. **A follow-up Linear ticket** — items that warrant their own work item.
3. **The next phase's task list** — items being deferred only to a later phase of *this* PR.

If it's not in one of those three places, it doesn't exist. The orchestrator's mental model is not durable.

**Origin:** TML-2264 — `MigrationMeta` rename deferred to TML-2301 (Open items); emit-drift detection deferred to TML-2316 (Linear ticket); `mapMigrationToolsError` extraction deferred to T6.4 (next phase).

---

## The unattended-log readability pattern

**Shape:** The orchestrator writes a decisions log in unattended mode using internal vocabulary — finding IDs (`F17`), action IDs (`A02a`), round labels as triggers (`Phase 5 R2 triage`), pointers into review artifacts (*"per `code-review.md § Findings log F18`"*). The log is technically correct: each entry preserves the orchestrator's reasoning faithfully against the artifacts that were live at write-time. But by the time the user audits the log — often after close-out has deleted the review artifacts, the per-PR action JSON is gone, and the inflight delegation prompts no longer exist — the entries reference a context the reader cannot reconstruct.

**Why this matters:** the user's bargain in unattended mode is "I trade interactivity for a written audit trail." A log that's only legible inside the orchestrator's head — or only legible while the round-N artifacts still exist — breaks the trade. The user reads the log to answer four questions: *what was decided? why was it flagged? why does it matter? how can I verify it?* An entry that requires opening a deleted file to answer any of those is a bug in the entry, not a deficiency on the user's part.

**The asymmetry that produces the bug:** while writing the log, the orchestrator has full real-time context (the F-numbers map to substantive findings, the round labels map to specific delegation prompts, the artifact references resolve). The reader has none of it. The orchestrator naturally writes from their own context; producing a self-contained entry requires deliberate translation.

**Watch for:**
- Entries that lead with finding IDs or action IDs as the trigger.
- Entries that locate themselves with round labels (*"Phase 5 R2 triage"*) instead of project context (*"during the close-out cleanup, while reviewing files for cross-references that would become dead links"*).
- Entries whose `Why` section quotes other documents (*"per SKILL.md § Findings discipline"*) without restating the substance.
- Entries that lack a *How to verify* section — or whose verification path is "look at `code-review.md` F<N>" rather than "open `<file>:<line>` and check that <observable property> holds."

**Orchestrator action:** use the `./templates/unattended-decisions.template.md` entry format. Every entry must be self-contained — translate IDs into substance, lead with what was decided rather than what surfaced it, and include a concrete on-disk verification path. Codified in `SKILL.md` § Unattended mode → Entry format. The four questions (what / why-flagged / why-matters / how-to-verify) are the contract.

**Origin:** TML-2264 unattended close-out — the user re-engaged after the autonomous run, opened `wip/unattended-decisions.md`, and reported being unable to make sense of entries that referenced `F17`, `F18`, `A02a`, and `Phase 5 R2 triage`. Their stated need: *"What I'm actually interested in is what decision was made? Why was it flagged to begin with? Why is it important? What is the impact of the choice? So that I can verify at the end of the process if anything needs to be corrected."* The log was technically complete but practically unreadable; the format change captures the reader's actual epistemic position rather than the writer's.

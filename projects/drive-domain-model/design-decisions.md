# Design Decisions

Living record of decisions made during shaping. Format mirrors `wip/unattended-decisions.md` from the prisma-next project: each decision has context, the alternatives considered, the choice, the rationale, and what's affected.

## 1. Estimate in complexity, time-box in wall-clock

**Date.** 2026-05-17.

**Context.** Agent-driven dispatches need both an "is this the right size?" check and a "is this taking too long?" check. The natural impulse is to use time for both (e.g. "this should take 30 minutes"), but time-based estimates are unstable across agents, environments, and conditions (model choice, system load, transcript-write latency, test suite flake rates). A 30-minute estimate that becomes 90 minutes carries no signal about why — was the estimate wrong, the agent slow, the environment degraded?

**The concern.** We need a sizing metric that's stable across executors so we can decide whether a dispatch is appropriately scoped before we run it. We also need a separate "is this still on track?" signal during execution.

**Options considered.**
- (a) Time for both estimation and time-boxing. Cannot separate executor speed from estimate accuracy.
- (b) Story points (Fibonacci) for estimation, time for time-boxing. Classic Agile pattern but the Fibonacci precision is overkill for our scale.
- (c) T-shirt sizes (XS/S/M/L/XL) for estimation, wall-clock time-boxing per size. Coarser than Fibonacci but more usable for our cadence; the qualitative scale resists false precision.

**Choice.** (c). Complexity estimation via t-shirt sizes; wall-clock time-boxing per size.

**Why.** Decouples sizing from executor throughput. When a dispatch overruns its time box, we can tell whether the size was wrong (re-estimate up) or the executor is slow (switch model, investigate environment). The two signals stay independent. T-shirt scale is calibration-friendly (anchored to reference tasks rather than abstract numbers) and resists the "exactly 5 vs 8 story points" debate that wastes time.

**Affected.** All future dispatches estimate in t-shirt size + time-box per size. The estimation rubric and the time-box thresholds become part of the protocol.

## 2. Three-dimension complexity decomposition

**Date.** 2026-05-17.

**Context.** A scalar complexity estimate (one t-shirt size) compresses too much information. A codemod that touches 100 files might score M overall but the orchestrator's treatment of it should differ from a 5-file refactor that requires deep judgment — both might be M but they fail differently.

**Options considered.**
- (a) Scalar t-shirt size. Simpler but compresses signal.
- (b) Three independent dimensions, composite size. More informative but requires orchestrator to internalise three scales.
- (c) Per-dimension dispatch treatment (e.g. high-surface dispatches use codemod tooling; high-conceptual dispatches require frequent inspection). Requires the three dimensions but uses them operationally.

**Choice.** (b) + (c). Estimate in three dimensions (conceptual difficulty, surface volume, blast radius); compose to a t-shirt size for size-cap rules; use the per-dimension signal to choose dispatch treatment.

**Why.** The three dimensions map directly to the three failure modes we've observed: drift (high conceptual), breakage (high surface), cascading damage (high blast radius). Treating them independently lets the orchestrator choose the right mitigation per dimension instead of one-size-fits-all. The composite t-shirt size still gates dispatchability (nothing above M).

**Affected.** Briefs include a three-dimension decomposition + composite t-shirt size. Pattern catalog tags dispatch treatments per dimension.

## 3. Hard cap on dispatch size (no L/XL dispatch)

**Date.** 2026-05-17.

**Context.** The empirically-observed failure mode is dispatching feature-sized scopes (L/XL) and letting them run. The mitigation Agile teams use is the structural rule "stories above a threshold cannot be pulled into a sprint" — refactor or decompose first.

**Options considered.**
- (a) Soft rule: orchestrator should prefer smaller dispatches but can dispatch L/XL if needed.
- (b) Hard rule: nothing above M dispatched, ever. L/XL must be decomposed at planning time.
- (c) Per-task escape valve: L can be dispatched with extra-frequent inspection (e.g. 2-min check cadence).

**Choice.** (b). Hard cap. No L/XL dispatched.

**Why.** Soft rules don't survive contact with deadline pressure or "this one's special" reasoning. The reversal we just hit was dispatched as a single L/XL despite the brief describing 4-6 commits across ~50-100 files — the orchestrator's own brief admitted the size, and the dispatch happened anyway. A hard rule that refuses to dispatch L/XL forces the decomposition work to happen, which is also what enables cheaper-agent dispatch of the decomposed pieces.

**Affected.** Orchestrator decomposes L/XL into M-sized stories at planning time. Spikes are used for decomposition when the orchestrator lacks context.

## 4. Time-boxing thresholds per size

**Date.** 2026-05-17.

**Context.** Each t-shirt size needs a wall-clock cap that triggers re-scope (not extension) when overrun. The cap is independent of estimate — overrun means "stop, reassess," not "give it more time."

**Choice.** XS ≤ 5 min, S ≤ 15 min, M ≤ 30 min. (L/XL not dispatched, so no time-box.)

**Why.** These thresholds are loose enough to absorb normal variance (one slow tool call, one re-run) but tight enough that runaway dispatches stop within a usable window. The 30-minute M cap means a 5-minute standup-style check happens 6 times per dispatch — enough to catch drift early, not so much that the orchestrator overhead dominates.

**Affected.** Dispatch time-boxes are enforced at the orchestrator level — overrun triggers interrupt + reassess, not extend.

## 5. WIP-inspection cadence during every dispatch

**Date.** 2026-05-17. (Renamed from "5-minute standup-style check" to "WIP inspection" on 2026-05-17 — "WIP inspection" carries the Kanban lineage rather than the Scrum one and reads better in the Drive context where there are no actual standups.)

**Context.** The drift failure we hit was invisible from file-system proxies (commit cadence, file modification rate). It became visible only when someone read the diff. The fix is to make diff inspection happen periodically, not just at dispatch end.

**Options considered.**
- (a) Per-commit inspection (orchestrator reads every commit as it lands). Best drift detection but requires synchronous orchestrator availability.
- (b) Fixed-cadence inspection (e.g. every 5 min). Balances drift detection with orchestrator's ability to multitask.
- (c) Event-triggered inspection (e.g. orchestrator inspects when N commits queued or when implementer reports a milestone). Misses long quiet drift periods.

**Choice.** (b). ≤ 5 min cadence during every dispatch. The inspection answers three questions: what's been completed, what's in flight, anything blocking + the burn-down question (can the remainder fit in the remaining time-box).

**Why.** Detects drift / blockage early without high-overhead synchronous monitoring. The 5-minute cadence is short enough to catch drift before it compounds (in our failure, the deviation appeared 4 minutes after the prior clean commit — a 5-min cadence would have caught it within the first inspection after).

**Affected.** Every dispatch is monitored at ≤ 5-min cadence. The check involves reading actual diffs of spec-critical files, not stat summaries.

## 6. Agent teams ARE teams; protocol IS the memory

**Date.** 2026-05-17.

**Context.** Initial framing dismissed the Scrum team analogy as inapplicable ("no team — one orchestrator + one implementer"). User corrected: multiple sequential dispatches (and parallel ones) form a team in every meaningful sense, suffering the same failure modes faster, with the added problem of zero organic memory transmission between members.

**The insight.** For human teams, rituals (standup, retro, DoR / DoD) supplement organic memory transmission ("I remember when we tried that before"). For agent teams, rituals ARE the memory. Without written-down lessons in the protocol, every dispatch is a fresh team member starting from zero.

**Consequence for the protocol.** Every failure mode we encounter must be captured in:
- The methodology layer (if it's a general lesson) — e.g. "pre-name edge cases in the brief"
- The project calibration layer (if it's a project-specific anti-pattern) — e.g. "dual-shape support relocated under a new name is the same architectural concern; add discriminator probe patterns to the grep library"

Failure modes that go uncaptured re-happen.

**Affected.** The protocol is treated as the team's institutional memory. Every retro / post-mortem produces a protocol or calibration update.

## 7. Rubric calibration via reference tasks (not absolute scales)

**Date.** 2026-05-17.

**Context.** A t-shirt size scale needs anchoring. Anchoring to abstract criteria ("M = medium complexity") is unstable across estimators; anchoring to reference tasks ("M = this specific past story we all agree was a medium") is more reliable. The reference tasks are project-specific.

**Choice.** Each project that adopts the protocol picks a small set of reference tasks (one per t-shirt size) and estimates new tasks relative to those. Reference tasks are written into the project's calibration docs and updated when calibration drifts.

**Why.** Standard Agile lesson — relative estimation against concrete references is robust; estimation against abstract scales is not.

**Affected.** Each project's calibration docs include a reference-task set. The methodology layer specifies "use reference tasks"; the calibration layer names them.

## 8. Cost optimization as a derived benefit of decomposition

**Date.** 2026-05-17.

**Context.** Well-decomposed M-sized tasks with clear DoD are safe to dispatch to cheaper / faster models — the verification gates catch drift, the small scope limits blast radius, the clear brief reduces interpretation latitude.

**The insight.** Decomposition is cost optimization, not just quality optimization. The agent-team analogue of pulling small stories so junior developers can pick them up confidently. Today's reversal effectively required Opus throughout because the dispatch was too big for any cheaper model to handle safely; properly decomposed, the same work would have been one Opus dispatch (substrate + design judgment) + four cheaper dispatches (mechanical per-consumer migration) + one Opus dispatch (verification + integration).

**Affected.** Dispatch routing decisions consider the per-size model tier. M-sized mechanical dispatches default to cheaper models with strong DoD; M-sized judgment-heavy dispatches default to the orchestrator's tier with strong DoR.

## 9. Spike pattern for planning-time unknowns (brief-type, not a separate skill)

**Date.** 2026-05-17. (Refined on 2026-05-18 — spike is a brief-type variant of an ordinary dispatch, not a separate skill.)

**Context.** Sometimes the agile orchestrator hits a planning question with legitimate unknowns ("how many test sites do we actually need to migrate?", "what's the right shape of this abstraction?"). Guessing leads to bad estimates and bad briefs.

**Choice.** Adopt the Agile spike pattern. A spike is a time-boxed investigation whose Definition of Done is "you have an actionable understanding of what to do," not working code. Spikes have their own DoR (the question is well-formed) and DoD (an output artefact answers the question). Mechanically, a spike is a single-dispatch slice plan with a spike-flavoured brief — no dedicated skill required; `drive-build-workflow` runs it. Spike-first is also a triage verdict for the case where the entire entry-point can't be sized yet.

**Why.** Standard Agile pattern, same role for us. Investigation before commitment. Modelling it as a brief-type variant rather than a separate skill keeps the workflow shape uniform — the orchestrator dispatches a spike the same way it dispatches anything else, just with a different brief DoD.

**Affected.** Briefs that depend on spike outputs are queued behind the spike, not dispatched in parallel. The triage skill (`drive-triage-work`) can emit "spike first" as a verdict.

## 10. General protocol vs project-specific calibration — two-layer split

**Date.** 2026-05-17.

**Context.** Different projects have different test suites, grep libraries, failure-mode catalogues, reference tasks. The protocol must work across projects without baking in any one project's specifics.

**Choice.** Two layers, with clear boundaries:
- **General protocol** (this project): estimation methodology, time-boxing thresholds, DoR / DoD gate patterns, standup structure, spike pattern, brief discipline principles, three-dimension complexity decomposition.
- **Project calibration** (each adopting project's docs): reference tasks for t-shirt anchors, DoD verification commands (which test/lint/grep invocations), failure-mode catalogue, grep library (project-specific anti-pattern patterns).

Both layers are living documents. Each failure mode prompts a check: "does this update the protocol (general) or the calibration (project)?"

**Why.** Avoids the "the protocol works everywhere except where it doesn't" failure mode. Forces explicit thinking about which lessons generalise and which are project-specific.

**Affected.** This project hosts the general protocol; each adopting project hosts its own calibration in its own `docs/`.

## 11. Dispatch is the agent-delegation unit; Step retires to implementer-internal

**Date.** 2026-05-18.

**Context.** Consolidating with the sibling `drive-domain-model` project surfaced a vocabulary collision: the sibling used "step" for what the methodology project called a "dispatch" — the unit of agent-session delegation. The sibling's framing came from a planning lens ("steps within a slice plan"); the methodology project's came from the operational lens ("one delegation to an implementer subagent"). Both senses are valid but compete for the same word.

**Options considered.**
- (a) Use "step" everywhere (sibling's vocabulary wins).
- (b) Use "dispatch" everywhere (methodology project's vocabulary wins).
- (c) Use both — "step" for the planning sense, "dispatch" for the operational sense.

**Choice.** (b) with a renamed (c). "Dispatch" is the real-world unit because that's how we interact with agents; the planning sense uses "dispatch" too (a slice plan is a sequence of dispatches). "Step" is reserved for the implementer-internal logical-increment notion (below the Drive-care line) — an implementer composes steps inside a dispatch while executing.

**Why.** Dispatch captures aggregation: one dispatch may contain multiple logical steps but presents as one orchestrator-to-implementer interaction. The orchestrator's DoR / DoD / WIP-inspection rituals fire per dispatch, not per step. Naming the operational unit aligns the model with the rituals.

**Affected.** Every doc in this project uses "dispatch" for the agent-delegation unit; "step" appears only in implementer-internal context (and in the Execution bounded context in `model.md`).

## 12. Direct change is a sibling unit to Slice (lightweight path)

**Date.** 2026-05-18.

**Context.** Even a slice carries some ceremony — a spec (even inline), a plan (even collapsed), a dispatch loop. For trivial work (copy changes, config flips, one-line bugfixes), the slice ceremony is overkill. The user surfaced this gap explicitly: "our triage and execution workflow needs to handle the case where even a Slice is too much overhead: just get the work done, open a PR."

**Options considered.**
- (a) Treat trivial work as a "slice with no ceremony" — still goes through `drive-build-workflow` but with relaxed defaults.
- (b) Bypass Drive entirely for trivial work — operator runs `gh pr create` directly without ever invoking a Drive skill.
- (c) Add a fourth unit (direct change) as a sibling of slice. Triage decides; the unit has no spec / no plan / no dispatch ceremony; intent lives in the PR body.

**Choice.** (c). Direct change is a sibling of Slice (not below it). Both can compose under a project; both can stand alone (orphan).

**Why.** Triage needs a name for the verdict — option (b) leaves a hole in the decision tree. Modelling the unit explicitly lets the model + the rituals adapt to it (e.g. "design discussion is unlikely to fire on a direct change"; "WIP inspection is not applicable to a direct change"). The naming captures the spectrum: project (most ceremony) → slice (medium) → direct change (least). Triage's decision tree gains a fourth verdict.

**Affected.** `model.md` adds Direct change to ubiquitous language + persistence shape + Linear-sync + aggregates. Invariant I1 changes to "slice OR direct change → one PR." Triage gains a fourth verdict. No Drive skill executes a direct change — triage routes to `gh pr create` directly.

## 13. Design discussion is a cross-cutting workflow; `drive-discussion` is promoted to first-class

**Date.** 2026-05-18.

**Context.** The user surfaced that the predecessor workflow map missed the most valuable human-agent collaboration: the design discussion. `/drive-discussion` fires before / during spec writing, mid-flight when an assumption is falsified, mid-flight when an obstacle emerges, and on explicit request. Without naming it as a workflow, the model couldn't explain when it should fire or who's responsible for recognising the trigger.

**Options considered.**
- (a) Leave `drive-discussion` as a generic mode skill, mentioned only in passing.
- (b) Promote `drive-discussion` to first-class but treat it as a lifecycle stage (e.g. between Triage and Project initiation).
- (c) Promote `drive-discussion` to first-class as a *cross-cutting* workflow with multiple defined trigger points across the lifecycle.

**Choice.** (c). Design discussion is the cross-cutting workflow (eighth in the model's workflows list); the agile orchestrator persona's responsibility includes recognising when to escalate.

**Why.** Design discussion isn't a stage — it fires multiple times across a project's lifetime, on different triggers, with different outcomes. Modelling it as cross-cutting matches the lived experience. Pairing it with invariant I12 (no silent agent-side amendments) gives the protocol structural protection against assumption-falsification being silently accommodated.

**Affected.** `model.md` adds Design discussion to workflows + clarifies the orchestrator's escalation responsibility + adds I12. `workflow.md` adds the row + cadence. Several principle docs (DoR / DoD / brief discipline / retro) will reference design discussion as the resolution mechanism for surfaced questions.

## 14. Triage is the universal entry point AND mid-flight scope re-evaluator (covers promotion + demotion symmetrically)

**Date.** 2026-05-18.

**Context.** The sibling's model originally had triage as an entry-point workflow only. The user surfaced two related cases triage also needs to handle mid-flight: a slice growing beyond one PR (promote to project) and a project shrinking to fit one PR (demote to slice / direct change). Both are scope-shift events; both need the same decision discipline.

**Choice.** Triage is one workflow with two modes (entry-time and mid-flight). Mid-flight triage's output set includes two scope-shift verdicts: Promote and Demote. The decision tree and the persona (agile orchestrator) are the same in both modes.

**Why.** Promoting and demoting are scope-shift decisions, which is exactly what triage does. Modelling them as separate workflows would duplicate triage's decision tree; modelling them as triage outputs keeps the surface uniform.

**Affected.** `model.md` adds the mid-flight variant + the promotion / demotion verdicts. `workflow.md` adds Promotion + Demotion rows with their Linear ceremony. The triage skill (`drive-triage-work`) runs in both modes.

## 15. Linear Pattern 2 for promotion (ticket-becomes-project) with the user's variant

**Date.** 2026-05-18.

**Context.** When triage promotes a ticket to a project, the original Linear ticket needs disposition. Three patterns considered: (1) keep the ticket as the project's "top story"; (2) close the ticket and have the Linear Project take over; (3) hybrid — move the ticket into the new Linear Project but keep it as a Done marker.

**Choice.** Variant of Pattern 2 (the user's call). The original ticket is moved into the new Linear Project, marked Done, and either renamed to "Plan: \<project name\>" or annotated with a comment indicating it was promoted (with a URL to the project). The Linear Project becomes the durable handle going forward; slices subsequently track as new Linear issues under the project.

**Why.** Preserves the original ticket as the historical marker of "the original ask" while making the project the durable handle. The Done state cleans up the operator's "in flight" view; the marker means promotion is discoverable from the original ticket URL.

**Affected.** `model.md` § "Linear sync" specifies the promotion ceremony. `drive-triage-work` orchestrates the Linear MCP calls.

## 16. Demotion workflow (project → slice / direct change) is symmetric to promotion

**Date.** 2026-05-18.

**Context.** The user surfaced the symmetric case: if a project's remaining scope shrinks to fit one PR (or even one direct change), we need to demote rather than continue with project ceremony. This case is heavier than promotion (more Linear state to clean up).

**Choice.** Demotion routes through its own workflow but produces a symmetric result: surviving Linear issue stands alone (moved out of the project); other Linear issues under the project are closed with a "merged into <surviving-ticket>" comment; the Linear Project itself is Cancelled (with rationale) or Completed (if part of the original scope did ship); on-disk artefacts are migrated or retired; `projects/<project>/` is deleted; surviving work continues as orphan slice or direct change.

**Why.** Symmetric to promotion. Required because the alternative — continuing with project ceremony for one PR of remaining scope — is exactly the project-shape gravity failure mode the model is trying to fix.

**Affected.** `model.md` § "Linear sync" specifies the demotion ceremony. `drive-triage-work` orchestrates the Linear cleanup. Operator authorisation is required before mass-closing Linear issues (per open question 9 in `spec.md`).

## 17. Split `drive-create-spec` and `drive-create-plan` into four scope-specific skills (not a scope flag)

**Date.** 2026-05-18.

**Context.** The sibling's working position was a scope flag (fewer skills to maintain). After mapping the workflows and seeing how distinct the project-scope and slice-scope flows are, the user pushed for splitting.

**Options considered.**
- (a) Scope flag (sibling's working position).
- (b) Split into project-scope and slice-scope variants (`drive-project-specify`, `drive-slice-specify`, `drive-project-plan`, `drive-slice-plan`).

**Choice.** (b). Four skills total.

**Why.** Project-specify and slice-specify have meaningfully different inputs, outputs, audiences, and templates: project-specify produces purpose + scope-boundary + project-DoD with operator collaboration (often via design discussion); slice-specify produces scope-within-project + slice-DoD + Example-Mapping edge cases, usually authored by the implementer. Project-plan composes slices and direct changes (sequencing, stack/parallel); slice-plan composes dispatches with sizing discipline + DoR-per-dispatch. A scope flag papers over genuinely different shapes; splitting keeps each skill's body tight and its template focused.

**Affected.** Skill restructuring plan adopts the split. `workflow.md`'s lifecycle table names the four new skills. Canonical-side, `drive-create-spec` and `drive-create-plan` are deprecated in favour of the splits.

## 18. Two-cap sizing discipline (PR-cap at slice; M-cap at dispatch)

**Date.** 2026-05-18.

**Context.** The methodology project's M-cap rule needed a scope. Reading carefully: the "nothing above M dispatched" rule applies at the dispatch scope (the unit Drive delegates to agents). At the slice scope, the cap is different — a slice must fit in one PR (the PR's natural size cap, which is reviewability- and rollback-bounded, not complexity-bounded). The two caps act independently.

**Choice.** Codified as invariant I11 in `model.md`. Two caps:
- **Slice / direct-change cap.** Bounded by PR-cap (the unit must fit in one PR). Triage enforces — refuses to admit a slice that won't fit.
- **Dispatch cap.** Bounded by M-cap (complexity ≤ M; wall-clock time-box per t-shirt size). Slice planning enforces — refuses to declare a dispatch above M. Slice execution refuses L/XL in defense in depth.

**Why.** The caps capture different concerns: PR-cap is about review / debug / deploy / rollback debugability; M-cap is about agent-session inspectability and orchestrator recoverability. Both are real, both need enforcement, neither subsumes the other.

**Affected.** `model.md` adds I11. `drive-triage-work` enforces PR-cap at admission. `drive-slice-plan` enforces M-cap at planning. `drive-build-workflow` enforces M-cap defensively at dispatch time.

## 19. No silent agent-side amendments after first dispatch (I12)

**Date.** 2026-05-18.

**Context.** When an assumption baked into a spec or plan turns out to be wrong mid-flight, the structurally hazardous response is for the agent to silently accommodate (amend the spec / plan, continue executing, no escalation). This is the dispatch-drift failure mode generalised to the planning layer: the artefact contract gets broken without the operator noticing.

**Choice.** Codified as invariant I12 in `model.md`. Every spec / plan amendment after the first dispatch of a slice starts is either (a) the output of a design discussion with operator participation, or (b) an explicit operator-authorised edit. Silent agent-side amendments are forbidden.

**Why.** The artefact contract is the team's protocol-as-memory; silent amendments break the contract. Forcing escalation surfaces the design call to the operator, where the design discussion ritual resolves it. In unattended mode, this is enforced by a stop-condition in `drive-build-workflow` (orchestrator halts, logs the trigger for the operator's return).

**Affected.** `model.md` adds I12. `drive-build-workflow` augmentation includes a design-discussion stop-condition on assumption-falsification. `drive-discussion` is the resolution mechanism.

## 20. Project consolidation: agile-agent-orchestration + drive-domain-model → drive-domain-model

**Date.** 2026-05-18.

**Context.** Two projects ran in parallel on different branches: the methodology project (this one originally) and the sibling units project (`drive-domain-model`). On reading each other, they were addressing one cluster of failure modes (fuzzy units + unbounded dispatches) and fit one operational shape. Continuing in parallel risked divergent vocabulary and inconsistent rituals.

**Choice.** Merge both projects into one, hosted on this branch (`tml-2549-agile-agent-orchestration`), under the folder name `projects/drive-domain-model/` (the units name carries the substrate; the methodology name describes the discipline but the substrate is the more durable framing). Abandon the sibling's branch. Promote the sibling's `model.md` and `spec.md` to be the consolidated project's substrate; absorb the methodology's spec into a unified `spec.md`; delete the predecessor HANDOVERs (this consolidation supersedes them).

**Why.** One vocabulary + one ritual set + one set of ACs is cheaper to maintain and cleaner to ship. The two halves are naturally complementary: the units pin where the rituals fire; the rituals operationalise where the units transition.

**Affected.** Folder structure, file names, on-disk artefacts. The sibling project's reference branch is abandoned (no PR opened from it).

## 21. PR #93 (drive-context-convention + QA pair + meta-skills) is the assumed-landed base for all canonical-side work

**Date.** 2026-05-18.

**Context.** [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93) introduces machinery this project's skill restructuring depends on: the project-context convention (`drive/<category>/README.md` read by drive-* skills as workflow step 1), the manual-QA pair (`drive-qa-plan` + `drive-qa-run`), and three meta-skills (`drive-bootstrap-context`, `drive-reconcile-skills`, `drive-update-skills`). PR #93 ships independently and will land before any of this project's per-skill PRs.

**Options considered.**
- (a) Treat PR #93 as orthogonal — restructure plan ignores it; consumer migration handles the integration later.
- (b) Treat PR #93 as the assumed-landed base — every restructure PR stacks on top of it; DoR / DoD / model / workflow docs reference its surface as already-existing.

**Choice.** (b). PR #93 is the base.

**Why.** The QA pair is non-optional for slice + project DoD (it's the only canonical answer to "what does manual QA look like for a slice?"), and the project-context convention is the only canonical answer to "where do project-specific QA / spec / plan facts live?". Without PR #93, the restructure ships into a vacuum and consumers have to reinvent both. Treating PR #93 as the base also lets the restructure PRs reuse `drive-reconcile-skills` for consumer adoption — already part of the PR #93 surface.

**Affected.** `spec.md` references PR #93 throughout. `skill-restructure.md` § "Base assumption" makes the dependency explicit. `principles/definition-of-done.md` references `drive-qa-plan` / `drive-qa-run` / `drive/qa/README.md` as canonical. `model.md` and `workflow.md` reference the project-context convention where appropriate.

## 22. Manual QA is a slice-DoD and project-DoD gate, distinct from CI gates and intent-validation

**Date.** 2026-05-18.

**Context.** The DoD principle initially treated "validation gates" as a single category (CI + intent-validation lumped together). The user surfaced that DoD was missing manual QA, with PR #93's `drive-qa-plan` + `drive-qa-run` as the canonical manual-QA discipline. The three categories (CI, intent-validation, manual QA) cover three distinct gap classes and should be treated independently in DoD.

**Options considered.**
- (a) Keep the "validation gates" category lumped; treat manual QA as a calibration-overlay item.
- (b) Split into three categories (CI / intent / manual QA); make all three non-optional where applicable, with explicit N/A for slices that don't touch user-observable surface.

**Choice.** (b). Three distinct categories in DoD, each non-optional where applicable. Slice DoD requires a manual-QA script + ≥ 1 run report whenever the slice touches user-observable surface; pure-refactor slices are explicitly marked "Manual QA: N/A — no user-observable change" with a rationale.

**Why.** Each category catches a different failure class. CI catches mechanical contract violations; intent-validation catches "the implementer routed around the gate"; manual QA catches diagnostic clarity, end-to-end developer-journey breaks, original-bug regressions, gate-of-gate sanity, and exploratory unknowns. Lumping any two together makes the gap class invisible. The explicit-N/A discipline forces the slice author to confront the question rather than skip it silently.

**Affected.** `principles/definition-of-done.md` § "CI gates, intent-validation, and manual QA are three different things" introduces the categories; § Slice DoD adds the manual-QA gate item; § Project DoD adds the manual-QA coverage check across slices; templates updated; anti-pattern #2 broadened from "validation-gates only" to "CI-gates only"; calibration overlay example for `prisma-next` adds QA references.

## 23. Canonical drive-* bodies and `drive/<category>/README.md` are the two homes for memory; map every project-context overlay to its category README

**Date.** 2026-05-18.

**Context.** PR #93's project-context convention introduces a structural separation between portable methodology (canonical drive-* skill bodies in `prisma/ignite`) and team-specific protocol (`drive/<category>/README.md` in each consumer repo, read by drive-* skills as workflow step 1). The principle docs talked about the "general protocol vs project calibration" split in the abstract (D10) but didn't reflect that the project-calibration layer now has a concrete on-disk home with strong memory properties: loaded by the skill that needs it, every time, in time to apply the lesson. The `drive-reconcile-skills` + `drive-update-skills` pair makes the loop between the two homes operational rather than aspirational.

**Options considered.**
- (a) Keep talking about "calibration" generically; let teams figure out where to put each overlay item.
- (b) Make the canonical-vs-project-context separation the structural commitment, name `drive/<category>/README.md` as the canonical home for each kind of overlay (per the PR #93 eight-category table extended with the three new categories this restructure adds: `triage`, `retro`, `health`), and treat the reconciliation skills as part of the protocol-as-memory loop.

**Choice.** (b). The separation is explicit and load-bearing across the principle docs, the workflow, the calibration worked-example, and the skill restructure plan.

**Why.** Generic "calibration" guidance is undisciplined — teams add items where it's convenient (often inside in-repo skill copies, which then drift from canonical). Naming the per-overlay home turns "where does this go?" into a lookup rather than a judgement call. The PR #93 convention guarantees the file is loaded by the matching skill; the reconciliation skills guarantee drift gets routed back rather than rotting. Together they make protocol-as-memory operational.

**Affected.** `principles/protocol-as-memory.md` rewritten around two homes + a reconciliation loop, with `drive/<category>/README.md` added as a strong memory surface in the tier table. `principles/retro.md` mandatory-output section restructured into canonical update / project-context update / ADR (with explicit home selection heuristic) and the worked example lands in `drive/plan/README.md`. `principles/definition-of-ready.md` and `principles/definition-of-done.md` § "How calibration overlays the protocol" name the per-overlay destination. `principles/brief-discipline.md` names `drive/plan/README.md` as the canonical home for failure-mode catalogue + grep library + reference tasks + model-tier routing. `calibration/prisma-next.md` opens with a section-by-section mapping table to the destination READMEs. Skill-restructure already reflected this (D21); this decision codifies the principle-level commitment.

## 24. Skills split into two tiers: workflow (pilots multi-step loops) and atomic (does one bounded thing)

**Date.** 2026-05-18.

**Context.** The restructure proposed several new "orchestrating" skills (`drive-orchestrate-plan`-style) alongside many "do one thing" skills. The boundary was implicit; consumers reading the inventory had no signal for which skill expects to be invoked top-down versus called as a step inside something else. The implicit structure also conflicted with the gradual-AI-adoption principle (D26), which needs both tiers to be first-class: a human at the "zero AI" end invokes atomic skills directly as building blocks; moving toward full delegation hands more of the loop to workflow skills.

**Options considered.**
- (a) Keep the inventory flat; rely on skill names + descriptions to signal intent.
- (b) Make the two-tier distinction explicit via a naming convention: workflow skills end in `-workflow` (`drive-<verb>-workflow`); atomic skills use the standard shapes (`drive-<verb>-<noun>`, `drive-<sub-namespace>-<verb>`).
- (c) Drop the workflow tier entirely; have the operator (or an outer agent loop) compose atomic skills by hand each time.

**Choice.** (b). Workflow skills end in `-workflow`. Three of them: `drive-start-workflow` (triage + verdict setup), `drive-build-workflow` (slice implementation loop), `drive-deliver-workflow` (project lifecycle). Everything else is atomic.

**Why.** The naming convention surfaces the distinction at a glance. Both tiers are first-class — workflow skills aren't internal plumbing; they're a directly invokable entry point for operators who want the loop driven for them. Atomic skills aren't second-class building blocks; they're a directly invokable entry point for operators who want to drive each step themselves. (c) was rejected because it forces every operator to re-derive the loop each time, which defeats the protocol-as-memory principle.

**Affected.** `model.md` § "Two skill tiers" introduced; the workflow-skill table replaces the implicit orchestration discussion. `skill-restructure.md` § 1 restructured around the workflow / atomic split. `workflow.md` § "Two skill tiers" added. `spec.md` At-a-glance + deliverables tables updated.

## 25. Rename `drive-orchestrate-plan` to `drive-build-workflow`

**Date.** 2026-05-18.

**Context.** `drive-orchestrate-plan` named what the skill *did* in an early model where "plan" was the central artefact. Under the consolidated model, the skill pilots the slice implementation loop — it doesn't "orchestrate a plan," it builds the slice. The old name was also incompatible with the new workflow-tier naming convention (D24).

**Options considered.**
- (a) Keep the name; document the new behaviour under it.
- (b) Rename to `drive-build-workflow`, fitting the new convention.
- (c) Use a different verb (`drive-execute-workflow`, `drive-run-workflow`).

**Choice.** (b). `drive-build-workflow`.

**Why.** "Build" matches the agile lineage (the slice implementation loop is the place where building happens) and the consumer mental model. "Execute" was second-best but already overloaded by Drive's "Slice execution" workflow naming. "Orchestrate" was rejected as too long and as conflating the skill (which pilots a loop) with the role wearing the agile-orchestrator hat.

**Affected.** Mechanical rename across all project docs. Skills under `prisma/ignite` will adopt the new name during Phase 3 promotion (per `plan.md`); consumers using `drive-orchestrate-plan` migrate via `drive-reconcile-skills`.

## 26. Gradual AI adoption as a first-class principle of the methodology

**Date.** 2026-05-18.

**Context.** The methodology has always anticipated a trajectory from human-driven Drive to agent-driven Drive (D6 — "agent teams ARE teams"). What wasn't explicit: the trajectory is gradual and walkable, and the protocol must support participation at every point on the spectrum — not just the endpoints. Without this, the workflow-tier split (D24) could read as "the workflow skills exist to replace humans" rather than "the workflow skills exist so humans can incrementally delegate."

**Options considered.**
- (a) Leave the trajectory implicit; let it be inferred from D6 + role docs.
- (b) Name "gradual AI adoption" as a first-class principle; a new principle document; references in `spec.md`, `roles-and-personas.md`, `protocol-as-memory.md`.

**Choice.** (b). New principle document `principles/gradual-ai-adoption.md`. Cross-references from the spec design tenets, the roles-and-personas trajectory, and the protocol-as-memory surfaces.

**Why.** The implicit trajectory has produced a real friction: team members at the "zero AI" end are unsure how to participate; team members at the "full delegation" end skip rituals that the rituals existed to make hard to skip. Naming the principle makes the surfaces (atomic skills, workflow skills, project-context READMEs, skill bodies) targets that *deliberately* serve both human and agent participation, not just one or the other.

**Affected.** `principles/gradual-ai-adoption.md` (new). `spec.md` At-a-glance names it as a design tenet. `principles/roles-and-personas.md` walkable-transitions section added. `principles/protocol-as-memory.md` notes that memory surfaces serve both agents and humans. `model.md` role-wearing trajectory cross-links the principle.

## 27. Build the Drive skill family locally in `prisma-next` and trial before opening upstream PRs

**Date.** 2026-05-18.

**Context.** Earlier sequencing (in the original `plan.md`) opened upstream PRs incrementally as each skill was drafted. The risk: design problems crystallize into canonical bodies that downstream consumers then have to migrate around, and reviewers can't trial the family as a whole because no piece is downstream-ready until the whole series lands.

**Options considered.**
- (a) Continue with incremental upstream PRs as designed.
- (b) Build the whole family locally in `prisma-next` (`.agents/skills/drive-*/`), trial for ~2 weeks of real use, then open the upstream PR series with the trialed shape.

**Choice.** (b). Build locally first, trial, then promote.

**Why.** The trial period is the cheapest way to catch design problems before they hit canonical bodies. The family is mutually-dependent (the workflow skills call the atomic skills; the augmented `drive-build-workflow` depends on the new `drive-retro-run`); trialling pieces in isolation upstream would be partial validation at best. Promoting only what survived the trial keeps canonical churn down. (a) was rejected because the cost of crystallizing a wrong-shape skill in canonical is high (consumer migration) and the cost of trialling locally is low (one repo, one team, no consumer impact).

**Affected.** `plan.md` rewritten into three phases (shape / build + trial / promote). `spec.md` deliverables tables split into "locally-built skill family" and "upstream-promotion deliverables." `skill-restructure.md` § 4 reframed as build-locally sequencing with Phase 3 as upstream promotion. `problem-statement.md` "What we'd like from you" section notes that upstream PRs come after the trial.

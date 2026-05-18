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

## 5. 5-minute standup-style check during every dispatch

**Date.** 2026-05-17.

**Context.** The drift failure we hit was invisible from file-system proxies (commit cadence, file modification rate). It became visible only when someone read the diff. The fix is to make diff inspection happen periodically, not just at dispatch end.

**Options considered.**
- (a) Per-commit inspection (orchestrator reads every commit as it lands). Best drift detection but requires synchronous orchestrator availability.
- (b) Fixed-cadence inspection (e.g. every 5 min). Balances drift detection with orchestrator's ability to multitask.
- (c) Event-triggered inspection (e.g. orchestrator inspects when N commits queued or when implementer reports a milestone). Misses long quiet drift periods.

**Choice.** (b). 5-minute cadence, standup-style three questions: what's been completed, what's in flight, anything blocking + the burn-down question (can the remainder fit in remaining time-box).

**Why.** Maps cleanly to the standup pattern from Scrum, which exists for the same reason: detect drift / blockage early without high-overhead synchronous monitoring. The 5-minute cadence is short enough to catch drift before it compounds (in our failure, the deviation appeared 4 minutes after the prior clean commit — a 5-minute cadence would have caught it within the first inspection after).

**Affected.** Every dispatch is monitored at ≤5-minute cadence. The check involves reading actual diffs of spec-critical files, not stat summaries.

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

## 9. Spike pattern for planning-time unknowns

**Date.** 2026-05-17.

**Context.** Sometimes the orchestrator hits a planning question with legitimate unknowns ("how many test sites do we actually need to migrate?", "what's the right shape of this abstraction?"). Guessing leads to bad estimates and bad briefs.

**Choice.** Adopt the Agile spike pattern. A spike is a time-boxed investigation whose Definition of Done is "you have an actionable understanding of what to do," not working code. Spikes have their own DoR (the question is well-formed) and DoD (an output artefact answers the question).

**Why.** Standard Agile pattern, same role for us. Investigation before commitment.

**Affected.** Briefs that depend on spike outputs are queued behind the spike, not dispatched in parallel.

## 10. General protocol vs project-specific calibration — two-layer split

**Date.** 2026-05-17.

**Context.** Different projects have different test suites, grep libraries, failure-mode catalogues, reference tasks. The protocol must work across projects without baking in any one project's specifics.

**Choice.** Two layers, with clear boundaries:
- **General protocol** (this project): estimation methodology, time-boxing thresholds, DoR / DoD gate patterns, standup structure, spike pattern, brief discipline principles, three-dimension complexity decomposition.
- **Project calibration** (each adopting project's docs): reference tasks for t-shirt anchors, DoD verification commands (which test/lint/grep invocations), failure-mode catalogue, grep library (project-specific anti-pattern patterns).

Both layers are living documents. Each failure mode prompts a check: "does this update the protocol (general) or the calibration (project)?"

**Why.** Avoids the "the protocol works everywhere except where it doesn't" failure mode. Forces explicit thinking about which lessons generalise and which are project-specific.

**Affected.** This project hosts the general protocol; each adopting project hosts its own calibration in its own `docs/`.

# Spec — Agile Agent Orchestration

## Problem

Agent-driven software development tasks have a recurring failure mode: an orchestrator dispatches a feature-sized scope to an implementer agent, the implementer runs for hours producing many commits without orchestrator inspection, and the resulting work drifts from the brief in ways that pass validation gates (typecheck, tests) while violating the spec's discipline. The drift compounds: each subsequent commit lands on top of the wrong substrate.

The proximate failure is the implementer's. The structural failure is the orchestrator's: no verification cadence, no scope cap, no inspection ritual.

We have observed this failure mode multiple times during the `target-extensible-ir` project (most recently 2026-05-17, captured in `wip/unattended-decisions.md` and the prisma-next project's review artefacts). Each instance has the same shape:

- Dispatch is feature-sized (multiple commits, many files, multiple disciplines)
- Orchestrator monitors via file-system proxies (commit cadence, file modification rate) rather than reading committed diffs
- Validation gates pass throughout
- Drift is invisible until the orchestrator (or user) reads a specific diff for an unrelated reason
- Recovery requires unwinding multiple commits' worth of accommodating code

This is structurally identical to the failure mode that drove human Agile teams to adopt small stories + frequent standups + Definition of Ready / Done. The same fix applies.

## Goals

1. **Define a general orchestration protocol** that can be applied across projects. The protocol covers:
   - Relative complexity estimation (not time-based)
   - Wall-clock time-boxing (separate from estimation)
   - Definition of Ready (pre-dispatch checklist)
   - Definition of Done (post-dispatch verification gate)
   - Per-dispatch orchestrator inspection cadence (5-minute standup-style check)
   - Spike pattern for legitimate unknowns
   - Brief discipline (pre-naming edge cases with dispositions)

2. **Distinguish general protocol from project-specific calibration.** The protocol is the same across projects; the calibration (reference tasks for t-shirt sizing, DoD verification gates, failure-mode catalogue, grep library) varies per project and lives in the project's own docs.

3. **Make the protocol the team's memory.** Agent teams have no organic memory transmission. Every failure mode that recurs needs to be captured in written rituals (DoR / DoD / brief discipline / standup questions) so the next dispatch inherits the lesson without depending on agent continuity.

## Non-goals

- We do not aim to estimate in time. Time estimates are unstable across agents, environments, and conditions. Time is used only for time-boxing (an upper bound on a dispatch's allowed runtime), not for sizing.
- We do not aim to eliminate orchestrator judgment. The protocol provides structural protection; the orchestrator still makes interpretation calls within the structure.
- We do not aim to automate the protocol fully. The 5-minute check is a human-or-orchestrator-agent ritual, not an automated CI gate. (Automation of specific checks — grep gates, fixture validation — is welcome but separate.)

## High-level approach

### Two-layer architecture

- **General protocol** (this project): estimation methodology, time-boxing rules, DoR / DoD gate patterns, standup-check structure, spike pattern, brief discipline principles.
- **Project calibration** (each adopting project's own docs): reference tasks for t-shirt sizing, DoD verification commands (project-specific test/lint/grep gates), failure-mode catalogue (anti-patterns we've hit), grep library (patterns that catch known failure modes).

Both layers are living documents. Each failure mode we encounter prompts a check: "does this require an update to the protocol (general lesson) or the calibration (project-specific lesson)?"

### Sizing — three orthogonal dimensions

Complexity decomposes into three dimensions, each scored independently:

- **Conceptual difficulty** — how much spec judgment / design interpretation the implementer must apply. High = "rebalance a substrate invariant." Low = "delete an unused export."
- **Surface volume** — how many files / call sites / consumers the change touches. High = "rewrite test literals across every package." Low = "change one type signature."
- **Blast radius** — how badly things degrade if the implementer gets it wrong. High = "change the substrate every consumer depends on." Low = "add a new test."

A task scoring high on any one dimension needs a different treatment. The t-shirt size is a composite of all three, calibrated against project-specific reference tasks.

### Hard rules

- **Nothing above M gets dispatched.** L and XL must be decomposed at planning time. This is the structural protection against feature-sized dispatches.
- **Per-dispatch wall-clock time box.** M ≤ 30 min, S ≤ 15 min, XS ≤ 5 min. Overruns trigger re-scope, not extension.
- **5-minute orchestrator standup-style check.** During every dispatch. The check answers: what's been completed, what's in flight, anything blocking, can the remainder fit in the remaining time-box. The check involves reading actual diffs of spec-critical files, not just the stat summary.
- **DoR before dispatch, DoD after.** No exceptions.

### Cost discipline as a derived benefit

Well-decomposed M-sized tasks with clear DoD are safe to dispatch to cheaper / faster models. The protocol therefore doubles as cost optimization: Opus-tier work is reserved for orchestration, design judgment, and high-risk dispatches; cheaper models handle decomposed mechanical execution. This is the agent-team analogue of pulling small stories so junior developers can pick them up confidently.

## Integration with existing skills

This methodology fills a specific gap in the existing `drive-*` skill suite:

- **`drive-create-plan`** (planning skill) generates the project plan. Under this methodology, planning must produce **M-sized tasks** with per-task validation gates and edge-case dispositions. Tasks sized L/XL are not pickable — the plan must decompose them at planning time. Definition of Ready and brief discipline are the planning-side artefacts of this methodology.
- **`drive-orchestrate-plan`** (execution skill) runs the implement-review loop. It already covers the **execution contract** — persistent subagents, heartbeats, validation gates, findings as work-not-noise, multitasking, replan, unattended mode, learnings. Today's failure demonstrates that it does **not** cover the **sizing discipline**: there is no L/XL refusal rule, no hard 5-minute orchestrator-side inspection cadence, no t-shirt estimation, no explicit "read the commit diff" discipline. This methodology supplies those missing rules.

The relationship is **complementary, not redundant**: `drive-orchestrate-plan` answers "how does the loop run?"; this methodology answers "what may be dispatched, how is it sized, and how does the orchestrator inspect it?" Both skills will eventually link to this methodology (likely renaming to `drive/agile-*` once stabilised), and this methodology will eventually consume the execution-contract surface area `drive-orchestrate-plan` defines (so they reference each other rather than re-describing each other's domain).

Mapping of methodology gates to `drive-orchestrate-plan` loop steps:

| Methodology gate | `drive-orchestrate-plan` step | Notes |
|---|---|---|
| Definition of Ready (size, brief, edge cases pre-named) | Step 1 "Pre-flight" | DoR augments the existing "confirm code-review.md exists, scaffold validation gate" pre-flight |
| Size estimation (t-shirt + three-dimension decomposition) | Authored at `drive-create-plan` time; verified at pre-flight | Plan tasks must carry a size; loop refuses to dispatch L/XL |
| 5-minute orchestrator standup-style check | Augments heartbeat reading (heartbeats are subagent-side liveness; standup-style check is orchestrator-side intent inspection) | Different signals; both apply |
| Per-commit diff inspection | New discipline — added during the loop, not at step boundaries | Today's failure makes this load-bearing |
| Definition of Done (gates + brief-specified verifications) | Step 6 "Receive reviewer verdict" + step 7 "Validate against intent" | DoD formalises what the reviewer must verify; intent-validation already exists |
| Spike pattern | Either `drive-create-plan` time (decomposition spike) or as a one-shot dispatch type within `drive-orchestrate-plan` | Spike output artefacts live in the project tree |

## Out of scope (for now)

- The mechanics of how the orchestrator and implementer communicate (resume vs fresh dispatch, transcript inspection, heartbeats, multitasking semantics, unattended decision logging) — already codified in `drive-orchestrate-plan` and inherited by this methodology.
- Tooling support (e.g. a CLI that automates the 5-minute check) — possible but secondary to the protocol itself.
- How the protocol interacts with multi-agent parallel execution — to be addressed when we use it in anger.

## Settled questions

- **Right home for the protocol when stabilised.** `drive/agile-*` skill namespace, alongside the other `drive-*` skills. The exact split between rules / skills / project docs is open (see below), but the home is set.
- **How frequently do reference tasks need recalibration.** Trigger-based, not periodic: any time there's a significant post-mortem (e.g. today's reversal), the team reviews whether the reference tasks still represent appropriate t-shirt anchors. Drift is not assumed; it's diagnosed.
- **Team-specific additions to rituals belong in project-specific artefacts.** The methodology skills are centralized and shared across repos; they cannot carry team-specific ritual additions (e.g. "every DoR must check for a Linear ticket," "every DoD must include a screenshot if UI changes"). Those additions live in each adopting team's project-level calibration docs. See [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md) § "Team-specific ritual additions live in project artefacts."

## Open questions

- How do we handle the case where the orchestrator itself is an agent and is subject to the same failure modes (e.g. forgetting to do the 5-minute check)? Likely answer: the protocol becomes machine-readable and lives in a place the orchestrator agent reads on every dispatch — probably a `drive/agile` skill the orchestrator loads automatically. To be developed when we promote this project's content into the skill namespace.
- How do we represent the methodology in the rule / skill / docs split? Likely answer: the principles + rituals as a `drive/agile` skill the orchestrator loads; the always-applied invariants (no L/XL dispatch, 5-min check, DoR/DoD gates) potentially as a rule that fires when any `drive-*` skill is in play; calibration docs in each adopting repo's `docs/`. To be decided when the methodology stabilises enough to extract.

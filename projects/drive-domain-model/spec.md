# Spec — Drive domain model + Agile dispatch discipline

**Status:** Living. Consolidates two predecessor projects (`drive-domain-model` + `agile-agent-orchestration`).

## At a glance

We are pinning Drive's domain model and threading Agile-style dispatch discipline into the workflows where agent execution happens. Concretely, we are shipping:

1. **Three sized units of work** — Direct change (no ceremony), Slice (one PR with spec + plan), Project (composition of slices). Plus one delegation unit, Dispatch (one agent session).
2. **A triage workflow** that runs at every entry point and routes work to one of eight outcomes — including a lightweight path for trivial work and explicit promote/demote paths for mid-flight scope shifts.
3. **Dispatch-level discipline** — Definition of Ready and Definition of Done per dispatch, a ≤ 5-minute WIP-inspection cadence, an M-cap that refuses oversized dispatches, and a stop-condition when an assumption is falsified mid-flight.
4. **A skill restructure with two tiers** — *workflow skills* (`drive-<verb>-workflow`) that pilot multi-step loops, and *atomic skills* that do one bounded thing. Three workflow skills (`drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`), seven new atomic skills, four atomic augmentations, one promotion. The two-tier split supports gradual AI adoption: humans at the "zero AI" end invoke atomic skills as building blocks; moving toward "full delegation" hands more of the loop to workflow skills.
5. **A rewritten `drive-process.md`** that teaches the consolidated model, the two skill tiers, and dispatch discipline.

The skill family is built **locally in `prisma-next`** first (`.agents/skills/drive-*/SKILL.md`), validated by a couple of weeks of real use, and then promoted upstream to [`prisma/ignite`](https://github.com/prisma/ignite) as a series of small PRs stacked on [PR #93](https://github.com/prisma/ignite/pull/93). See [`plan.md`](plan.md) for the execution sequence.

The model lives in [`model.md`](model.md). The operational lifecycle lives in [`workflow.md`](workflow.md). The skill restructure lives in [`skill-restructure.md`](skill-restructure.md). The externally-shareable problem framing lives in [`problem-statement.md`](problem-statement.md). The gradual-AI-adoption principle lives in [`principles/gradual-ai-adoption.md`](principles/gradual-ai-adoption.md).

## Design tenets

Two tenets cut across the design. Everything else is downstream of these.

1. **Gradual AI adoption.** A team's use of Drive sits on a spectrum from "human reads, writes, decides everything; agents only execute narrow tasks" to "agent runs the whole loop; human only at the project-spec layer." Every team is at some point on this spectrum today; every team's point moves over time. The methodology supports participation at any point — both the atomic and workflow skill tiers are first-class, every protocol artefact is human-readable and human-runnable, and the project-context surfaces (`drive/<category>/README.md`) serve both humans and agents. See [`principles/gradual-ai-adoption.md`](principles/gradual-ai-adoption.md) for the principle and [`principles/roles-and-personas.md`](principles/roles-and-personas.md) § "Walkable transitions" for the concrete intermediate points an operator can occupy.

2. **Protocol as memory.** Agent teams have none of the human-team continuity mechanisms (people stick around, hallway conversations, apprenticeship, codebase familiarity). The protocol — the rituals, the skill bodies, the `drive/<category>/README.md` overlays — IS the team's memory. Anything that isn't written into a surface the next agent will read does not exist for the next agent. See [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md).

## The problem (compressed)

Two failure modes in today's canonical Drive compound:

1. **Fuzzy units.** "Project," "milestone," "task," "plan," and "spec" each get used at multiple scopes; skill bodies do not say which. The Linear-sync workflow operates on floating units, so what gets synced where is unanswerable except by reference to the original author's mental model. `prisma-next` rejected the canonical Linear-sync workflow for this reason and runs a parallel fork that does not flow back to ignite.
2. **Unbounded agent dispatches.** Inside a "task," agent dispatches routinely run feature-sized scopes for hours without orchestrator inspection. Drift passes validation gates while violating the spec; recovery requires unwinding multiple commits' worth of accommodating code. Observed multiple times in `prisma-next`'s `target-extensible-ir` project — most recently captured in `wip/unattended-decisions.md`.

The two compound: fuzzy units produce oversized work; oversized work yields unsupervised dispatches; unsupervised dispatches produce drift; drift is absorbed back into the spec silently because the spec was fuzzy to begin with.

The externally-shareable version of this framing — with evidence and the proposed direction in plain English — is at [`problem-statement.md`](problem-statement.md). Hand that doc to anyone outside the immediate working group.

## The design

Three layers, deliberately ordered smallest-scope-first.

### Layer 1: three sized units of work + one delegation unit

| Unit | What it is | Persistence |
|---|---|---|
| **Direct change** | One PR, no spec, no plan, no dispatch ceremony. The lightweight path for trivial work — copy changes, config flips, one-line bugfixes. | Intent in the PR body. No on-disk artefact. |
| **Slice** | One PR-sized unit with a slice spec + slice plan, delivers exactly one PR. The slice plan decomposes into dispatches. | In-project: `projects/<project>/slices/<slice>/`. Orphan: inline in the PR description. |
| **Project** | Composition of slices and/or direct changes under one overarching purpose. Has a project spec + project plan + project-DoD. | `projects/<project>/spec.md` + `plan.md`. |
| **Dispatch** | One delegation to an implementer subagent — one agent session. The slice plan is a sequence of dispatches. Each dispatch carries DoR + DoD + sizing cap (≤ M complexity). | Transient — assembled at dispatch time from the slice plan; not separately persisted. |

The previously-overloaded words **milestone, task, step** retire from Drive vocabulary. *Milestone* belongs to Linear; *task* is replaced by Slice or Dispatch depending on scope; *step* demotes to implementer-internal (below the Drive-care line).

### Layer 2: eight workflows (seven lifecycle, one cross-cutting)

Workflow names and ordering:

```
Triage  ──▶  Project initiation  ──▶  Slice initiation  ──▶  Slice execution
                                                                  │
                                                                  ▼
                                              Slice review  ──▶  Slice closure
                                                                  │
                                                                  ▼
                                                            Project closure

   ⬑ Design discussion (cross-cutting; fires on triggers across the lifecycle)
```

Two new workflows are load-bearing: **Triage** (the universal entry point, currently absent from canonical Drive) and **Design discussion** (promoted to first-class cross-cutting from a generic mode skill).

### Layer 3: twelve invariants that hold across all units and workflows

The structurally load-bearing ones:

- **I1** — A slice OR direct change delivers exactly one PR.
- **I2** — A project's scope is bounded by its project spec at all times.
- **I7** — A project's purpose statement is immutable after the first slice or direct change starts.
- **I8 / I9 / I10** — Every dispatch / slice / project has a Definition of Done.
- **I11** — **Two sizing caps, independent and complementary.** Slice/direct-change is bounded by PR-cap (review-ability, rollback-ability). Dispatch is bounded by M-cap (agent-session inspect-ability, orchestrator recover-ability). Triage enforces PR-cap; slice planning enforces M-cap; slice execution refuses L/XL in defense in depth.
- **I12** — **No silent agent-side amendments.** Spec or plan amendments after the first dispatch of a slice starts require either operator authorisation or a design-discussion output.

Full set + DDD aggregate boundaries in [`model.md`](model.md).

## Concrete workflows the design supports

Three narrative walkthroughs to ground the model. (The full lifecycle map with every skill and cadence is in [`workflow.md`](workflow.md).)

### Walkthrough 1: a developer picks up a one-line bug fix

A Linear ticket says "the typo in the `formatVersion` error message swallows the version string." The developer runs `drive-triage-work` with the ticket as input.

1. **Triage** answers question 1 of its decision tree affirmatively (trivial enough to skip slice ceremony — reviewer can verify by reading the diff in ~30 seconds). Verdict: **Direct change**.
2. The developer runs `git checkout -b tml-1234-format-version-typo`, edits the message, runs `gh pr create` with the original ticket linked in the PR body.
3. No spec, no plan, no `projects/<x>/` directory, no dispatch ceremony, no Drive skill orchestrating the change. The implementer reads the brief, makes the edit, opens the PR. Drive observes the outcome only via merge.

What this satisfies: **FR4** (lightweight invocation paths), **I1** (one PR), **I5** (orphan units allowed).

### Walkthrough 2: a developer picks up a multi-PR feature

A Linear ticket says "implement the new TypeScript backend's contract emitter." The developer runs `drive-triage-work`.

1. **Triage** walks its decision tree: not trivial; no existing open project covers this; sizable but estimable. Question 4: does it fit in one PR? No — surface area spans contract IR + emitter target + fixtures. Verdict: **New project**.
2. Triage runs the **promotion ceremony**: creates a Linear Project, moves the original ticket into it, marks the ticket Done, renames it `Plan: TypeScript backend emitter` (forward-pointer to the project), then routes to **Project initiation**.
3. **Project initiation** runs `drive-create-project` → scaffolds `projects/typescript-emitter/` → `drive-project-specify` → writes `spec.md` with purpose, scope boundary, project-DoD (often via **Design discussion** with the operator) → `drive-project-plan` → writes `plan.md` composing the project from known + anticipated slices (stack and parallelism declared).
4. The first slice runs **Slice initiation** → `drive-slice-specify` writes the slice spec under `projects/typescript-emitter/slices/<slice>/spec.md` → `drive-slice-plan` decomposes into a sequence of dispatches, each sized ≤ M, each with DoR + DoD declared.
5. **Slice execution** runs `drive-build-workflow`'s dispatch loop: pre-flight DoR → assemble brief → delegate one dispatch → WIP inspection (≤ 5 min) → post-flight DoD → reviewer subagent verdict → loop to next dispatch.
6. When a dispatch's brief assumes "the existing emitter's column-naming pass is per-target" and the implementer discovers it's per-codec, the orchestrator hits invariant I12: stop, escalate to **Design discussion** with the operator, output a spec/plan edit + a `design-decisions.md` entry, resume.
7. Slice execution → **Slice review** (`drive-review-code`, `drive-pr-walkthrough`, `drive-qa-plan`, `drive-qa-run`) → **Slice closure** (PR merged, deferred candidates recorded, health rollup) → next slice.
8. Last slice merges → **Project closure** runs `drive-close-project` → mandatory final retro via `drive-retro-run` → migrate long-lived docs → delete `projects/typescript-emitter/`.

What this satisfies: **FR1** (pinned model exercised end-to-end), **FR3** (triage routes to new project), **FR5** (dispatch discipline), **FR6** (design discussion fires mid-flight on falsified assumption), **FR7** (promotion ceremony), **I7** (purpose immutable), **I11** (two-cap sizing), **I12** (no silent amendments).

### Walkthrough 3: a project shrinks mid-flight

A six-slice project is two slices in. The remaining four planned slices turn out to be already-done (the underlying refactor obviated them). The orchestrator notices during a session-bookended `drive-health-check`.

1. The orchestrator surfaces a **mid-flight triage** as a structured decision to the operator: "remaining scope appears to fit one PR — propose Demote."
2. Operator authorises.
3. Triage runs the **demotion ceremony**: pick the surviving Linear issue, close the other open issues with "merged into <surviving>" comments, move the surviving ticket out of the Linear Project (`project = null`), mark the Linear Project Completed (the first two slices did ship), migrate useful on-disk content to the surviving PR description, delete `projects/<project>/`.
4. Surviving work continues as **orphan slice** (or direct change if smaller still).

What this satisfies: **FR7** (demotion), **I2** (scope bounded by spec — the symmetric case), the agile-orchestrator escalation discipline named in **FR3** (mid-flight triage).

## Project deliverables

What this project ships, framed as outputs of the design above. The skill family is built locally in `prisma-next` first; the upstream-promotion PRs land later (see [`plan.md`](plan.md)).

### Locally-built skill family (in `prisma-next` `.agents/skills/`)

**Workflow tier (three; all new or renamed):**

| Deliverable | What it is | Design it implements |
|---|---|---|
| `drive-start-workflow` | Pilots triage + the verdict's setup chain. Calls `drive-triage-work` then runs the verdict's setup. | Layer 2 — Triage; Walkthroughs 1, 2, 3; gradual-AI-adoption principle. |
| `drive-build-workflow` (renamed + augmented from `drive-orchestrate-plan`) | Pilots a slice's implementation loop: pre-flight DoR → dispatch loop with WIP inspection → post-flight DoD → review → close. | Layer 2 — Slice execution; Layer 3 — I8, I11, I12; Walkthrough 2. |
| `drive-deliver-workflow` | Pilots a project's lifecycle: init → slices → health → retros → mandatory close retro. | Layer 2 — Project initiation + closure; Layer 3 — I10. |

**Atomic tier — new (seven):**

| Deliverable | What it is | Design it implements |
|---|---|---|
| `drive-triage-work` | Runs the triage decision tree; outputs one of eight verdicts. Called by `drive-start-workflow`; also directly invokable. | Layer 2 — Triage. |
| `drive-project-specify` + `drive-slice-specify` | Split from `drive-create-spec`. Different inputs / outputs / templates per scope. | Layer 1 — Project vs Slice distinction; Walkthrough 2. |
| `drive-project-plan` + `drive-slice-plan` | Split from `drive-create-plan`. Project-plan composes slices; slice-plan composes dispatches with sizing + DoR. | Layer 1 — Project vs Slice distinction; Layer 3 — I11. |
| `drive-health-check` | Project rollup; session-bookended (interactive) or trigger-fired (unattended). Called by `drive-deliver-workflow`; directly invokable. | Layer 2 — cross-cutting; Walkthrough 3 (mid-flight detection). |
| `drive-retro-run` | Trigger-based retro template; lands the learning in canonical / project-context / ADR. Called by both workflow skills on triggers; directly invokable. | protocol-as-memory principle. |

**Atomic tier — augmentations (four):**

| Deliverable | What it is | Design it implements |
|---|---|---|
| `drive-close-project` (augmented) | Mandatory final retro hook (calls `drive-retro-run`); refusal to delete `projects/<x>/` while project DoD is unmet. | Layer 2 — Project closure; protocol-as-memory principle. |
| `drive-create-project` (augmented) | Project DoR check at entry; seeds `drive/<category>/README.md` entries via `drive-bootstrap-context`. | Layer 2 — Project initiation; project DoR. |
| `drive-discussion` (promoted) | From generic mode skill to first-class cross-cutting workflow trigger. Stays atomic. | Layer 2 — Design discussion; Layer 3 — I12. |
| `drive-pr-description` (augmented) | Extended for the direct-change case. | Layer 1 — Direct change. |

### Upstream-promotion deliverables (in `prisma/ignite`, stacked on PR #93)

After the local trial, each surviving skill is promoted upstream as its own PR. The per-PR sequence aligns with [`skill-restructure.md`](skill-restructure.md) § 4. Plus:

| Deliverable | What it is | Design it implements |
|---|---|---|
| `docs/engineering/drive-process.md` rewrite | Rewritten to teach the consolidated model, the two skill tiers, and dispatch discipline. Preserves PR #93 content (Skill Map, "Project context for drive skills") and layers the model on top. | All three layers + PR #93 base. |

### In-project deliverables (under `projects/drive-domain-model/`)

| Deliverable | Status | Purpose |
|---|---|---|
| [`model.md`](model.md) | Drafted | Pinned domain model — vocabulary, workflows, invariants, persistence, Linear sync. |
| [`workflow.md`](workflow.md) | Drafted | Operational lifecycle map (every skill plugs into a named phase). |
| [`problem-statement.md`](problem-statement.md) | Drafted | Self-contained problem framing for canonical-side maintainers (Ignite team). |
| [`skill-restructure.md`](skill-restructure.md) | Drafted | Workflow → skill map + per-skill verdict + implementation sequencing. |
| [`design-decisions.md`](design-decisions.md) | Living | Decisions with options + choice + rationale (the alternatives ledger). |
| [`principles/`](principles/) | Drafted | Per-principle deep-dives: protocol-as-memory, brief-discipline, DoR, DoD, retro, roles-and-personas, spikes, decomposition-and-cost, gradual-ai-adoption. |
| [`calibration/prisma-next.md`](calibration/prisma-next.md) | Drafted | Worked-example calibration; demonstrates how project-context overlays map to `drive/<category>/README.md` per PR #93. |
| [`plan.md`](plan.md) | Pending | Execution plan for landing the canonical-side deliverables. |

## What this is not

- **Consumer migration is not in scope.** Each consumer (including `prisma-next`) adopts the new canonical on its own schedule via `drive-reconcile-skills`. This project's deliverables are canonical-side only. `prisma-next`'s calibration contribution is the worked example, not a migration program.
- **Linear-sync mechanics beyond unit mapping are out of scope.** This project pins the units and the promotion / demotion patterns. The full MCP-tool-call shape for every transition may be a follow-up.
- **The WIP-inspection cadence is a human-or-orchestrator-agent ritual, not an automated CI gate.** Automation of specific checks (grep gates, fixture validation) is welcome but separate.
- **Multi-agent parallel execution semantics are out of scope.** Addressed when we use it in anger.
- **Eliminating orchestrator judgment is not the goal.** The protocol provides structural protection; the orchestrator still interprets within the structure.
- **The new model does not retrofit in-flight Drive projects in `prisma/ignite` itself.** Existing in-flight work ages out under the old model; new projects use the new model.
- **No rewrite of the drive-context-convention audit reports.** They stay as historical artefacts; only the synthesis is annotated to point at where its Tier 1 recommendations were superseded by this work.

## Acceptance criteria

Grouped by which design layer they verify.

### Model is pinned (Layer 1 + Layer 3)

- [x] **AC1.** [`model.md`](model.md) carries the consolidated vocabulary (Direct change / Slice / Project / Dispatch / Brief; Step retired to Execution context; Design discussion as cross-cutting workflow), three roles + agile-orchestrator persona, three aggregate roots, twelve invariants (incl. I11 two-cap sizing and I12 no-silent-amendments), scope discipline in both directions, per-context persistence shape, one-tier Linear sync (incl. promotion + demotion patterns).
- [ ] **AC2.** [`workflow.md`](workflow.md) carries the seven lifecycle stages + the design-discussion cross-cutting workflow + the cadences + the artefacts at each step.
- [ ] **AC3.** The principle docs exist under [`principles/`](principles/) and each captures the principle plus a template where applicable.

### Workflows are implementable (Layer 2)

The skill family is built in two phases: (a) local build + trial in `prisma-next` (`.agents/skills/`), then (b) upstream promotion to `prisma/ignite`. ACs below are scoped accordingly.

**Local build (`prisma-next` `.agents/skills/`):**

- [ ] **AC4.** The three workflow skills exist locally: `drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`. Each pilots its named multi-step loop end-to-end; each is directly invokable; each calls atomic skills as documented steps.
- [ ] **AC5.** `drive-triage-work` exists locally. Implements the eight-verdict decision tree; runs at entry-time AND mid-flight (called by `drive-start-workflow` in both modes); wired to the `drive/<category>/README.md` convention.
- [ ] **AC6.** `drive-build-workflow` carries the five augmentations: per-dispatch DoR pre-flight, WIP-inspection cadence as a named loop step, per-dispatch DoD post-flight, brief template, L/XL refusal + design-discussion stop-condition on assumption-falsification.
- [ ] **AC7.** Each remaining canonical drive-* skill listed in [`skill-restructure.md`](skill-restructure.md) (splits, new atomic skills, augmentations, vocabulary-only refresh) exists in its restructured form locally. Each skill body references the principle docs it depends on.
- [ ] **AC8.** A grep across `prisma-next` `.agents/skills/drive-*` skill bodies for floating-scope vocabulary (`\bmilestone\b`, `\btask\b` in its pre-model sense, `\bstep\b` in its planning-sense pre-model use) returns only matches inside explicit deprecation notices or model-teaching examples.

**Trial validation:**

- [ ] **AC9.** The skill family has been used in real `prisma-next` work for at least two weeks. Retros have fired on at least three real triggers; each landed an update in a memory-strong surface (canonical body / `drive/<category>/README.md` / ADR).

**Upstream promotion (`prisma/ignite`):**

- [ ] **AC10.** Each surviving skill has its own PR in `prisma/ignite`, stacked on PR #93, independently reviewable. Each PR's body references this spec and the relevant [`model.md`](model.md) / [`principles/`](principles/) sections.

### Walkthroughs run end-to-end (via the local skill family)

- [ ] **AC11.** Walkthrough 1 (direct change): a trivial entry point runs through `drive-start-workflow` → `drive-triage-work` outputs "direct change" verdict → `drive-pr-description` (direct-change framing) → `gh pr create` with intent in the PR body, no on-disk artefact.
- [ ] **AC12.** Walkthrough 2 (multi-PR project): a project-sized entry point runs through `drive-start-workflow` → promotion → `drive-deliver-workflow` → project initiation → slice-by-slice via `drive-build-workflow` → slice review → slice closure → project closure with mandatory final retro.
- [ ] **AC13.** Walkthrough 2 mid-flight branch: an in-flight slice (inside `drive-build-workflow`) hits an assumption-falsification → stop-condition fires → escalates to `drive-discussion` → spec/plan edit produced → `design-decisions.md` entry recorded.
- [ ] **AC14.** Walkthrough 3 (demotion): a mid-flight project where the remaining scope is one PR routes through `drive-start-workflow` in mid-flight mode → demotion ceremony → surviving Linear issue stands alone → project Cancelled or Completed → on-disk artefacts retired.
- [ ] **AC15.** An orphan slice runs end-to-end: a bug-fix-scale entry point runs through `drive-start-workflow` → orphan slice setup → `drive-build-workflow` → exactly one PR with the slice spec inline in the PR description and no `projects/<x>/` artefact.

### Documentation lands

- [ ] **AC16.** `docs/engineering/drive-process.md` in `prisma/ignite` is rewritten to teach the consolidated model, the two skill tiers (workflow + atomic), and dispatch discipline. The PR #93 content (Skill Map, "Project context for drive skills" section) is preserved and integrated.
- [ ] **AC17.** [`calibration/prisma-next.md`](calibration/prisma-next.md) is the worked-example calibration: reference tasks for t-shirt sizing, DoR / DoD overlays for `prisma-next`, failure-mode catalogue, grep library, manual-QA context, with a section-by-section mapping table to its destination `drive/<category>/README.md` files.
- [ ] **AC18.** The synthesis of the drive-context-convention audit (`projects/drive-context-convention/audit/SYNTHESIS.md` in `prisma/ignite`) carries a header / footer annotation explaining which Tier 1 recommendations were superseded by this project, with pointers. Audit reports themselves stay unmodified.

## Alternatives considered

The full alternatives ledger lives in [`design-decisions.md`](design-decisions.md) (23 decisions). The load-bearing ones for understanding the design:

| Decision | Considered alternatives | Chosen | Why |
|---|---|---|---|
| **Sizing metric** (D1) | Time-based estimates; story points; t-shirt sizes + wall-clock time-boxing | T-shirt sizes + wall-clock time-boxing per size | Decouples size from executor throughput; resists Fibonacci-precision waste; anchors to reference tasks rather than abstract numbers. |
| **Dispatch size cap** (D3) | Soft preference; hard cap (M); per-task escape valve | Hard cap (M) | Soft rules don't survive deadline pressure. The reversal we hit was dispatched as L despite the brief admitting the size — a hard rule forces the decomposition. |
| **Step vs Dispatch as the agent-delegation unit** (D11) | "Step" everywhere; "Dispatch" everywhere; both with different scopes | "Dispatch" for agent-session unit; "Step" demoted to implementer-internal | "Dispatch" captures aggregation — one delegation may contain multiple logical steps but presents as one interaction. The DoR/DoD/WIP rituals fire per dispatch, not per step. |
| **Direct change unit** (D12) | Treat trivial work as "slice with no ceremony"; bypass Drive entirely; add Direct change as sibling-of-Slice | Direct change as sibling-of-Slice | Triage needs a name for the verdict; modelling the unit lets rituals adapt to it. Captures the spectrum (project / slice / direct change) cleanly. |
| **Design discussion shape** (D13) | Generic mode skill mentioned in passing; lifecycle stage between Triage and Project initiation; cross-cutting workflow with multiple triggers | Cross-cutting workflow (D13c) | It isn't a stage — it fires multiple times across a project's lifetime on different triggers. Pairing with I12 gives structural protection against silent amendments. |
| **Triage scope** (D14) | Entry-point only; entry + mid-flight in two separate workflows; entry + mid-flight as one workflow with two modes | One workflow with two modes | Promote and demote are scope-shift decisions — exactly what triage does. Modelling them as separate workflows would duplicate the decision tree. |
| **Linear promotion ceremony** (D15) | Keep ticket as project "top story"; close ticket entirely; hybrid (move ticket into project, mark Done) | Hybrid (D15c) | Preserves the original ticket as the historical marker of the original ask while making the project the durable handle. |
| **Spec/plan split** (D17) | Scope flag on existing skills; split into per-scope skills | Split into per-scope skills (`drive-project-specify` etc.) | Project-scope and slice-scope have meaningfully different inputs / outputs / audiences / templates; a flag papers over genuinely different shapes. |
| **Two sizing caps vs one** (D18) | One M-cap at the dispatch level; one PR-cap at the slice level; both caps independent | Both, codified as I11 | The caps capture different concerns: review-ability vs agent-session inspect-ability. Neither subsumes the other. |
| **PR #93 as base** (D21) | Treat PR #93 as orthogonal (consumer migration handles integration later); treat PR #93 as assumed-landed base | PR #93 is the base | The QA pair is non-optional for slice/project DoD; the project-context convention is the only canonical answer to where project-specific QA / spec / plan facts live. Without PR #93 the restructure ships into a vacuum. |
| **Calibration architecture** (D23) | Generic "calibration" guidance, teams figure out per-overlay home; explicit per-overlay home in `drive/<category>/README.md` per PR #93 convention | Explicit per-overlay home (D23b) | Generic guidance is undisciplined — teams add items where convenient (often inside in-repo skill copies, which then drift). Naming the home turns "where does this go?" into a lookup. |

## Open questions

Working positions; resolved questions are recorded in [`model.md`](model.md) § Open questions.

1. **What enforces I1 (one slice → one PR)?** Working position: agile-orchestrator WIP-inspection during slice execution surfaces "should we split?" mid-flight; no hard gate.
2. **What enforces I2 (project scope doesn't expand)?** Working position: triage itself enforces — every time new work surfaces, mid-flight triage re-reads the project spec to make the in-or-out call.
3. **Scope-deferred work landing pad.** Working position: `projects/<project>/deferred.md` during a project; reviewed at project closure. Per-orphan-work: operator scratch.
4. **What enforces I12 (no silent agent-side amendments)?** Working position: orchestrator stop-condition fires on detected drift (per `drive-build-workflow` unattended-mode rules); design discussion produces the amendment with operator participation.
5. **Name for the triage skill.** Working position: `drive-triage-work` — aspirationally compliant with the `<scope>-<verb>-<noun>` taxonomy in `skills/README.md`.
6. **How is the project spec written when full scope isn't knowable yet?** Working position: two passes — purpose statement fixed in the first pass (immutable per I7); scope boundary sharpened in later passes as slices deliver. Design discussion is the mechanism for the second pass.
7. **Stacked PRs in Linear.** Linear has no first-class stacking metadata. Working position: each PR is its own Linear issue; the stack order is recorded in the project plan and in the PR descriptions; Linear sees a sequence of issues without explicit stacking metadata.
8. **N for the unattended-mode drift alarm in `drive-health-check`.** Working position: calibrate per-project; default to 3 consecutive dispatches without slice progress.
9. **Demotion authorisation.** Working position: agile orchestrator surfaces a demotion candidate as a structured decision; operator authorises before any Linear cleanup runs.
10. **How does the protocol become machine-readable for an agent orchestrator?** Likely answer: the principles + rituals as a `drive/agile` skill the orchestrator loads automatically; the always-applied invariants (no L/XL dispatch, WIP-inspection cadence, DoR/DoD gates) as a rule that fires when any `drive-*` skill is in play. Pin during skill restructuring.
11. **Migration path for existing in-flight Drive projects in `prisma/ignite`.** Working position: retroactively reshape only if there's a clear payoff; let existing in-flight artefacts age out under the old model; new projects use the new model.

## References

- [`problem-statement.md`](problem-statement.md) — self-contained problem framing, suitable for sharing with Ignite maintainers
- [`model.md`](model.md) — pinned domain model
- [`workflow.md`](workflow.md) — operational lifecycle map (Drive ↔ Agile)
- [`design-decisions.md`](design-decisions.md) — chronological decisions log (the full alternatives ledger)
- [`principles/`](principles/) — per-principle deep-dives
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration
- [`skill-restructure.md`](skill-restructure.md) — proposed skill set with augmentations + implementation sequencing
- [`plan.md`](plan.md) — execution plan (upcoming)
- `docs/engineering/drive-process.md` (in `prisma/ignite`) — canonical Drive process doc; rewritten as AC16
- `skills/README.md` (in `prisma/ignite`) — naming taxonomy this model layers on top of
- `wip/unattended-decisions.md` — the 2026-05-17 dispatch-drift capture that motivated the methodology half
- [PR #93](https://github.com/prisma/ignite/pull/93) — the drive-context-convention machinery this project stacks on top of

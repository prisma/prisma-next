---
name: drive-orchestrate-plan
description: Orchestrates the local implement-review iteration loop for a project plan. Delegates tactical execution to a sub-agent implementer and independent on-disk assessment to a sub-agent reviewer, looping until the reviewer reports SATISFIED on each phase. Use when a `projects/<project>/plan.md` exists and the user wants the plan driven to a review-clean state before opening a PR. Sits between `drive-generate-plan` and `create-pr` / `github-review-iteration` in the `drive-*` family.
argument-hint: "[iterate|implement|review] [phase-id]"
disable-model-invocation: true
---

# Drive: Orchestrate Plan

Run the local implement-review iteration loop on a project plan: **delegate one round of implementation → delegate one round of review → triage verdict → loop / escalate / proceed** until the reviewer reports `SATISFIED` on each phase.

This skill is an **orchestrator**. It delegates:

- implementation to `./agents/implementer.md`
- review to `./agents/reviewer.md`

The orchestrator owns sequencing, escalation, plan/spec amendment in response to user decisions, and loop control. It does **not** perform implementation or review directly when delegation is available.

## When to use

**Use this skill when:**

- A `projects/<project>/spec.md` and `projects/<project>/plan.md` already exist (typically produced by `drive-create-spec` and `drive-generate-plan`).
- The user wants to drive the plan to a review-clean state on the local branch, before opening a PR.

**Do not use this skill for:**

- Producing the spec or plan — defer to `drive-create-project` / `drive-create-spec` / `drive-generate-plan`.
- Addressing PR review comments — defer to `github-review-iteration`.
- Driving CI failures to green — that is a separate concern with different signals (CI logs, not spec ACs); a future `drive-ci-green` skill belongs in that role.

## Pre-conditions

- `projects/<project>/spec.md` exists and is current.
- `projects/<project>/plan.md` exists, is broken into phases with explicit validation gates, and the validation gates name the project's actual harness commands (e.g. `pnpm test:integration`, `pnpm lint:deps`).
- The orchestrator (you, the calling agent) has the user's approval to delegate work to sub-agents.

## Post-conditions

- Each phase identified by the plan has reached `SATISFIED` per the reviewer's verdict in `projects/<project>/reviews/code-review.md`.
- The acceptance-criteria scoreboard in `code-review.md` records every spec AC as PASS, accepted-deferral, or out-of-scope.
- `system-design-review.md` and `walkthrough.md` reflect the as-built state at HEAD (refreshed by the reviewer every round; see § The artifact contract).
- The branch is ready for `create-pr`.

## Locating sibling skills

Path conventions are relative to this skill directory:

- `./agents/implementer.md` — implementer persona/protocol.
- `./agents/reviewer.md` — reviewer persona/protocol.
- `./templates/code-review.template.md` — initial scaffold for `reviews/code-review.md`.
- `./templates/delegate-implement.md` — canned implementer delegation prompt skeleton.
- `./templates/delegate-review.md` — canned reviewer delegation prompt skeleton.
- `./templates/unattended-decisions.template.md` — scaffold + entry format for the unattended-mode decisions log (see § Unattended mode).
- `./learnings.md` — canonical lessons drawn from prior runs (foot-guns, escapees, patterns to watch for).

Upstream sibling skills (different directory):

- `drive-create-project`, `drive-create-spec`, `drive-generate-plan` produce this skill's inputs.
- `commit-as-you-go` for commit-shaping guidance during the implementation rounds.
- `drive-pr-local-review` if the project lacks a `code-review.md` and you want one bootstrapped before iteration begins.

Downstream sibling skills:

- `create-pr` to open the PR once SATISFIED.
- `github-review-iteration` to handle PR review comments after the PR is open.

## Subcommands

```
/drive-orchestrate-plan iterate [phase-id]
/drive-orchestrate-plan implement [phase-id]
/drive-orchestrate-plan review
```

- **`iterate`** (default): full loop on the named phase (or the next pending phase if omitted) until SATISFIED.
- **`implement`**: delegate one round of implementation only. Useful for stepping through manually.
- **`review`**: delegate one round of review only. Useful for auditing current state without changing code.

`<phase-id>` corresponds to the phase identifier in `plan.md` (e.g. `phase-3`, `phase-4`).

## The three personas

### Orchestrator (you, the calling agent)

Holds the strategic context: spec intent, plan structure, AC scoreboard, decision history, user preferences. Does **not** write code or independently assess correctness — synthesizes implementer and reviewer outputs instead.

The orchestrator is also responsible for **subagent continuity**: tracking the implementer and reviewer subagent IDs and resuming them across rounds rather than spawning fresh ones (see § Subagent continuity).

**Epistemic frame.** You are the only role with project-level intent visibility. The implementer reasons forward from artifacts (plan tasks → diff); the reviewer reasons forward from artifacts (spec ACs → implementation match); only you reason forward from *intent* — the conversation history that produced the spec, the user's explicit preferences, the strategic shape of the project across phases. Both sub-agents structurally lack this context, no matter how good their prompts: the spec and plan are checklist artifacts, but the conversation that produced them is not durable in the artifact trail. This asymmetry is load-bearing. Applying the intent frame at every checkpoint — especially when triaging reviewer verdicts — is your unique contribution to loop quality, and the only protection against architectural drift hardening through iteration.

**Optimizes for:**
- Minimal user-attention cost: surface only what genuinely requires user input; bury what doesn't.
- Subagent continuity: resume the persistent implementer and reviewer across rounds (see § Subagent continuity). Spawn fresh only on round 1 or when a prior ID is no longer accessible.
- Self-contained delegation prompts on round 1; follow-up-shaped prompts on resumed rounds.
- Rapid loop iteration: each round resolves more findings than it introduces.
- Honest pushback acceptance: when an implementer brings evidence, the orchestrator updates the reviewer's record rather than rubber-stamping.
- Intent fidelity: a `SATISFIED` verdict is necessary but not sufficient. Cross-check against project intent before treating it as ground truth.

**Anti-patterns:**
- Re-litigating the spec mid-loop without explicit user buy-in.
- Forming independent opinions about correctness without delegating.
- Burying flagged items in summaries instead of escalating them as structured decisions.
- Accepting a reviewer return that omits `system-design-review.md` or `walkthrough.md`. Both refresh every round; missing files mean the round is incomplete (see § The artifact contract).
- Treating reviewer verdicts as authoritative on intent. Reviewer verdicts are authoritative on artifact-match; intent fidelity is yours alone.

### Implementer (sub-agent at `./agents/implementer.md`)

Tactical executor. Plan-driven, validation-rigorous, honest about surprises. **One implementer per project** by default — the same subagent ID is resumed across rounds and across phases (see § Subagent continuity).

### Reviewer (sub-agent at `./agents/reviewer.md`)

Independent on-disk assessor. AC-driven, severity-aware, read-only constraint on non-review artifacts. **One reviewer per project** by default — the same subagent ID is resumed across rounds and across phases (see § Subagent continuity).

## Subagent continuity

**Default:** one implementer subagent and one reviewer subagent per project. The orchestrator resumes the same subagent IDs across every round and every phase, rather than spawning fresh subagents each time.

The mechanic — for Cursor's `Task` tool — is the **`resume`** parameter: passing the agent ID returned by a prior `Task` invocation sends the new prompt as a follow-up message to that subagent, preserving its full transcript. Without `resume`, every invocation starts fresh and the subagent loses everything it learned in prior rounds.

### Why this matters

A fresh subagent each round produces three concrete failure modes:

1. **Procedural anomalies that look like the work was already done.** A fresh implementer asked to land tasks T<N> may discover, on inspection, that a prior round's commits already cover them — but it has no continuity to verify whether those commits are *its own* prior work or someone else's stray edits. The orchestrator then has to investigate, often surfacing it to the user, and can't easily distinguish "an earlier subagent did this" from "the user did this between rounds" from "another agent in another window did this."
2. **Context re-derivation cost.** A fresh subagent re-reads the same files, re-learns the same constraints, and re-discovers the same subtle landmines that a resumed subagent would already know about. Every round pays this cost.
3. **Findings drift across rounds.** A fresh reviewer cannot remember the *reasoning* behind their prior round's verdict — only what's on disk. Subtle calibrations ("F3's severity was deliberately `should-fix` because of X") get lost. The reviewer's mental model of the project rebuilds from scratch each round, which is expensive and error-prone.

### When to spawn fresh

The default is resume; spawn fresh only in these specific cases:

- **First round of the project.** No prior subagent ID exists; spawn fresh.
- **A subagent ID is no longer accessible** (e.g. resuming a sufficiently old subagent fails). Spawn fresh, record the new ID, and continue.
- **A pivot of role intent** — rare. E.g. if the user explicitly asks for a "fresh-eyes" reviewer pass, spawn fresh as a deliberate one-off and revert to the persistent reviewer for subsequent rounds. Document the deliberate choice in `code-review.md`.

Spawning fresh because "the new round is a different phase" is **not** a legitimate reason. Phase transitions don't reset the project's intent; the persistent subagents carry their understanding of the project across phases, which is the point.

### Recording subagent IDs

Record both subagent IDs in `code-review.md` § Subagent IDs, immediately after the AC scoreboard, with the round each was first spawned in:

```markdown
## Subagent IDs

- **Implementer:** `<id>` — first spawned in m1 R1; resumed every round since.
- **Reviewer:** `<id>` — first spawned in m1 R1; resumed every round since.
```

If a subagent is replaced (per the "spawn fresh" cases above), append a note recording the swap and the round it happened. The IDs are durable artifacts so a subsequent orchestrator session can pick up the same subagents without re-deriving them.

### Adapting the delegation prompt on resume

The templates in `./templates/` assume a self-contained prompt because they were written for fresh subagents. On resume, the prompt becomes a **follow-up message**, not a fresh delegation; you can lean lighter on context-restating because the subagent retains its prior transcript. Concrete adjustments:

- Skip the persona pointer (`Your persona is at <skill-dir>/agents/implementer.md`) on resume — the subagent already loaded it.
- Skip the spec/plan locations on resume — the subagent already knows.
- **Do** restate the round identifier (`This is m3 R2`), the new findings to address, and the validation gates for this round. Those change every round.
- **Do** restate any decisions standing from prior rounds that the subagent must respect — even though it remembers them, restating provides a paper trail in the round's prompt artifact and reduces ambiguity if context-window pressure has compressed earlier turns.

Both delegation templates have a `Resume mode` section that covers this; use the appropriate mode for the round.

### Other subagents

This continuity rule applies to the **implementer and reviewer**, who participate in iteration. One-shot subagents (e.g. a `create-pr` subagent at the end of the project, a fresh-eyes reviewer asked for a one-time PR-body rewrite) do not need to be resumed across multiple invocations — they are spawned, do their job, and are not re-used.

## The artifact contract

The on-disk artifacts that decouple the three agents (each lives under `projects/<project>/`):

```
projects/<project>/
├── spec.md                          # intent, decisions, ACs (drive-create-spec)
├── plan.md                          # tasks, phases, validation gates (drive-generate-plan)
└── reviews/
    ├── code-review.md               # scoreboard + subagent IDs + F-numbered findings (reviewer-maintained)
    ├── system-design-review.md      # architectural review (reviewer-refreshed every round)
    └── walkthrough.md               # semantic narrative (reviewer-refreshed every round)
```

`code-review.md` carries a § Subagent IDs section directly under the AC scoreboard recording the persistent implementer + reviewer IDs (see § Subagent continuity). The reviewer maintains the IDs section under the same RW grant as the rest of `code-review.md`.

**All three review artifacts are produced or refreshed on every round.** None of the three may be deferred or skipped — including the first round. The reviewer's first round bootstraps all three; subsequent rounds refresh them with the round's delta.

When a round genuinely adds nothing substantive to `system-design-review.md` (e.g. m1 establishes the design; m2 implements the runtime without changing design decisions), the document still updates — it gains a "Round N" note recording what was evaluated, what stayed stable, and what new evidence (commits, tests) corroborates the design. "No design changes this round" is content for the document, not a reason to skip it.

The walkthrough is the user's **primary review surface** for any single round. It must always reflect HEAD. A missing or stale walkthrough is a delegation-protocol failure on the same level as a missing verdict.

**Read/write matrix:**

| Artifact                          | Orchestrator | Implementer    | Reviewer       |
|-----------------------------------|--------------|----------------|----------------|
| `spec.md`                         | RW           | R              | R              |
| `plan.md`                         | RW           | R              | R              |
| `code-review.md`                  | R[^1]        | R              | RW             |
| `code-review.md § Subagent IDs`   | RW           | R              | R              |
| `code-review.md § Orchestrator notes` | RW       | R              | R              |
| `system-design-review.md`         | R            | R              | RW             |
| `walkthrough.md`                  | R            | R              | RW             |
| `packages/**`                     | —            | RW             | R              |
| `test/**`                         | —            | RW             | R              |

[^1]: The orchestrator has a write carve-out for two specific subsections of `code-review.md`: § Subagent IDs (records the persistent implementer + reviewer subagent IDs — see § Subagent continuity) and § Orchestrator notes (records visible verdict overrides per § Loop algorithm step 7). Everything else under `code-review.md` is reviewer-only RW.

The implementer **never** edits `spec.md` or `plan.md` — those are the orchestrator's surface for translating user decisions into structure. The reviewer is **read-only on code and tests** — review-only constraint.

## Findings discipline

`code-review.md` § Findings log is a **work backlog for the implementer's next round**, not a journal of observations. Every entry is something the implementer must address before the phase reaches `SATISFIED` — across all severities. No severity lets a finding carry across phases.

This is the most important way `drive-orchestrate-plan` differs from `drive-pr-local-review`:

- `drive-pr-local-review` is a **one-shot** branch review. Out-of-scope observations and "consider this for the future" notes are legitimate output — they go in a `Deferred` section, the reader can act on them or not.
- `drive-orchestrate-plan` operates inside an **iterate-implement loop**. Every finding the reviewer files reaches the implementer as part of the next delegation. Findings that recommend "no action," "defer to a future phase," or "consider in the future" produce **noise**, dilute the implementer's attention, and obscure the real action items.

**The bar for filing a finding:** the recommended action must be **addressable by the implementer in the current PR**, in either the current phase or an explicitly named later phase. If the recommended action is genuinely "no change in this PR," the observation is not a finding:

- If it warrants action in a future phase of this PR → orchestrator adds a task to that phase's task list in `plan.md`. Not a finding.
- If it warrants action in a future PR / project → orchestrator records in `plan.md § Open items` or files a follow-up ticket. Not a finding.
- If it's narrative context that helps the reviewer's verdict make sense → goes in the round's narrative notes. Not a finding.
- If it's none of the above → it's noise, drop it.

The reviewer surfaces candidates that warrant a plan amendment to the orchestrator, who decides where they land before the next implementer round runs. The implementer should never see "you have nothing to do here" findings in their delegation prompt.

Severity guidance — all severities block phase `SATISFIED`. Severity is for **within-round prioritization**, not for deciding which findings can carry forward.

- **must-fix**: correctness-class. AC violation, regression, broken validation gate. The implementer addresses these first in the next round.
- **should-fix**: code-quality / consistency / convention concerns the implementer addresses alongside must-fix items.
- **low / process**: in-scope process or hygiene improvements (e.g. "this cast lacks the comment AGENTS.md requires"; "this test name doesn't match the convention in this package"). Still actionable, still addressed in the next round. Not a forward-looking note.

There is no "informational" tier. If you would file something with a non-actionable recommendation, do not file it.

**Phase `SATISFIED` requires the findings log to be empty of opens** — no severity carries past phase close. If a finding is genuinely too small to address in this phase but real enough to track, it's not a finding; it's either a plan amendment (orchestrator records it) or noise (drop it).

## The loop algorithm

For each phase in `plan.md` (or the single phase named in `iterate <phase-id>`):

1. **Pre-flight.** Confirm `code-review.md` exists; if not, scaffold it from `./templates/code-review.template.md` so the AC scoreboard exists from round 1. Read `code-review.md § Subagent IDs` to recover the persistent implementer/reviewer IDs from prior rounds; if absent (project's first round, or a fresh chat session inheriting the project), note that this round will spawn fresh and record the IDs.
2. **Delegate implementation** using `./templates/delegate-implement.md`, pre-filled with the phase scope, prior-round context (if R2+), and validation gates from the plan. **Resume the persistent implementer subagent** by passing its ID via the `resume` parameter on the `Task` tool, except on the first round of the project where you spawn fresh and record the new ID in `code-review.md` (see § Subagent continuity).
3. **Receive implementer report.** Expect: diff highlights, validation results, flagged items, deferral requests, anything surprising.
4. **If implementer returns deferral requests**: surface to the user as a structured decision (see § Escalation surface). Do not re-delegate until the user has decided.
5. **Delegate review** using `./templates/delegate-review.md`, passing pointers to recent commits and the implementer's report. **Resume the persistent reviewer subagent** by passing its ID via the `resume` parameter, except on the first round of the project where you spawn fresh and record the new ID (see § Subagent continuity).
6. **Receive reviewer verdict.** One of `SATISFIED`, `ANOTHER ROUND NEEDED`, `ESCALATING TO USER`.
7. **Validate the review against intent.** Required step. The reviewer reasons forward from artifacts; you reason forward from intent (see § The three personas → Orchestrator → Epistemic frame). Read the verdict, the AC scoreboard delta, the new findings (and their severities), and any narrative artifacts the reviewer refreshed (`system-design-review.md`, `walkthrough.md`). Apply your project-level context to four questions:

   - **Does this verdict reflect intent, not just artifact-match?** A `SATISFIED` verdict on a spec that misses a subtle decision is still wrong.
   - **Did the reviewer let any architectural choice through that I should question?** The reviewer's role discipline is to validate against the spec; the orchestrator's role *is* to second-guess design when intent demands it.
   - **Are finding severities calibrated correctly given cross-phase context?** A reviewer-flagged `low` may be `should-fix` once you account for downstream phases; vice versa.
   - **Is anything missing that I'd expect to be flagged given intent context?** This is the hardest question and the highest-value one — answer it by applying the strategic shape the reviewer cannot see.

   This is a 2-minute skim, not a re-review of the diff. You are *applying* the intent frame to the reviewer's output, not re-doing the reviewer's job. Possible actions, choose by judgment:

   - **Pass-through** (most common): the reviewer's output reflects intent. Proceed to step 8.
   - **Re-prompt the reviewer** with a focused gap ("you said `SATISFIED` but missed X; revisit"). Preserves the reviewer's role and avoids the orchestrator becoming the de facto reviewer.
   - **Override a verdict** (rare): demote `SATISFIED` to `ANOTHER ROUND NEEDED` with rationale, recorded under an `## Orchestrator notes` section in `code-review.md`. Frequent overrides mean the reviewer is mis-calibrated — that's a separate problem worth raising with the user.
   - **Refine spec/plan**: intent-validation occasionally reveals the spec is wrong, not the implementation. Treat as a replan trigger (see § Replan protocol).

   Any action other than pass-through must be **visibly recorded** — in `code-review.md`, in the next delegation prompt, or both. Invisible orchestrator-only edits to the verdict break the artifact contract.

8. **Triage verdict** (post intent-validation):
   - `SATISFIED` → report phase completion to the user, recommend the next phase or transition to PR.
   - `ANOTHER ROUND NEEDED` → re-prompt implementer with the reviewer's findings; loop to step 2.
   - `ESCALATING TO USER` → surface the reviewer's concerns as a structured decision.
9. **Confirm narrative-artifact refresh.** After `SATISFIED` on a phase, verify that `system-design-review.md` and `walkthrough.md` reflect the as-built state at HEAD. The reviewer is required to refresh both every round (see § The artifact contract); your job here is to confirm — open both, scan for round-N content, fail loudly if either is missing or outdated. If the reviewer skipped the refresh, that's a delegation-protocol failure: re-prompt the reviewer with a refresh-only delegation; do not accept the phase as `SATISFIED` until both reflect HEAD.

## Escalation surface

When the reviewer or implementer surfaces items requiring user decision, the orchestrator presents them in a uniform shape:

```
**N. <Finding ID and short title>** — <one-paragraph problem statement>.

<Optional context: severity, prior decisions, related findings.>

   - **(a) <option>** — <consequence>.
   - **(b) <option>** — <consequence>.
   - **(c) <option>** — <consequence>.

<Optional recommendation, if the orchestrator has a defensible bias.>
```

Rules:

- **Number the decisions**, not just options within a decision. Multiple findings in one escalation get parallel decision blocks.
- **Lead with the problem statement** before options, so the user can form their own view before reading recommendations.
- **State a recommendation only when defensible** — e.g. you've checked the relevant code, evaluated the trade-off, and have evidence. If the trade-off is genuinely the user's call, say so and do not recommend.
- **Translate the user's response back into plan/spec edits before re-delegating.** A decision that lives only in the orchestrator's head is invisible to future sub-agent rounds. New scope → plan amendment. Renamed concept → spec amendment. Accepted deferral → record in `plan.md` § Open items.

## Replan protocol

The user has explicitly opted into being involved on every replan, but the protocol is documented here so the orchestrator can surface replan triggers consistently.

A **replan** is required when:

- A finding invalidates a phase's design (architectural mistake surfaced mid-loop).
- A deferral expands scope beyond what the current PR can defensibly carry.
- A reviewer-promoted "should fix" item demands new tasks the plan doesn't cover.
- The user adds scope mid-loop (the kind of "let's also rename X while we're here" that today's session contained).

Triggered replan steps:

1. Orchestrator pauses the loop and surfaces the replan trigger to the user as a structured decision (see § Escalation surface).
2. User decides scope: `accept-and-add-tasks` / `file-as-follow-up-ticket` / `accept-as-out-of-scope` / `restructure-the-plan`.
3. Orchestrator translates the decision into plan/spec edits **before** re-delegating downstream:
   - `accept-and-add-tasks` → new T-numbered tasks under the appropriate phase, validation-gate amendments where needed.
   - `file-as-follow-up-ticket` → a new Linear ticket with cross-link from `spec.md § Out of scope`.
   - `accept-as-out-of-scope` → an entry in `plan.md § Open items` with rationale.
   - `restructure-the-plan` → a delta-plan; consider invoking `drive-generate-plan` for a fresh take rather than open-heart-surgery on the current plan.
4. After plan/spec edits land, orchestrator may re-delegate.

The orchestrator should **never** delegate to the implementer with the new scope baked into a delegation prompt without the plan recording it. That hides scope from future rounds, defeats the artifact contract, and makes audit-trail reconstruction painful.

## Unattended mode

When the user explicitly hands off the loop without availability for further input — phrases like *"continue without me to the end"*, *"use your best judgement"*, *"I'll be unavailable for comment"*, *"don't ask me, just drive"* — the orchestrator runs in **unattended mode**. The defaults shift in two ways:

1. **Decisions that would normally be escalated to the user are made in-place**, using the most defensible reading of project intent.
2. **Every such decision is logged**, in a format the user can audit on return *without needing to cross-reference other documents*.

The user has explicitly traded interactivity for a written audit trail; the trade is only honored if the trail is readable on its own.

### When unattended mode applies

Treat any of the following as a mode-shift trigger (non-exhaustive):

- "continue without me", "drive the rest", "go to the end", "do the whole thing"
- "use your best judgement", "don't ask me", "I'll be away", "no need to check in"
- An explicit instruction to invoke this skill non-interactively

Acknowledge the mode shift in the first response after the trigger ("Operating in unattended mode; decisions will be logged to `wip/unattended-decisions.md`."). Continue until the work is complete or a stop condition fires.

### Operating rules under unattended mode

These tighten the orchestrator's defaults when no user is on-hand to course-correct:

- **Conservative scope.** No work outside the scope already approved in `spec.md` / `plan.md`. New scope = stop, file as out-of-scope, recommend follow-up ticket. If a finding implies scope expansion, log the decision and decline to act on it.
- **Defensible choices over novel architecture.** When two equally valid options exist, pick the one closer to existing repo conventions. Log the alternatives.
- **Pre-existing flakes / unrelated failures.** If a non-phase failure surfaces, log it. Fix only if it blocks a validation gate; otherwise leave for the user.
- **Reviewer drift.** Every intent-validation override (per § Loop algorithm step 7) is logged in addition to the visible record in `code-review.md § Orchestrator notes`.
- **No `--no-verify`.** No skipping of pre-commit hooks under any circumstance, including amends.
- **No remote push beyond what the loop normally does.** Branch stays local; PR opening is a separate skill (`create-pr`) and is invoked only if the user explicitly named it as part of the unattended scope.
- **No third-party automation expansions.** Don't authorize automated agents (e.g. CodeRabbit's "shall I open a tracking issue?") to create artifacts in the team's trackers without human approval. Decline politely; log the decline.

### Stop conditions

Halt and leave the branch in a recoverable state if any of these surface:

- A validation gate cannot be made green within the in-scope work.
- The implementer surfaces a blocker that cannot be defensibly resolved without an architectural decision.
- The spec/plan turn out to be wrong in a way you cannot correct from intent alone.
- The user's prior decisions are mutually inconsistent in a way that requires their input to resolve.
- A scope expansion is required to complete the work as specified (rather than as a separable concern).

When stopping, write a stop entry in the decisions log with the trigger and the recoverable state at HEAD.

### The decisions log

**Location.** `wip/unattended-decisions.md` (or the repo's gitignored scratch equivalent if `wip/` isn't in use). The file **must be gitignored** — it is the user's personal review surface, not a shipped artifact.

**Lifecycle.**
- On entering unattended mode, scaffold the file from `./templates/unattended-decisions.template.md` (preamble + operating rules + entry format reference) if it doesn't already exist.
- Append an entry every time you make a decision that would have been escalated under normal operation. This includes: triage decisions in place of the user; declining out-of-scope findings; verdict overrides; accepted side-quests; declined offers from automated agents; deferring pre-existing failures.
- Append a stop entry if a stop condition fires.

**Append-only and chronological.** Do not reorder entries or backfill. The log is read by a human after the fact who needs an audit trail; out-of-order entries break that.

### Entry format — readability is load-bearing

The user reading this log on return is **not in your context**: review artifacts may be deleted by close-out, finding IDs and round labels are meaningless without their source documents, and the user has not been tracking the loop in real time. The format must absorb that asymmetry.

Concrete rules:

- **Do not refer to findings by ID** (`F17`, `F18`, `A02a`). Translate the substance into plain language: *"a JSDoc comment in `migration-cli.ts` cross-referenced the project's `spec.md`, which would become a dead link after close-out deleted the project folder"*.
- **Do not lead with round labels as the trigger** (`Phase 5 R2 triage`). Reference rounds only as date-equivalents for ordering, never as the substance of why a decision came up.
- **Do not assume the reader can read other artifacts.** `code-review.md`, the per-PR `review-actions.json`, and inflight delegation prompts are likely deleted, stale, or simply not where the user is looking by the time they audit. Restate any context the entry depends on.
- **Lead with what was decided, then explain the why.** The reader is auditing — they want to know what was done first, then evaluate the reasoning.
- **Make verification concrete.** Every entry includes a *How to verify* section with a specific check the user can run without further context: a file to read, a symbol to grep, a commit SHA to inspect, a behavior to observe.

The four questions an entry must answer (the user has explicitly named these):

1. **What decision was made?** — concrete, in plain language.
2. **Why was it flagged to begin with?** — what surfaced it; what the actual concern was.
3. **Why is it important?** — the impact if the wrong choice was made.
4. **How can I verify it?** — what to check on disk to confirm the choice was sound.

The full entry template (with `Context` / `The concern` / `Options I considered` / `My choice` / `Why` / `How to verify` / `How to undo if wrong` / `Affected`) lives in `./templates/unattended-decisions.template.md`. Use it directly.

### Returning to interactive mode

When the user re-engages, hand them the log explicitly: list the decision titles inline, surface anything you flagged as needing their attention, and confirm whether any deferred items still need a destination (Linear ticket, plan amendment, follow-up PR). Do not assume they've read the log — the listing is the handoff.

## Behavioral rules

These are the cross-cutting invariants the orchestrator is responsible for enforcing across every loop iteration.

- **Resume the persistent implementer and reviewer across rounds.** One implementer ID and one reviewer ID per project, recorded in `code-review.md § Subagent IDs`. Resume via the `Task` tool's `resume` parameter on every round after the first; spawn fresh only in the cases enumerated in § Subagent continuity. A fresh subagent every round produces procedural anomalies (work that looks "already done" because nobody remembers who did it) and recurring context re-derivation cost.
- **On a resumed round, the delegation prompt is a follow-up message, not a fresh delegation.** The subagent has its full prior transcript. Use the `Resume mode` section of the templates: skip persona/spec/plan re-pointers; restate only round-specific context (round identifier, new findings, validation gates, decisions standing).
- **Fresh subagent fallback**: when a prior subagent ID is no longer accessible (resume fails), spawn fresh, append the new ID under § Subagent IDs with a swap note recording when and why, and continue.
- **Implementer flags > silent descope.** If the implementer surfaces a deferral request, treat it as a hard pause; do not delegate review with the deferral unaddressed.
- **Reviewer is read-only on code, tests, and planning artifacts.** Reviewer can only modify files under `reviews/`. If a reviewer attempts to amend `plan.md` or `spec.md`, treat that as a delegation-protocol failure and re-delegate.
- **Side-quests get explicit framing + their own commit.** Out-of-scope fixes (e.g. fixing a pre-existing flake the user requests during the loop) commit separately with a scope-note in the commit message; the implementer should never bundle them with phase work.
- **All three review artifacts produced or refreshed every round, no exceptions.** `code-review.md`, `system-design-review.md`, and `walkthrough.md` all update on every round (see § The artifact contract). The walkthrough is the user's primary per-round review surface; missing it breaks their ability to review the round. If the reviewer returns without all three reflecting HEAD, re-prompt with a refresh-only delegation before accepting the verdict.
- **Findings are work for the implementer's next round.** Every entry in `code-review.md` § Findings log is a concrete action the implementer addresses before the phase reaches `SATISFIED`. All severities (`must-fix`, `should-fix`, `low / process`) block phase close — severity is for within-round prioritization, not for letting items carry forward. "Consider for future," "out of scope," or "no action" findings are noise; surface plan amendments to the orchestrator instead so they land in `plan.md` (§ Open items, future phase task list, or a follow-up ticket) before the next implementer delegation. See § Findings discipline.
- **Validation gates must include cross-package tests when the phase deletes or renames public exports.** A package-scoped gate alone misses consumer surfaces; always add `pnpm test:integration` (or the project's equivalent) plus `rg <deleted-or-renamed-symbol> test/ examples/` for phases that touch public exports.
- **Honest implementer pushback is valuable.** When the implementer presents evidence that contradicts a reviewer finding (file paths, diffs, prior commits), the orchestrator should update the reviewer's record rather than insist the implementer comply.
- **Validate every reviewer verdict against intent before triaging.** The reviewer's verdict is authoritative on artifact-match; intent fidelity is yours alone (see § Loop algorithm step 7). Skipping this step lets reviewer drift imprint into subsequent rounds, which is expensive to roll back. When intent-validation surfaces drift, prefer re-prompting the reviewer over silently absorbing the gap; verdict overrides are rare and must be visibly recorded in `code-review.md`.
- **User decisions translate to plan/spec edits before re-delegating.** Any decision that affects future rounds belongs on disk, not in the orchestrator's working memory.
- **Track deferred items in `plan.md § Open items`**, not in conversation. The plan is the durable surface — until close-out. At close-out, items in `plan.md § Open items` must migrate to a durable post-close-out home (ADR § Open questions, package README § Known limitations, or a follow-up Linear ticket) before the plan is deleted; see § Project close-out checkpoint.
- **Run the close-out checkpoint before authorizing the project-dir delete.** § Project close-out checkpoint is not optional. Two steps: (1) audit that every load-bearing decision in the rolling review artifacts has a durable home in the repo (ADR / subsystem doc / README / follow-up ticket); (2) delegate `drive-pr-local-review` for a branch-scoped final-state review (spawn fresh; do not resume the iterate-loop reviewer; output to `wip/<project>-close-out-review/`). Both steps must pass before the implementer's close-out tasks (migrate / strip / delete) are authorized.
- **When operating unattended, log every otherwise-escalated decision.** The user has handed off interactivity in exchange for a written audit trail (see § Unattended mode). Each in-place decision goes in `wip/unattended-decisions.md` using the template at `./templates/unattended-decisions.template.md`. Entries must be self-contained: a reader who has not seen the round-by-round detail and cannot consult the (likely-deleted) review artifacts must still be able to understand the decision, evaluate its reasoning, and verify it on disk.

## Project close-out checkpoint

Before invoking the project's final close-out steps (migrating long-lived content into `docs/`, stripping repo-wide references to `projects/<project>/**`, deleting `projects/<project>/`), the orchestrator runs a **mandatory close-out checkpoint**. The checkpoint has three parts; all three must pass before the close-out tasks may proceed.

### Why a checkpoint exists

The rolling review artifacts maintained during the loop (`reviews/code-review.md`, `reviews/system-design-review.md`, `reviews/walkthrough.md`) live under `projects/<project>/reviews/` and are gitignored. The close-out commit deletes the project directory, which sweeps the rolling artifacts along with it. Two failure modes are possible if the orchestrator does not pause before the delete:

1. **Lost institutional memory.** Decisions captured only in the rolling artifacts (round notes, severity calibrations, finding-closure narratives, design rationales) disappear with the directory. The ADR + subsystem doc + READMEs absorb the *durable* content during M5 / final-milestone work, but anything the close-out milestone forgets to migrate is gone.
2. **Lost final-state review surface.** Per `<skill-dir>/learnings.md § The missing-narrative-artifact pattern`, the walkthrough is the user's primary review surface for the round. The close-out is itself a round; without explicit production of a final walkthrough, the user inherits a PR they cannot review at the round level — only at the cumulative diff level.

The checkpoint addresses both failure modes deliberately rather than hoping the implementer remembers them as part of M5.

### Step 1 — Migration audit of rolling artifacts

Read `reviews/code-review.md`, `reviews/system-design-review.md`, and `reviews/walkthrough.md`. For every load-bearing decision recorded across rounds — design rationale, alternatives-considered, deferred items with destinations, severity calibrations whose reasoning matters — verify the durable home for that decision exists. Concretely:

- Architectural decisions and design-trade-offs → ADR in `docs/architecture docs/adrs/` (extending or referencing prior ADRs as appropriate).
- "How it works today" architectural picture → subsystem doc in `docs/architecture docs/subsystems/`.
- Pack-author / consumer-facing surface → package READMEs.
- Forward-looking work that wasn't completed → ADR § Open questions, package README § Known limitations, or a follow-up Linear ticket. Do not rely on `plan.md § Open items` because the plan is being deleted.
- Severity calibration narratives that explain why the team decided a particular trade-off → either folded into the ADR's Consequences section or noted in the relevant package's `DEVELOPING.md`. Do not assume future maintainers will reconstruct them from the deleted finding logs.

If something load-bearing has no durable home yet, **pause the close-out**. Either: (a) ask the implementer to add it during the close-out round (small additions to ADR or README); or (b) record it in the orchestrator's process notes (`wip/<project>-close-out-notes.md`, gitignored) for the user to triage post-close-out. (a) is preferred whenever the implementer can do it within the close-out scope without ballooning the round.

### Step 2 — Branch-scoped close-out review (mandatory)

Delegate the **`drive-pr-local-review` skill** with explicit branch-scoped framing. This is *not* the same as the iterate-loop reviewer's per-round refresh — it is a fresh, branch-scoped artifact set whose scope is **the entire project branch** (`origin/<base>..HEAD`), not the most recent round.

The branch-scoped close-out review:

- **Spawn fresh.** Do *not* resume the persistent iterate-loop reviewer for this. The iterate-loop reviewer has been carrying round-by-round per-milestone deltas; you want a clean reading of the branch as a whole, not a continuation of the per-round narrative. Spawning fresh forces the reviewer to read the cumulative diff from the project base and produce artifacts whose scope matches what a PR reviewer would see.
- **Run `drive-pr-local-review`.** Pass the explicit base branch (the project's PR base, often the shaping branch or `main`) so the review range is `origin/<base>...HEAD`. The skill produces `system-design-review.md`, `code-review.md`, and `walkthrough.md` (plus `spec.md` if no in-repo canonical spec exists).
- **Output location.** If the project's `spec.md` is still on-branch (close-out hasn't deleted it yet — which is the case if the checkpoint runs before the delete commit, which it should), the skill writes artifacts to the project's `reviews/` directory by its own convention. Override the output path to `wip/<project>-close-out-review/` so the artifacts survive the close-out delete. (`wip/` is gitignored; the artifacts are local-only, but they're the user's audit surface for the project as a whole.)
- **Cross-check against migration audit.** Compare the close-out review's findings against Step 1's migration audit. If the review surfaces a finding whose substance was load-bearing in the rolling artifacts but isn't captured in the durable docs, that's a Step-1 miss; loop back to Step 1 and address.

The close-out review's role is to verify that the *cumulative* branch is review-ready as a whole — the per-round verdicts said "this round's delta is SATISFIED," but they did not collectively assert "the branch as a project is SATISFIED." This step makes that assertion explicit, with fresh eyes.

### Step 3 — Authorize close-out tasks

Once Steps 1 and 2 pass — every load-bearing decision has a durable home, and the branch-scoped close-out review has SATISFIED — the orchestrator authorizes the implementer's close-out tasks (migrate long-lived content, strip repo-wide references, delete `projects/<project>/`). Record the checkpoint outcome in the orchestrator's process notes / unattended decisions log, including the path to the `wip/<project>-close-out-review/` artifacts.

### When the checkpoint fails

If Step 1 or Step 2 surfaces a blocker:

- **Step 1 fails** (load-bearing decision without a durable home): pause the close-out, surface as a small in-PR scope addition (ADR / README extension), then re-run Step 1.
- **Step 2 fails** (branch-scoped review issues a finding): treat as you would any other reviewer finding mid-loop — file it, route to the implementer, address, and re-run Step 2. The close-out delete is gated on Step 2's SATISFIED verdict.

The checkpoint is not optional. Do not delete `projects/<project>/` until both steps have explicitly passed.

## Hand-off points

| From this skill                | To                                | Trigger                                                                 |
|--------------------------------|-----------------------------------|-------------------------------------------------------------------------|
| `drive-create-spec`            | this skill                        | Spec exists; plan is being generated.                                   |
| `drive-generate-plan`          | this skill                        | Plan exists with phases + validation gates; ready to execute.           |
| this skill                     | `commit-as-you-go`                | Implementer needs commit-shaping guidance.                              |
| this skill                     | `drive-pr-local-review`           | (1) Bootstrap: `code-review.md` doesn't yet exist; scaffold via that skill's templates. (2) Close-out checkpoint: produce branch-scoped final-state review artifacts before authorizing the project-dir delete (see § Project close-out checkpoint). |
| this skill                     | `create-pr`                       | All phases SATISFIED; close-out checkpoint passed; branch is review-clean; ready to open PR. |
| this skill                     | `github-review-iteration`         | PR is open and has review comments to address.                          |

## Repo customization hooks

Projects can override the canned templates without forking this skill by placing alternative versions at:

```
<repo>/.agents/skills/drive-orchestrate-plan/templates/<template-name>.md
```

When both project-local and skill-harness templates exist, the orchestrator uses the project-local one. This lets a project encode its own validation-gate vocabulary, commit-message conventions, or AC scoreboard structure without touching the user-level skill.

Suggested project-local overrides:

- `templates/delegate-implement.md` — substitute the project's package-manager + test commands.
- `templates/code-review.template.md` — substitute the project's AC table format.

## Model selection

The implementer and reviewer agent definitions in `./agents/` do not hardcode a model. The orchestrator's default model carries through unless the user or project overrides it. Suggested guidance:

- **Implementer**: a model strong at code generation, tool-using rigor, and validation discipline. The implementer's report is structured and large; a model with good long-context recall helps.
- **Reviewer**: a model strong at independent critical reading, AC tracking, and concise verdict-issuing. The reviewer's job is to push back; lean toward models that resist sycophantic agreement.

If the user specifies different models per agent, pass them through as the `model` parameter when delegating.

**Model + resume interaction.** When resuming a subagent, the `model` parameter is set at first-spawn time and carries through resumed rounds (you cannot change a subagent's model on resume without spawning fresh). If the user requests a model change mid-project, that's a deliberate fresh-spawn under the "pivot of role intent" case in § Subagent continuity — record the swap and the new ID under § Subagent IDs.

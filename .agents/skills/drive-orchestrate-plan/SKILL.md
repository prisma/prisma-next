---
name: drive-orchestrate-plan
description: >
  Use when the user wants to drive a project plan to a review-clean state on the local
  branch via an iterate-implement-review loop. Delegates implementation to a sub-agent
  implementer and independent on-disk assessment to a sub-agent reviewer, looping until
  the reviewer reports SATISFIED on each milestone. Runs after `drive-create-plan` and
  before the team's PR-opening skill.
metadata:
  version: "2026.4.29"
---

# Drive: Orchestrate Plan

Run the local implement-review iteration loop on a project plan: **delegate one round of implementation → delegate one round of review → triage verdict → loop / escalate / proceed** until the reviewer reports `SATISFIED` on each milestone of the PR.

This skill is an **orchestrator**. It delegates:

- implementation to `./agents/implementer.md`
- review to `./agents/reviewer.md`

The orchestrator owns sequencing, escalation, plan/spec amendment in response to user decisions, and loop control. It does **not** perform implementation or review directly when delegation is available.

## When to use

**Use this skill when:**

- A `projects/{project}/spec.md` and `projects/{project}/plans/plan.md` already exist (typically produced by `drive-create-spec` and `drive-create-plan`).
- The user wants to drive the plan to a review-clean state on the local branch, before opening a PR.

**Do not use this skill for:**

- Producing the spec or plan — defer to `drive-create-project` / `drive-create-spec` / `drive-create-plan`.
- Addressing PR review comments — defer to your team's PR-comment-handling skill.
- Driving CI failures to green — that is a separate concern with different signals (CI logs, not spec ACs).

## Pre-conditions

- `projects/{project}/spec.md` exists and is current.
- `projects/{project}/plans/plan.md` exists and is broken into milestones (see `drive-create-plan`).
- The plan's milestones name explicit validation gates (test/lint/typecheck/build commands the harness should run before declaring a milestone done). If the plan does not yet declare them, the orchestrator infers them on first invocation; see § Validation gates.
- The orchestrator (you, the calling agent) has the user's approval to delegate work to sub-agents.

## Post-conditions

- Each milestone identified by the plan has reached `SATISFIED` per the reviewer's verdict in `projects/{project}/reviews/code-review.md`.
- The acceptance-criteria scoreboard in `code-review.md` records every spec AC as PASS, accepted-deferral, or out-of-scope.
- `system-design-review.md` and `walkthrough.md` reflect the as-built state at HEAD (refreshed by the reviewer every round; see § The artifact contract).
- The branch is ready for the team's PR-opening skill.

## Locating sibling artifacts

Path conventions are relative to this skill directory:

- `./agents/implementer.md` — implementer persona/protocol.
- `./agents/reviewer.md` — reviewer persona/protocol.
- `./templates/code-review.template.md` — initial scaffold for `reviews/code-review.md`.
- `./templates/delegate-implement.md` — canned implementer delegation prompt skeleton.
- `./templates/delegate-review.md` — canned reviewer delegation prompt skeleton.
- `./templates/unattended-decisions.template.md` — scaffold + entry format for the unattended-mode decisions log (see § Unattended mode).

Patterns surfaced during prior runs of this skill in the consuming repo are recorded under `projects/{project}/learnings.md` and migrated to durable docs at close-out — see § Project learnings.

Upstream sibling skills (different directory):

- `drive-create-project`, `drive-create-spec`, `drive-create-plan` produce this skill's inputs.
- `commit-as-you-go` for commit-shaping guidance during the implementation rounds.
- `drive-pr-local-review` if the project lacks a `code-review.md` and you want one bootstrapped before iteration begins.

Downstream sibling skills:

- The team's PR-opening skill (e.g. `drive-pr-description` for the PR body, plus whichever skill handles `git push` + PR creation in your harness) once the loop is SATISFIED across all milestones.
- The team's PR-comment-handling skill, if any, after the PR is open.

## Subcommands

```text
/drive-orchestrate-plan iterate [milestone-id]
/drive-orchestrate-plan implement [milestone-id]
/drive-orchestrate-plan review
```

- **`iterate`** (default): full loop on the named milestone (or the next pending milestone if omitted) until SATISFIED.
- **`implement`**: delegate one round of implementation only. Useful for stepping through manually.
- **`review`**: delegate one round of review only. Useful for auditing current state without changing code.

`{milestone-id}` corresponds to a milestone identifier in `plan.md` (e.g. `m1`, `m3`).

## The three personas

### Orchestrator (you, the calling agent)

Holds the strategic context: spec intent, plan structure, AC scoreboard, decision history, user preferences. Does **not** write code or independently assess correctness — synthesizes implementer and reviewer outputs instead.

The orchestrator is also responsible for **subagent continuity**: tracking the implementer and reviewer subagent IDs and resuming them across rounds rather than spawning fresh ones (see § Subagent continuity).

**Epistemic frame.** You are the only role with project-level intent visibility. The implementer reasons forward from artifacts (plan tasks → diff); the reviewer reasons forward from artifacts (spec ACs → implementation match); only you reason forward from *intent* — the conversation history that produced the spec, the user's explicit preferences, the strategic shape of the project across milestones. Both sub-agents structurally lack this context, no matter how good their prompts: the spec and plan are checklist artifacts, but the conversation that produced them is not durable in the artifact trail. This asymmetry is load-bearing. Applying the intent frame at every checkpoint — especially when triaging reviewer verdicts — is your unique contribution to loop quality, and the only protection against architectural drift hardening through iteration.

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

Tactical executor. Plan-driven, validation-rigorous, honest about surprises. **One implementer per project** by default — the same subagent ID is resumed across rounds and across milestones (see § Subagent continuity).

### Reviewer (sub-agent at `./agents/reviewer.md`)

Independent on-disk assessor. AC-driven, severity-aware, read-only constraint on non-review artifacts. **One reviewer per project** by default — the same subagent ID is resumed across rounds and across milestones (see § Subagent continuity).

## Subagent continuity

**Default:** one implementer subagent and one reviewer subagent per project. The orchestrator resumes the same subagent IDs across every round and every milestone, rather than spawning fresh subagents each time.

The mechanic depends on your agent harness. Examples:

- **Cursor's `Task` tool** exposes a `resume` parameter — passing the agent ID returned by a prior `Task` invocation sends the new prompt as a follow-up message to that subagent, preserving its full transcript.
- **Claude Code's task system** exposes equivalent resume semantics on its `Task` tool.
- Other harnesses (codex, etc.) may not expose subagent resumption directly; in that case, run the loop with a single long-lived implementer chat and a single long-lived reviewer chat that the orchestrator drives turn-by-turn.

What matters is the principle: the same chat / transcript / subagent context is fed each new round of work, not a fresh blank-slate one. Without this, every round starts fresh and the subagent loses everything it learned in prior rounds.

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

Spawning fresh because "the new round is a different milestone" is **not** a legitimate reason. Milestone transitions don't reset the project's intent; the persistent subagents carry their understanding of the project across milestones, which is the point.

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

This continuity rule applies to the **implementer and reviewer**, who participate in iteration. One-shot subagents (e.g. a PR-opening subagent at the end of the project, a fresh-eyes reviewer asked for a one-time PR-body rewrite) do not need to be resumed across multiple invocations — they are spawned, do their job, and are not re-used.

## The artifact contract

The on-disk artifacts that decouple the three agents:

```text
projects/{project}/
├── spec.md                          # intent, decisions, ACs (drive-create-spec)
├── plans/
│   └── plan.md                      # tasks, milestones, validation gates (drive-create-plan)
├── reviews/
│   ├── code-review.md               # scoreboard + subagent IDs + F-numbered findings (reviewer-maintained)
│   ├── system-design-review.md      # architectural review (reviewer-refreshed every round)
│   └── walkthrough.md               # semantic narrative (reviewer-refreshed every round)
└── learnings.md                     # patterns surfaced this run (orchestrator-maintained; see § Project learnings)

wip/heartbeats/                      # transient subagent liveness signals (gitignored; one file per role)
├── implementer.txt                  # implementer's current step + last-progress + next-step (overwritten each ping)
└── reviewer.txt                     # reviewer's current step + last-progress + next-step (overwritten each ping)
```

The `projects/{project}/` artifacts are durable round-by-round outputs; the `wip/heartbeats/` files are ephemeral liveness pings (see § Heartbeats). Both flow through the orchestrator's awareness, but only the former survive to PR-review time.

`code-review.md` carries a § Subagent IDs section directly under the AC scoreboard recording the persistent implementer + reviewer IDs (see § Subagent continuity). The orchestrator owns this section under the write carve-out documented in the read/write matrix below; the reviewer treats it as read-only.

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

## Heartbeats

Long-running subagent rounds occasionally hang — the model stalls inside a long shell call, gets stuck in a tool-call loop, or simply stops emitting tokens for reasons opaque to the orchestrator. Without a forward signal, the orchestrator cannot tell hung from working from "still legitimately churning on a slow gate". The user is left to notice and intervene manually — and by then minutes have been wasted.

The fix is small: every long-running subagent writes a **heartbeat file** on a fixed cadence. The orchestrator can consult it between turns to spot a stalled subagent without polling.

### Heartbeat file shape

Each persistent subagent owns one heartbeat file:

- **Implementer:** `wip/heartbeats/implementer.txt`
- **Reviewer:** `wip/heartbeats/reviewer.txt`

Path is under `wip/` so it is gitignored (the file is a transient operational signal, not a shipped artifact). One file per role; rewritten in place each ping.

Each ping overwrites the file with a self-contained snapshot:

```text
ts: <ISO 8601 UTC timestamp>
role: <implementer|reviewer>
agent_id: <subagent ID>
round: <milestone + round identifier, e.g. m3 R2>
phase: <step the subagent is currently in, e.g. "running pnpm test:packages" / "resolving rebase conflict in decoding.ts" / "writing F4 finding">
last_progress: <last concrete action with citation, e.g. "committed cd5ae1afe" / "edited packages/2-sql/5-runtime/src/codecs/encoding.ts:8" / "ran pnpm typecheck (124/124 pass)">
next_step: <expected next concrete action, e.g. "run pnpm test:packages" / "stage + commit T3.5" / "write code-review.md F-numbered findings">
expected_duration: <coarse estimate, e.g. "~30s" / "~5min" / "long-running test suite, ~10min">
```

The format is plain `key: value` per line — no JSON, no nested structure — so a quick `head` from the orchestrator's terminal reads the snapshot in one glance.

### Heartbeat cadence

Subagents update the file at every one of these triggers:

1. **At the start of the round**, before doing any other work (so the orchestrator can immediately see who is running).
2. **Before each long-running shell call.** The "long-running" bar is anything expected to take more than ~1 minute: `pnpm install`, `pnpm test:*`, `pnpm build`, `pnpm typecheck` cold-cache, large `git rebase`, etc. The heartbeat says what the call is, why it's long, and the expected duration so the orchestrator knows when to start worrying.
3. **After each long-running shell call returns**, recording the result (pass / fail / which test failed). This closes the loop — the next ping shows the orchestrator that the long call completed and progress continues.
4. **At each task / finding / commit boundary.** The implementer pings on commit; the reviewer pings on each F-number filed and on each artifact written.
5. **At least every ~5 minutes during any other work.** Even when no shell-call boundary triggers a ping, the subagent should not go more than 5 min without one — if it has been thinking about the same finding or the same edit for 5 min, it pings to record its current hypothesis and what it's about to try.

The cadence rule is **at least every 5 minutes**; subagents may ping more often, especially around transitions. A ping is cheap — one file write — and the redundant ones cost nothing.

### Reading heartbeats from the orchestrator side

Between turns (or whenever uncertainty surfaces), the orchestrator can:

```bash
head -n 10 wip/heartbeats/*.txt
```

to see the freshness and current step of each persistent subagent. Two cases of interest:

- **Stale heartbeat (`ts` more than ~10 min old)**: the subagent has likely hung. Surface to the user with the last `phase` / `last_progress` / `next_step` so the user can decide whether to wait, kill, or intervene. Do not silently kill — a slow legitimate gate (e.g. cold-cache `pnpm test:e2e` against real Postgres) can take longer than the heartbeat cadence and is the subagent's responsibility to flag with `expected_duration`.
- **Fresh heartbeat but `phase` unchanged across multiple checks**: the subagent is making no real progress despite emitting heartbeats — likely stuck in a tight loop. Same surface-to-user pattern applies; the `phase` and `last_progress` together tell you whether it's repeatedly attempting the same action.

The orchestrator never modifies heartbeat files. They are subagent-owned; the orchestrator is read-only.

### Read/write matrix update

| Artifact                          | Orchestrator | Implementer    | Reviewer       |
|-----------------------------------|--------------|----------------|----------------|
| `wip/heartbeats/implementer.txt`  | R            | RW             | —              |
| `wip/heartbeats/reviewer.txt`     | R            | —              | RW             |

### Why files, not transcript-emitted status lines

A heartbeat in the subagent's own response message is invisible to the orchestrator until the subagent's `Task` call returns. By the time you can read it, the round is already over — the heartbeat exists only retrospectively. A file-based heartbeat is the opposite: written mid-round, readable by the orchestrator at any moment without waiting for the subagent's reply.

## Findings discipline

`code-review.md` § Findings log is a **work backlog for the implementer's next round**, not a journal of observations. Every entry is something the implementer must address before the milestone reaches `SATISFIED` — across all severities. No severity lets a finding carry across milestones within the same PR.

This is the most important way `drive-orchestrate-plan` differs from `drive-pr-local-review`:

- `drive-pr-local-review` is a **one-shot** branch review. Out-of-scope observations and "consider this for the future" notes are legitimate output — they go in a `Deferred` section, the reader can act on them or not.
- `drive-orchestrate-plan` operates inside an **iterate-implement loop**. Every finding the reviewer files reaches the implementer as part of the next delegation. Findings that recommend "no action," "defer to a future milestone," or "consider in the future" produce **noise**, dilute the implementer's attention, and obscure the real action items.

**The bar for filing a finding:** the recommended action must be **addressable by the implementer in the current PR**, in either the current milestone or an explicitly named later milestone of this PR. If the recommended action is genuinely "no change in this PR," the observation is not a finding:

- If it warrants action in a future milestone of this PR → orchestrator adds a task to that milestone's task list in `plan.md`. Not a finding.
- If it warrants action in a future PR / project → orchestrator records in `plan.md § Open items` or files a follow-up ticket. Not a finding.
- If it's narrative context that helps the reviewer's verdict make sense → goes in the round's narrative notes. Not a finding.
- If it's none of the above → it's noise, drop it.

The reviewer surfaces candidates that warrant a plan amendment to the orchestrator, who decides where they land before the next implementer round runs. The implementer should never see "you have nothing to do here" findings in their delegation prompt.

Severity guidance — all severities block milestone `SATISFIED`. Severity is for **within-round prioritization**, not for deciding which findings can carry forward.

- **must-fix**: correctness-class. AC violation, regression, broken validation gate. The implementer addresses these first in the next round.
- **should-fix**: code-quality / consistency / convention concerns the implementer addresses alongside must-fix items.
- **low / process**: in-scope process or hygiene improvements (e.g. "this cast lacks the comment AGENTS.md requires"; "this test name doesn't match the convention in this package"). Still actionable, still addressed in the next round. Not a forward-looking note.

There is no "informational" tier. If you would file something with a non-actionable recommendation, do not file it.

**Milestone `SATISFIED` requires the findings log to be empty of opens** — no severity carries past milestone close. If a finding is genuinely too small to address in this milestone but real enough to track, it's not a finding; it's either a plan amendment (orchestrator records it) or noise (drop it).

## Validation gates

Each milestone in `plan.md` should declare a **validation gate**: the explicit set of harness commands that must all pass before the milestone is considered done. The implementer runs the gate on their last round; the reviewer re-runs (or trusts) the gate as part of issuing `SATISFIED`. If the plan does not yet declare validation gates per milestone, the orchestrator infers them on first invocation.

**Inferring a gate.** Read the plan's Test Design (and any explicit testing infrastructure references), inspect the project's harness (the package manager + test/lint/typecheck/build scripts), and propose a gate with at minimum:

- Typecheck command (e.g. the project's typecheck script).
- Test command(s) covering the milestone's surface — package-scoped at minimum, plus a workspace-wide / cross-package test command if the milestone deletes or renames a public export (see below).
- Lint command, if the project has one and the milestone touches lint-relevant surfaces.
- Build command, if the milestone changes anything that could break the build.

Surface the inferred gate to the user for confirmation, then write it back into the milestone definition in `plan.md` so subsequent rounds and milestones inherit it. Inferred-without-confirmation gates are a foot-gun: the user often has tacit harness knowledge that doesn't surface until you propose a wrong gate.

**Unattended fallback.** When operating in unattended mode (see § Unattended mode), no user is available to confirm the gate. Pick the most defensible gate from the project's harness (typecheck + the closest test/lint/build commands the milestone touches), validate it by running it once before delegating implementation, then write the chosen gate back into the milestone definition in `plan.md` so subsequent rounds inherit it. Log the choice and the validation result as an unattended decision so the user can audit on return; if the validation fails, that is a stop condition (see § Stop conditions) and the gate is not adopted.

**Cross-package gates.** When a milestone deletes or renames a public export, a package-scoped test gate alone misses consumer surfaces. Always extend the gate with the project's workspace-wide test command and a grep for the deleted-or-renamed symbol across consumer directories (e.g. `test/`, `examples/`, sibling packages). This guards against the recurring class of escapees where a deletion compiles cleanly inside the owning package but breaks an integration test elsewhere.

**Gate failures.** A gate failure is a hard pause: the implementer surfaces it; the orchestrator decides whether the failure is in-scope (regression to fix) or pre-existing fragility (escalate to the user). Gates are never declared green by skipping commands; if a command can't run, that's a gate amendment, not a pass.

## The loop algorithm

For each milestone in `plan.md` (or the single milestone named in `iterate <milestone-id>`):

1. **Pre-flight.** Confirm `code-review.md` exists; if not, scaffold it from `./templates/code-review.template.md` so the AC scoreboard exists from round 1. Read `code-review.md § Subagent IDs` to recover the persistent implementer/reviewer IDs from prior rounds; if absent (project's first round, or a fresh chat session inheriting the project), note that this round will spawn fresh and record the IDs. Confirm the milestone declares a validation gate; if not, infer it per § Validation gates and confirm with the user before delegating.
2. **Delegate implementation** using `./templates/delegate-implement.md`, pre-filled with the milestone scope, prior-round context (if R2+), and validation gates from the plan. **Resume the persistent implementer subagent** using your harness's resume mechanism, except on the first round of the project where you spawn fresh and record the new ID in `code-review.md` (see § Subagent continuity).
3. **Receive implementer report.** Expect: diff highlights, validation results, flagged items, deferral requests, anything surprising.
4. **If implementer returns deferral requests**: surface to the user as a structured decision (see § Escalation surface). Do not re-delegate until the user has decided.
5. **Delegate review** using `./templates/delegate-review.md`, passing pointers to recent commits and the implementer's report. **Resume the persistent reviewer subagent** using your harness's resume mechanism, except on the first round of the project where you spawn fresh and record the new ID (see § Subagent continuity).
6. **Receive reviewer verdict.** One of `SATISFIED`, `ANOTHER ROUND NEEDED`, `ESCALATING TO USER`.
7. **Validate the review against intent.** Required step. The reviewer reasons forward from artifacts; you reason forward from intent (see § The three personas → Orchestrator → Epistemic frame). Read the verdict, the AC scoreboard delta, the new findings (and their severities), and any narrative artifacts the reviewer refreshed (`system-design-review.md`, `walkthrough.md`). Apply your project-level context to four questions:

   - **Does this verdict reflect intent, not just artifact-match?** A `SATISFIED` verdict on a spec that misses a subtle decision is still wrong.
   - **Did the reviewer let any architectural choice through that I should question?** The reviewer's role discipline is to validate against the spec; the orchestrator's role *is* to second-guess design when intent demands it.
   - **Are finding severities calibrated correctly given cross-milestone context?** A reviewer-flagged `low` may be `should-fix` once you account for downstream milestones; vice versa.
   - **Is anything missing that I'd expect to be flagged given intent context?** This is the hardest question and the highest-value one — answer it by applying the strategic shape the reviewer cannot see.

   This is a 2-minute skim, not a re-review of the diff. You are *applying* the intent frame to the reviewer's output, not re-doing the reviewer's job. Possible actions, choose by judgment:

   - **Pass-through** (most common): the reviewer's output reflects intent. Proceed to step 8.
   - **Re-prompt the reviewer** with a focused gap ("you said `SATISFIED` but missed X; revisit"). Preserves the reviewer's role and avoids the orchestrator becoming the de facto reviewer.
   - **Override a verdict** (rare): demote `SATISFIED` to `ANOTHER ROUND NEEDED` with rationale, recorded under an `## Orchestrator notes` section in `code-review.md`. Frequent overrides mean the reviewer is mis-calibrated — that's a separate problem worth raising with the user.
   - **Refine spec/plan**: intent-validation occasionally reveals the spec is wrong, not the implementation. Treat as a replan trigger (see § Replan protocol).

   Any action other than pass-through must be **visibly recorded** — in `code-review.md`, in the next delegation prompt, or both. Invisible orchestrator-only edits to the verdict break the artifact contract.

8. **Triage verdict** (post intent-validation):
   - `SATISFIED` → report milestone completion to the user, recommend the next milestone or transition to PR.
   - `ANOTHER ROUND NEEDED` → re-prompt implementer with the reviewer's findings; loop to step 2.
   - `ESCALATING TO USER` → surface the reviewer's concerns as a structured decision.
9. **Confirm narrative-artifact refresh.** After `SATISFIED` on a milestone, verify that `system-design-review.md` and `walkthrough.md` reflect the as-built state at HEAD. The reviewer is required to refresh both every round (see § The artifact contract); your job here is to confirm — open both, scan for round-N content, fail loudly if either is missing or outdated. If the reviewer skipped the refresh, that's a delegation-protocol failure: re-prompt the reviewer with a refresh-only delegation; do not accept the milestone as `SATISFIED` until both reflect HEAD.

## Escalation surface

When the reviewer or implementer surfaces items requiring user decision, the orchestrator presents them in a uniform shape:

```markdown
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

- A finding invalidates a milestone's design (architectural mistake surfaced mid-loop).
- A deferral expands scope beyond what the current PR can defensibly carry.
- A reviewer-promoted "should fix" item demands new tasks the plan doesn't cover.
- The user adds scope mid-loop ("let's also rename X while we're here").

Triggered replan steps:

1. Orchestrator pauses the loop and surfaces the replan trigger to the user as a structured decision (see § Escalation surface).
2. User decides scope: `accept-and-add-tasks` / `file-as-follow-up-ticket` / `accept-as-out-of-scope` / `restructure-the-plan`.
3. Orchestrator translates the decision into plan/spec edits **before** re-delegating downstream:
   - `accept-and-add-tasks` → new tasks under the appropriate milestone, validation-gate amendments where needed.
   - `file-as-follow-up-ticket` → a new ticket in the team's tracker (e.g. Linear) with cross-link from `spec.md § Out of scope`.
   - `accept-as-out-of-scope` → an entry in `plan.md § Open items` with rationale.
   - `restructure-the-plan` → a delta-plan; consider invoking `drive-create-plan` for a fresh take rather than open-heart-surgery on the current plan.
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

Acknowledge the mode shift in the first response after the trigger ("Operating in unattended mode; decisions will be logged to `<scratch>/unattended-decisions.md`."). Continue until the work is complete or a stop condition fires.

### Operating rules under unattended mode

These tighten the orchestrator's defaults when no user is on-hand to course-correct:

- **Conservative scope.** No work outside the scope already approved in `spec.md` / `plan.md`. New scope = stop, file as out-of-scope, recommend follow-up ticket. If a finding implies scope expansion, log the decision and decline to act on it.
- **Defensible choices over novel architecture.** When two equally valid options exist, pick the one closer to existing repo conventions. Log the alternatives.
- **Pre-existing flakes / unrelated failures.** If a non-milestone failure surfaces, log it. Fix only if it blocks a validation gate; otherwise leave for the user.
- **Reviewer drift.** Every intent-validation override (per § Loop algorithm step 7) is logged in addition to the visible record in `code-review.md § Orchestrator notes`.
- **Avoid `--no-verify`.** Never skip pre-commit hooks under any circumstance, including amends.
- **Keep the branch local.** Don't push beyond what the loop normally does; PR opening is a separate skill and is invoked only if the user explicitly named it as part of the unattended scope.
- **Decline third-party automation expansions.** Don't authorize automated agents (e.g. a PR-comment bot's "shall I open a tracking issue?") to create artifacts in the team's trackers without human approval. Decline politely; log the decline.

### Stop conditions

Halt and leave the branch in a recoverable state if any of these surface:

- A validation gate cannot be made green within the in-scope work.
- The implementer surfaces a blocker that cannot be defensibly resolved without an architectural decision.
- The spec/plan turn out to be wrong in a way you cannot correct from intent alone.
- The user's prior decisions are mutually inconsistent in a way that requires their input to resolve.
- A scope expansion is required to complete the work as specified (rather than as a separable concern).

When stopping, write a stop entry in the decisions log with the trigger and the recoverable state at HEAD.

### The decisions log

**Location.** A gitignored scratch file under the repo's scratch convention (e.g. `wip/unattended-decisions.md`, or whatever local gitignored directory the repo uses for transient work). The file **must be gitignored** — it is the user's personal review surface, not a shipped artifact. Confirm the location with the user when entering unattended mode if the convention isn't already established. When no user is available to confirm (the unattended-mode case itself), default to the repo's most-conventional gitignored scratch path — typically `wip/unattended-decisions.md` if `wip/` is gitignored, otherwise the first gitignored scratch directory the repo declares — verify the path is gitignored before writing, and log the chosen path as the first decision in the file so the user can audit and relocate it later if needed.

**Lifecycle.**
- On entering unattended mode, scaffold the file from `./templates/unattended-decisions.template.md` (preamble + operating rules + entry format reference) if it doesn't already exist.
- Append an entry every time you decide something that would have been escalated under normal operation. This includes: triage decisions in place of the user; declining out-of-scope findings; verdict overrides; accepted side-quests; declined offers from automated agents; deferring pre-existing failures.
- Append a stop entry if a stop condition fires.

**Append-only and chronological.** Do not reorder entries or backfill. The log is read by a human after the fact who needs an audit trail; out-of-order entries break that.

### Entry format — readability is load-bearing

The user reading this log on return is **not in your context**: review artifacts may be deleted by close-out, finding IDs and round labels are meaningless without their source documents, and the user has not been tracking the loop in real time. The format must absorb that asymmetry.

Concrete rules:

- **Do not refer to findings by ID** (`F17`, `F18`, `A02a`). Translate the substance into plain language: *"a doc comment in `cli.ts` cross-referenced the project's `spec.md`, which would become a dead link after close-out deleted the project folder"*.
- **Do not lead with round labels as the trigger** (`Milestone 5 R2 triage`). Reference rounds only as date-equivalents for ordering, never as the substance of why a decision came up.
- **Do not assume the reader can read other artifacts.** `code-review.md`, per-PR action JSON, and inflight delegation prompts are likely deleted, stale, or simply not where the user is looking by the time they audit. Restate any context the entry depends on.
- **Lead with what was decided, then explain the why.** The reader is auditing — they want to know what was done first, then evaluate the reasoning.
- **Make verification concrete.** Every entry includes a *How to verify* section with a specific check the user can run without further context: a file to read, a symbol to grep, a commit SHA to inspect, a behavior to observe.

The four questions an entry must answer (the user has explicitly named these):

1. **What decision was made?** — concrete, in plain language.
2. **Why was it flagged to begin with?** — what surfaced it; what the actual concern was.
3. **Why is it important?** — the impact if the wrong choice was made.
4. **How can I verify it?** — what to check on disk to confirm the choice was sound.

The full entry template (with `Context` / `The concern` / `Options I considered` / `My choice` / `Why` / `How to verify` / `How to undo if wrong` / `Affected`) lives in `./templates/unattended-decisions.template.md`. Use it directly.

### Returning to interactive mode

When the user re-engages, hand them the log explicitly: list the decision titles inline, surface anything you flagged as needing their attention, and confirm whether any deferred items still need a destination (tracker ticket, plan amendment, follow-up PR). Do not assume they've read the log — the listing is the handoff.

## Project learnings

The orchestrator maintains a per-project `projects/{project}/learnings.md` recording patterns surfaced during this run — foot-guns, escapees, severity calibrations the user weighed in on, classes-of-bug the spec didn't cover. Treat it as a working ledger, not a shipped artifact.

**Why per-project rather than per-skill.** The patterns that surface during a run are partly project-shaped (this codebase's idioms, this team's PR conventions, this validation harness's quirks) and partly cross-cutting. Keeping the file in the project folder makes the lessons available to every round of the loop while the project is live, then forces a deliberate close-out decision: which lessons are project-local (drop with the project folder) and which deserve to migrate into durable docs.

**Lifecycle.**

- **During the run**: the orchestrator appends a pattern entry whenever a non-trivial calibration is made (a foot-gun the user pointed out, a severity recalibration that should propagate, a structural finding that turned into a plan amendment).
- **At close-out** (per `drive-close-project`): the orchestrator + user review the learnings file together. Lessons that are durable cross-cutting knowledge migrate to the consuming repo's docs (e.g. an ADR, a team-level engineering doc, or a `prisma/ignite` doc — wherever the team keeps cross-cutting standards). Project-local lessons are dropped with the rest of the project folder.

**Entry shape (recommended).**

```markdown
### <Pattern title>

**Shape.** <What surfaces this; observable signals.>

**Why it matters.** <Failure mode if missed; impact on the loop.>

**Action.** <What the orchestrator (or implementer / reviewer) does when they see it.>
```

Keep entries terse. The point is to compress a calibration into a recognizable shape, not to write a treatise.

## Behavioral rules

These are the cross-cutting invariants the orchestrator is responsible for enforcing across every loop iteration.

- **Resume the persistent implementer and reviewer across rounds.** One implementer ID and one reviewer ID per project, recorded in `code-review.md § Subagent IDs`. Resume via your harness's resume mechanism on every round after the first; spawn fresh only in the cases enumerated in § Subagent continuity. A fresh subagent every round produces procedural anomalies (work that looks "already done" because nobody remembers who did it) and recurring context re-derivation cost.
- **Subagents heartbeat; orchestrator consults heartbeats when uncertainty surfaces.** Every implementer and reviewer round writes to `wip/heartbeats/<role>.txt` at the cadence in § Heartbeats (start of round, before/after long shell calls, at task/finding/commit boundaries, at least every ~5 min). When the orchestrator suspects a subagent has hung, or whenever a round runs visibly longer than expected, run `head -n 10 wip/heartbeats/*.txt` and read the snapshots before deciding to wait, kill, or intervene. Stale (`ts` > ~10 min old) or unchanged-`phase`-across-checks heartbeats are the canonical "subagent stuck" signal. Surface the snapshot to the user rather than silently killing — a slow legitimate gate is the subagent's responsibility to flag via `expected_duration`, and overruling that without seeing the snapshot is a foot-gun.
- **On a resumed round, the delegation prompt is a follow-up message, not a fresh delegation.** The subagent has its full prior transcript. Use the `Resume mode` section of the templates: skip persona/spec/plan re-pointers; restate only round-specific context (round identifier, new findings, validation gates, decisions standing).
- **Fresh subagent fallback**: when a prior subagent ID is no longer accessible (resume fails), spawn fresh, append the new ID under § Subagent IDs with a swap note recording when and why, and continue.
- **Implementer flags > silent descope.** If the implementer surfaces a deferral request, treat it as a hard pause; do not delegate review with the deferral unaddressed.
- **Reviewer is read-only on code, tests, and planning artifacts.** Reviewer can only modify files under `reviews/`. If a reviewer attempts to amend `plan.md` or `spec.md`, treat that as a delegation-protocol failure and re-delegate.
- **Side-quests get explicit framing + their own commit.** Out-of-scope fixes (e.g. fixing a pre-existing flake the user requests during the loop) commit separately with a scope-note in the commit message; the implementer should never bundle them with milestone work.
- **All three review artifacts produced or refreshed every round, no exceptions.** `code-review.md`, `system-design-review.md`, and `walkthrough.md` all update on every round (see § The artifact contract). The walkthrough is the user's primary per-round review surface; missing it breaks their ability to review the round. If the reviewer returns without all three reflecting HEAD, re-prompt with a refresh-only delegation before accepting the verdict.
- **Findings are work for the implementer's next round.** Every entry in `code-review.md` § Findings log is a concrete action the implementer addresses before the milestone reaches `SATISFIED`. All severities (`must-fix`, `should-fix`, `low / process`) block milestone close — severity is for within-round prioritization, not for letting items carry forward. "Consider for future," "out of scope," or "no action" findings are noise; surface plan amendments to the orchestrator instead so they land in `plan.md` (§ Open items, future milestone task list, or a follow-up ticket) before the next implementer delegation. See § Findings discipline.
- **Validation gates must include cross-package tests when the milestone deletes or renames public exports.** A package-scoped gate alone misses consumer surfaces; always extend the gate with the project's workspace-wide test command and a grep for the deleted-or-renamed symbol across consumer directories. See § Validation gates.
- **Honest implementer pushback is valuable.** When the implementer presents evidence that contradicts a reviewer finding (file paths, diffs, prior commits), the orchestrator should update the reviewer's record rather than insist the implementer comply.
- **Validate every reviewer verdict against intent before triaging.** The reviewer's verdict is authoritative on artifact-match; intent fidelity is yours alone (see § Loop algorithm step 7). Skipping this step lets reviewer drift imprint into subsequent rounds, which is expensive to roll back. When intent-validation surfaces drift, prefer re-prompting the reviewer over silently absorbing the gap; verdict overrides are rare and must be visibly recorded in `code-review.md`.
- **User decisions translate to plan/spec edits before re-delegating.** Any decision that affects future rounds belongs on disk, not in the orchestrator's working memory.
- **Track deferred items in `plan.md § Open items`**, not in conversation. The plan is the durable surface.
- **When operating unattended, log every otherwise-escalated decision.** The user has handed off interactivity in exchange for a written audit trail (see § Unattended mode). Each in-place decision goes in the unattended-decisions log using the template at `./templates/unattended-decisions.template.md`. Entries must be self-contained: a reader who has not seen the round-by-round detail and cannot consult the (likely-deleted) review artifacts must still be able to understand the decision, evaluate its reasoning, and verify it on disk.

## Hand-off points

| From this skill                | To                                | Trigger                                                                 |
|--------------------------------|-----------------------------------|-------------------------------------------------------------------------|
| `drive-create-spec`            | `drive-create-plan`               | Spec exists; plan is being generated.                                   |
| `drive-create-plan`            | this skill                        | Plan exists with milestones + validation gates; ready to execute.       |
| this skill                     | `commit-as-you-go`                | Implementer needs commit-shaping guidance.                              |
| this skill                     | `drive-pr-local-review`           | `code-review.md` doesn't yet exist; scaffold via that skill's templates.|
| this skill                     | team's PR-opening skill           | All milestones SATISFIED; branch is review-clean; ready to open PR.     |
| this skill                     | team's PR-comment-handling skill  | PR is open and has review comments to address.                          |

## Repo customization hooks

Repos and projects can override the canned templates without forking this skill by placing alternative versions in the consuming repo at the equivalent skill location your harness uses (e.g. `<repo>/.cursor/skills/drive-orchestrate-plan/templates/<template-name>.md`, `<repo>/.claude/skills/drive-orchestrate-plan/templates/<template-name>.md`, etc.). When both project-local and skill-harness templates exist, the orchestrator uses the project-local one. This lets a project encode its own validation-gate vocabulary, commit-message conventions, or AC scoreboard structure without touching the user-level skill.

Suggested project-local overrides:

- `templates/delegate-implement.md` — substitute the project's package-manager + test commands.
- `templates/code-review.template.md` — substitute the project's AC table format.

## Model selection

The implementer and reviewer agent definitions in `./agents/` do not hardcode a model. The orchestrator's default model carries through unless the user or project overrides it. Suggested guidance:

- **Implementer**: a model strong at code generation, tool-using rigor, and validation discipline. The implementer's report is structured and large; a model with good long-context recall helps.
- **Reviewer**: a model strong at independent critical reading, AC tracking, and concise verdict-issuing. The reviewer's job is to push back; lean toward models that resist sycophantic agreement.

If the user specifies different models per agent, pass them through to the harness's delegation mechanism.

**Model + resume interaction.** On most harnesses, a subagent's model is fixed at first-spawn time and cannot be changed on resume without spawning fresh. If the user requests a model change mid-project, that's a deliberate fresh-spawn under the "pivot of role intent" case in § Subagent continuity — record the swap and the new ID under § Subagent IDs.

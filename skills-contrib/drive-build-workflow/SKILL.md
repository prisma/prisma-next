---
name: drive-build-workflow
description: >
  Workflow skill. Pilots the slice implementation loop: per-dispatch DoR →
  delegate dispatch (via drive-dispatch) → WIP inspection → per-dispatch DoD
  with intent-validation → reviewer verdict + intent-validation → loop /
  escalate / next dispatch / close. Use when a slice spec + slice plan exist
  and you want the dispatch loop driven to slice DoD. On slice DoD met,
  auto-push and open the PR. Renamed and augmented from drive-orchestrate-plan.
metadata:
  version: "2026.5.28"
  renamed_from: drive-orchestrate-plan
---

> **Execution mode: orchestrator-direct.** This workflow skill puts you in the
> Orchestrator role (see [`drive/roles/README.md`](../../drive/roles/README.md)).
> Your verbs: **delegate**, **synthesize**, **coordinate**, **decide**, and
> **author** project / slice artifacts directly.
>
> **File-path boundary:** your file writes only land inside
> `projects/<current-project>/`. Writing to `src/`, `tests/`, `docs/`,
> `skills-contrib/`, `drive/`, `.cursor/`, or any other path is the signal that
> the work must be **delegated** to an Executor with the spec as their input
> contract. Reads outside the project directory are fine; writes are not.
>
> **Stop-and-delegate triggers:** if you are about to call `Read` / `Grep` /
> `Glob` on source code, `Shell` for build/test/lint, or `Write` / `StrReplace`
> on a file outside `projects/<current-project>/` — **STOP. Dispatch.** Escape
> hatch (rare, brief, navigational): act directly when no dispatch shape serves
> and the action is one or two tool calls of coordination, not production.
>
> **Adopt the `tech-lead` persona** (see `drive-agent-personas`). This skill
> adds plan-loop-specific mechanics — persistent implementer + reviewer
> subagents, the artifact contract, the loop algorithm, the intent-vs-artifact
> epistemic asymmetry only the orchestrator holds — on top of that generic
> stance.

# Drive: Build Workflow

Pilots the slice's implementation loop. Returns when the slice DoD is met and
the PR is open.

**The loop, per dispatch:**

```text
pre-flight DoR  →  drive-dispatch (assemble brief; delegate implementer)
                       │
                       ▼
                 WIP inspection
                       │
                       ▼
                 post-flight DoD (with intent-validation)
                       │
                       ▼
                 delegate reviewer  →  verdict + intent-validation  →  triage
                                                                         │
                                                                         ├── SATISFIED → next dispatch / slice DoD
                                                                         ├── ANOTHER ROUND → loop
                                                                         └── ESCALATING → operator decision
```

Brief assembly, implementer delegation, and the heartbeat contract are
factored into [`drive-dispatch`](../drive-dispatch/SKILL.md). This skill owns
the *loop* — DoR / WIP / DoD / reviewer / intent-validation / escalation /
slice-DoD-close.

## Three roles

| Role | Who | Persona / definition | Owns |
|---|---|---|---|
| **Orchestrator** | You (this skill) | `tech-lead` from `drive-agent-personas` + this skill's plan-loop specialisations | Sequencing; escalation; spec/plan amendments; intent-validation of reviewer verdicts |
| **Implementer** | Subagent | [`drive-dispatch/agents/implementer.md`](../drive-dispatch/agents/implementer.md) | Code + tests + validation gates |
| **Reviewer** | Subagent | [`./agents/reviewer.md`](./agents/reviewer.md) | `code-review.md` (read-only on code/tests) |

**One implementer and one reviewer per project.** Resume the same subagent IDs across every round and every dispatch — never spawn fresh except on round 1 or when a prior ID becomes inaccessible. Spawning fresh because "this is a different dispatch" is **not** a legitimate reason; the persistent subagents carry their understanding of the project across dispatches, which is the point.

**Epistemic asymmetry the orchestrator alone holds.** The implementer reasons forward from artifacts (plan → diff). The reviewer reasons forward from artifacts (spec ACs → implementation match). Only the orchestrator reasons forward from **intent** — the conversation history that produced the spec, the user's explicit preferences, the strategic shape across dispatches. Both sub-agents structurally lack this context, no matter how good their prompts. Applying the intent frame at every checkpoint — especially when triaging reviewer verdicts — is your unique contribution to loop quality and the only protection against architectural drift hardening through iteration.

## Artifact contract

```text
projects/{project}/
├── slices/<slice>/
│   ├── spec.md                  # drive-specify-slice
│   └── plan.md                  # drive-plan-slice (or inline in spec)
├── reviews/
│   └── code-review.md           # reviewer-maintained; scoreboard + subagent IDs + findings + round notes
└── learnings.md                 # orchestrator-maintained; patterns surfaced this run

wip/heartbeats/                  # gitignored; one file per role (contract in drive-dispatch)
├── implementer.txt
└── reviewer.txt
```

`code-review.md` is the **single per-round review artifact** — no per-round SDR or walkthrough. The PR walkthrough is generated at PR-open time by the team's PR-opening skill (e.g. `drive-pr-walkthrough` against the project base), not iteration-by-iteration.

**Read/write matrix:**

| Artifact | Orchestrator | Implementer | Reviewer |
|---|---|---|---|
| `spec.md`, `plan.md` | RW | R | R |
| `code-review.md` § scoreboard / round notes / findings | R | R | RW |
| `code-review.md § Subagent IDs` / `§ Orchestrator notes` | RW | R | R |
| `packages/**`, `test/**` | — | RW | R |
| `wip/heartbeats/implementer.txt` | R | RW | — |
| `wip/heartbeats/reviewer.txt` | R | — | RW |

The implementer **never** edits `spec.md` or `plan.md`. The reviewer is **read-only on code and tests**.

## The per-dispatch loop

### 1. Pre-flight: per-dispatch DoR

> **Emit `dispatch-start`** (once per dispatch-unit — only on **round 1** of this dispatch; do not re-emit on round 2+). Fields: `dispatch_id` (fresh UUID v4 — record for reuse through this dispatch's `dispatch-end`), `dispatch_name` (operator-authored identifier from the slice plan), `subagent_type` and `model` from the planned `drive-dispatch` / `Task` call, `parent_dispatch_id` (prior dispatch ID when resuming a cross-slice persistent implementer per § Subagent continuity, else `null`), plus envelope fields (`event_id`, `schema_version: "1"`, `ts`, `project_run_id`, `orchestrator_agent_id`). See [`events.md`](../drive-record-traces/events.md) for the payload schema and [`emission.md`](../drive-record-traces/emission.md) for the file-append mechanics.

Before delegating, walk:

- [ ] Slice-plan entry has outcome / builds-on / hands-to / focus filled.
- [ ] **Dispatch passes dispatch-INVEST** (Independent, Negotiable, Valuable, Estimable, Small, Testable — see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md); per-altitude rubric specialised for this codebase at [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md)). *Small* is the most common failure mode: a dispatch whose brief + references don't fit in one executor session, or whose outcome covers more than one sentence, fails *Small* and must be split or sharpened.
- [ ] No silent design decisions assumed — anything unpinned surfaces as a `drive-discussion` stop-condition (see § Stop conditions).
- [ ] Dispatch declares a validation gate (or inherits one from the slice plan). If absent, infer per § Validation gates and confirm with the operator (unattended-mode fallback in § Unattended mode).
- [ ] `code-review.md` exists; scaffold from [`./templates/code-review.template.md`](./templates/code-review.template.md) on the project's first dispatch.

Any DoR item that fails: fix the gap, OR halt and surface to the operator. Do not delegate over a failed DoR.

> **Emit `round-start`** (once per round, after DoR passes, before brief assembly — per-round sequence: `round-start → brief-issued → drive-dispatch → … → round-end`). Fields: `dispatch_id` (from this dispatch's `dispatch-start`), `round_id` (fresh UUID v4 — record for the matching `brief-issued` and `round-end`), `round_number` (1-indexed count of rounds opened within this `dispatch_id`), plus envelope fields. See [`events.md`](../drive-record-traces/events.md) for the payload schema and [`emission.md`](../drive-record-traces/emission.md) for the file-append mechanics.

### 2. Dispatch the implementer (via `drive-dispatch`)

Assemble the dispatch brief from [`drive-dispatch/templates/dispatch-brief.template.md`](../drive-dispatch/templates/dispatch-brief.template.md). Briefs are lean: the same implementer runs every dispatch in a slice, so the brief restates only what's dispatch-specific. See [`docs/drive/principles/brief-discipline.md`](../../docs/drive/principles/brief-discipline.md) for the principle.

> **Emit `brief-issued`** (once per round, after the brief is fully assembled and immediately before calling `drive-dispatch`; slice 1 tracks the implementer brief only). Fields: `dispatch_id` and `round_id` from the round in progress, `brief_byte_length` (UTF-8 byte length of the assembled brief text), `brief_content_hash` (sha256 hex of the same text), `brief_disposition` (`"initial"` on round 1 of this dispatch, `"reissue"` when the hash matches a prior brief in this dispatch verbatim, `"amended"` otherwise), plus envelope fields. See [`events.md`](../drive-record-traces/events.md) for the payload schema and [`emission.md`](../drive-record-traces/emission.md) for the file-append mechanics.

Call `drive-dispatch` with:

- The filled-in brief.
- **The persistent implementer subagent ID** (the slice-loop continuity rule — see § Subagent continuity).
- Context paths: slice spec, slice plan, `code-review.md`, project spec/plan for background.
- Carry-over from the prior round (findings, decisions standing, items triaged out of scope) — empty on round 1.
- Multitasking policy: `background` in Multitask Mode (use the wait window for prep — see § Multitasking the loop).

`drive-dispatch` returns the implementer's structured report + the heartbeat tail + a halt signal (`done` / `blocked` / `stale`). Route per the signal:

- `done` → continue to WIP inspection / DoD.
- `blocked` → the implementer surfaced a deferral or pushback; triage via § Escalation surface.
- `stale` → heartbeat hasn't advanced; surface the snapshot to the operator before deciding whether to wait, course-correct, or kill.

### 3. WIP inspection (mid-dispatch, ≤ 5 min)

Not review — a sanity check that the dispatch hasn't drifted off-brief.

Cadence:

- **Short dispatches** (minutes): no WIP inspection.
- **Longer dispatches** (30 min – couple of hours): one inspection at the midpoint OR at the implementer's first "here's where I am" heartbeat.
- **Unexpectedly long**: WIP inspection fires automatically once the dispatch crosses 90 min wallclock.

What you check: scope still inside files-in-play? Has the implementer started touching out-of-scope files? Early test results passing where they should? Running approach matches the brief's intent?

If you find drift: re-dispatch via `drive-dispatch` with a brief course-correction (resume the same implementer; thin brief). If the drift is significant (implementer is solving a different problem): halt and re-plan via `drive-plan-slice`.

### 4. Post-flight: per-dispatch DoD (with intent-validation)

After `drive-dispatch` returns `done` and before triggering review:

- [ ] All "Completed when" conditions in the brief pass.
- [ ] **Intent-validation:** the diff matches the brief's task. No scope creep; no out-of-scope surfaces touched (the standing instruction was honoured).
- [ ] No findings that should have surfaced as a `drive-discussion` signal during the dispatch.
- [ ] Implementer's heartbeat report aligns with the diff (caught case: implementer claims success but the diff is empty / off-target).

If DoD fails: re-dispatch via `drive-dispatch` with the gap restated, OR re-plan via `drive-plan-slice` if the gap is structural. Do not proceed to reviewer until DoD passes.

### 5. Delegate reviewer

Use [`./templates/delegate-review.md`](./templates/delegate-review.md), passing pointers to recent commits and the implementer's report. **Resume the persistent reviewer** (same continuity rules as the implementer). **In Multitask Mode**, background and prep.

### 6. Reviewer verdict + intent-validation + triage

Reviewer returns one of `SATISFIED` / `ANOTHER ROUND NEEDED` / `ESCALATING TO USER`.

**Validate every verdict against intent before triaging.** Required step — not optional. The reviewer reasons forward from artifacts; you reason forward from intent. Read the verdict, the AC scoreboard delta, the new findings (and severities), and the round entry. Apply project-level context to four questions:

- Does this verdict reflect intent, not just artifact-match? A `SATISFIED` verdict on a spec that misses a subtle decision is still wrong.
- Did the reviewer let any architectural choice through that I should question?
- Are finding severities calibrated correctly given cross-dispatch context?
- Is anything missing that I'd expect to be flagged given intent context?

A 2-minute skim, not a re-review of the diff. Possible actions:

- **Pass-through** (most common) — verdict reflects intent; proceed.
- **Re-prompt the reviewer** with a focused gap (*"you said SATISFIED but missed X; revisit"*). Preserves the reviewer's role.
- **Override the verdict** (rare): record under `code-review.md § Orchestrator notes` with rationale. Frequent overrides mean the reviewer is mis-calibrated — a separate problem to surface.
- **Refine spec/plan** — intent-validation occasionally reveals the spec is wrong, not the implementation. Treat as a replan trigger.

Any non-pass-through action must be **visibly recorded** — in `code-review.md`, in the next delegation prompt, or both. Invisible orchestrator-only edits break the artifact contract.

Triage the (post-intent-validation) verdict:

- `SATISFIED` → next dispatch, or close the slice and auto-open the PR if this was the last dispatch.
- `ANOTHER ROUND NEEDED` → loop to step 2 with the reviewer's findings as carry-over in the next dispatch call.
- `ESCALATING TO USER` → surface as a structured decision (§ Escalation surface).

> **Emit `round-end`** (once per round, after triage records the verdict — all branches). Fields: `dispatch_id` and `round_id` from the round, `verdict` mapped from triage (`SATISFIED → "satisfied"`, `ANOTHER ROUND NEEDED → "another-round-needed"`, `ESCALATING TO USER → "escalating-to-user"`, halt routed to `drive-discussion` per § Stop conditions → `"stop-condition"`), `findings_filed` (count of new entries appended this round to `code-review.md § Findings log`, best-effort), `wall_clock_ms` (`now − round-start.ts` for this `round_id`), plus envelope fields. See [`events.md`](../drive-record-traces/events.md) for the payload schema and [`emission.md`](../drive-record-traces/emission.md) for the file-append mechanics.

> **Emit `dispatch-end`** (once per dispatch-unit, when the dispatch terminates — not on every round). Fire after the matching `round-end` when triage is `SATISFIED` and no further dispatches remain in the slice (close-slice path), or when a § Stop conditions halt ends the dispatch without a clean `SATISFIED` (`result`: `"completed"` when the subagent delegation finished and review captured on `round-end`, `"failed"` when the implementer surfaced a stop condition, `"aborted"` when the orchestrator killed the dispatch — e.g. WIP-inspection drift). Fields: `dispatch_id` from this dispatch's `dispatch-start`, `result`, `wall_clock_ms` (`now − dispatch-start.ts`), plus envelope fields. See [`events.md`](../drive-record-traces/events.md) for the payload schema and [`emission.md`](../drive-record-traces/emission.md) for the file-append mechanics.

## Stop conditions

The loop halts and surfaces to the operator via `drive-discussion` when:

1. **Falsified assumption.** A spec assumption is observed false during execution. Invariant I12: no silent agent-side amendments.
2. **Unpinned design decision encountered.** A dispatch hits a fork the slice spec didn't pin and that isn't a documented degree-of-freedom.
3. **Out-of-scope surface needs touching to complete the dispatch.** Either the scope was wrong (re-spec) or the approach was wrong (re-plan).
4. **Dispatch refused at DoR for failing dispatch-INVEST.** Re-plan via `drive-plan-slice`. If the slice can't decompose into INVEST-passing dispatches cleanly, escalate via `drive-discussion` — the slice itself may need re-triaging (promote to project).
5. **Health-check drift signal that suggests scope shift.** Surfaced by `drive-check-health` between dispatches. Route to `drive-start-workflow` for mid-flight re-triage.
6. **Operator-set custom stop.** Declared in `drive/plan/README.md` (e.g. *"any dispatch that touches `packages/3-extensions/migration/*` halts for review before merge"*).

In all cases the stop-condition is **visible** — recorded in `code-review.md`, in `wip/unattended-decisions.md` (unattended mode), or both. Silent stop-and-resume defeats the I12 protocol.

## Subagent continuity

**Default: one implementer + one reviewer per project, resumed across every round and dispatch.** A fresh subagent each round produces three concrete failure modes:

1. **Procedural anomalies that look like the work was already done.** A fresh implementer asked to land tasks T<N> may discover that prior commits already cover them — but with no continuity to verify whether those commits are its own prior work or stray edits. The orchestrator then investigates and often surfaces noise.
2. **Context re-derivation cost.** A fresh subagent re-reads the same files, re-learns the same constraints, re-discovers the same landmines.
3. **Findings drift across rounds.** A fresh reviewer can't remember the *reasoning* behind their prior verdict — only what's on disk. Subtle calibrations get lost.

**Mechanism is harness-specific.** Cursor's `Task` exposes a `resume` parameter; Claude Code exposes equivalent semantics. Harnesses without resume: run a single long-lived implementer chat and reviewer chat that the orchestrator drives turn-by-turn.

**Spawn fresh only when:** first round of the project; prior ID inaccessible; deliberate pivot of role intent (e.g. user-requested fresh-eyes pass). Record any swap in `code-review.md § Subagent IDs`.

The continuity rule is loop-level; the act of passing the ID into a dispatch call lives in `drive-dispatch`.

## Multitasking the loop

When the harness supports it (Cursor IDE in Multitask Mode is canonical), `drive-dispatch` backgrounds the implementer and reviewer rounds. The harness notifies on completion; no polling.

**Never run two persistent subagents of the same role in parallel** — they race on the transcript and break continuity. The loop is **sequential per role**, even when each call is backgrounded. Different roles can legitimately overlap when the orchestrator runs a one-shot side task that doesn't touch the persistent subagents.

**During the wait window, do prep work:**

1. Pre-stage the next delegation prompt for whichever role isn't currently running.
2. Read the next dispatch's plan entry; pre-identify surfaces it will touch.
3. Run on-disk checks the orchestrator owns (scan heartbeats for staleness; re-read `plan.md § Open items`; verify deferrals are still consistent).
4. Drain the user's other questions on a separate thread.

**Do not** poll the backgrounded subagent, write code or run validation gates yourself in parallel, or delegate a parallel subagent that touches the same surface.

## Heartbeats (loop-level use)

`drive-dispatch` owns the heartbeat contract — file location, cadence, format, and the implementer-side foreground-vs-background discipline live in [`drive-dispatch/agents/implementer.md § Heartbeats`](../drive-dispatch/agents/implementer.md). The reviewer's persona at [`./agents/reviewer.md`](./agents/reviewer.md) documents the equivalent contract for `wip/heartbeats/reviewer.txt`.

The loop reads heartbeats during § WIP inspection and whenever uncertainty surfaces between turns. Two patterns of interest: **stale `ts` (> ~10 min)** → likely hung; surface the snapshot to the user rather than silently kill. **Fresh ping but `phase` unchanged across multiple checks** → stuck in a tight loop; same surface-to-user pattern.

Orchestrator never modifies heartbeat files.

## Findings discipline

`code-review.md § Findings log` is a **work backlog for the implementer's next round**, not a journal of observations. Every entry is something the implementer must address before the dispatch reaches `SATISFIED`.

**The bar for filing a finding:** the recommended action must be **addressable by the implementer in the current PR**. If "no change in this PR" is the right call:

- Warrants action in a future dispatch of this PR → orchestrator adds it to that dispatch's task list in `plan.md`. **Not a finding.**
- Warrants action in a future PR / project → orchestrator records in `plan.md § Open items` or files a follow-up ticket. **Not a finding.**
- Narrative context that helps the verdict make sense → goes in the round's narrative notes. **Not a finding.**
- None of the above → noise; drop it.

**All severities (`must-fix`, `should-fix`, `low / process`) block dispatch `SATISFIED`.** Severity is for within-round prioritisation, not for letting items carry forward. There is no "informational" tier — if you'd file something with a non-actionable recommendation, do not file it.

This is the most important way `drive-build-workflow` differs from `drive-pr-local-review`. Local-review is one-shot; "consider for the future" notes are legitimate output. Build-workflow runs the iterate-implement loop; every finding reaches the implementer in the next delegation, so non-actionable findings are noise.

## Validation gates

Each dispatch declares a **validation gate** — the explicit harness commands that must all pass before the dispatch is considered done. **The implementer runs the gate; the reviewer trusts the implementer's gate run and focuses on design judgment.** The reviewer's `pnpm` budget for routine review is zero. The exception is the verify-on-main protocol (a focused force-build + typecheck to investigate a "pre-existing on main" claim from the implementer); that is reviewer-side investigation, not a gate re-run.

If the plan doesn't declare a gate, the orchestrator infers it: typecheck, the test commands covering the dispatch's surface (package-scoped at minimum), lint if applicable, build if applicable. Surface the inferred gate to the user for confirmation, then write it back into the dispatch definition so subsequent rounds inherit it. Inferred-without-confirmation gates are a foot-gun — the user often has tacit harness knowledge that doesn't surface until a wrong gate is proposed.

**Cross-package gates.** When a dispatch deletes or renames a public export, a package-scoped test gate alone misses consumer surfaces. Always extend with the workspace-wide test command and a grep for the deleted/renamed symbol across `test/`, `examples/`, and sibling packages.

**Gate failures** are a hard pause: the orchestrator decides whether the failure is in-scope (regression to fix) or pre-existing fragility (escalate to user). Gates are never declared green by skipping commands.

## Escalation surface

When the reviewer or implementer surfaces items requiring user decision:

```markdown
**N. <Finding ID and short title>** — <one-paragraph problem statement>.

<Optional context: severity, prior decisions, related findings.>

   - **(a) <option>** — <consequence>.
   - **(b) <option>** — <consequence>.

<Optional recommendation, if defensible.>
```

Rules: number the decisions (not just options); lead with the problem statement before options; state a recommendation only when defensible — if the trade-off is genuinely the user's call, say so and don't recommend. **Translate the user's response back into plan/spec edits before re-delegating.** A decision that lives only in the orchestrator's head is invisible to future subagent rounds.

## Unattended mode

When the user explicitly hands off — *"continue without me to the end"*, *"use your best judgement"*, *"I'll be unavailable"* — defaults shift:

1. **Decisions that would normally be escalated are made in-place**, using the most defensible reading of project intent.
2. **Every such decision is logged** in [`./templates/unattended-decisions.template.md`](./templates/unattended-decisions.template.md), at a gitignored scratch path (typically `wip/unattended-decisions.md`).

Acknowledge the mode shift in the first response after the trigger ("Operating in unattended mode; decisions will be logged to `<path>`.").

**Operating rules under unattended mode:**

- **Conservative scope.** No work outside what's approved in `spec.md` / `plan.md`. New scope → log + decline; file as out-of-scope; recommend follow-up ticket.
- **Defensible over novel.** When two equally valid options exist, pick the one closer to repo conventions. Log the alternatives.
- **Pre-existing flakes / unrelated failures.** Log; fix only if it blocks a validation gate.
- **Hold the branch local at slice DoD.** The interactive-mode auto-push-and-open-PR default does **not** apply unattended — surface readiness as the return-to-interactive handoff (unless the operator pre-authorised PR-open in the unattended scope).
- **Decline third-party automation expansions.** Don't authorise external bots to create tracker artifacts. Log the decline.
- **Avoid `--no-verify`.** Never skip pre-commit hooks.

**Stop conditions** (halt + leave the branch recoverable): validation gate can't be made green within in-scope work; implementer surfaces a blocker requiring an architectural decision; spec/plan turn out wrong in a way you can't correct from intent alone; user's prior decisions are mutually inconsistent; scope expansion is required to complete the work.

**Decisions log entry format — readability is load-bearing.** The user reading on return is not in your context: review artifacts may be deleted by close-out, finding IDs are meaningless without their source, the user hasn't been tracking the loop in real time. Do not refer to findings by ID — translate the substance into plain language. Do not lead with round labels as the trigger. Do not assume the reader can read other artifacts. Lead with what was decided, then why. Make verification concrete. The full entry template is in [`./templates/unattended-decisions.template.md`](./templates/unattended-decisions.template.md).

**Returning to interactive:** hand the user the log explicitly — list the decision titles inline, surface anything you flagged as needing their attention, and confirm whether any deferred items still need a destination. Do not assume the user has read the log.

## Project learnings

`projects/{project}/learnings.md` records patterns surfaced during this run — foot-guns, escapees, severity calibrations the user weighed in on, classes of bug the spec didn't cover. Working ledger, not a shipped artifact.

Append a pattern entry whenever a non-trivial calibration is made. At close-out (per `drive-close-project`), the orchestrator + user review the file together; cross-cutting lessons migrate to durable docs (ADRs, team-level engineering docs), project-local lessons drop with the project folder.

## Cross-cutting behavioral rules

These are the invariants the orchestrator enforces across every iteration. Each one names a real failure mode I've seen this skill drift on without the rule.

- **On slice DoD met, auto-push and open the PR.** Once the reviewer reports `SATISFIED` across all dispatches, the orchestrator does **not** halt to ask for permission to push. It runs the team's PR-opening sequence (`git push -u origin HEAD`, then `gh pr create` with the body from `drive-pr-description`) and reports the PR URL. The operator's intent has already been expressed through spec + plan + per-round triage; a consent gate at PR-open replays the question for no informational gain. Skip auto-open only if the operator pre-declared a manual-PR scope, or in unattended mode without an explicit PR-opening grant.
- **Implementer flags > silent descope.** A deferral request is a hard pause; do not delegate review with the deferral unaddressed.
- **Honest implementer pushback is valuable.** When the implementer brings evidence that contradicts a reviewer finding (file paths, diffs, prior commits), update the reviewer's record rather than insist the implementer comply.
- **Reviewer is read-only on code, tests, and planning artifacts.** If a reviewer attempts to amend `plan.md` or `spec.md`, that's a delegation-protocol failure — re-delegate with a tightened brief.
- **Executor's standing instruction is "stay focused on the goal; control scope" — not "minimize changes."** Minimization trains timidity; goal-focus + scope-discipline trains good judgment. Trivial-and-related fixes that serve the goal go in the same dispatch with a one-line note. Drift from the goal halts.
- **Side-quests get explicit framing + their own commit.** Out-of-scope fixes commit separately with a scope-note in the message; never bundled with dispatch work.
- **User decisions translate to plan/spec edits before re-delegating.** Any decision that affects future rounds belongs on disk, not in the orchestrator's working memory.

## Pitfalls

1. **Re-litigating the spec mid-loop without explicit user buy-in.** The orchestrator's intent fidelity job is to apply the spec to the reviewer's verdict, not to second-guess the spec itself. If intent-validation reveals the spec is wrong, route through the replan protocol — don't silently amend.
2. **Forming independent opinions about correctness without delegating.** When you start reading code and forming an opinion, you've quietly slipped into the reviewer's role. Re-delegate; the reviewer's lens is what catches what yours misses.
3. **Treating reviewer verdicts as authoritative on intent.** They are authoritative on artifact-match; intent fidelity is yours alone. Skipping the intent-validation step lets reviewer drift imprint into subsequent rounds, which is expensive to roll back.
4. **Spawning a fresh subagent "because this is a different dispatch."** Persistent continuity across dispatches is the point. Spawn fresh only for the cases enumerated in § Subagent continuity.
5. **Filing a finding with "no action in this PR" as the recommendation.** That's not a finding — it's a plan amendment, a follow-up ticket, or noise. See § Findings discipline.
6. **Asking the reviewer for SDR or walkthrough refreshes.** Those aren't per-round deliverables. The walkthrough lives at PR-open time. If you want intent context mid-loop, surface it yourself — that's your unique contribution.
7. **Inlining brief assembly / implementer delegation.** Those are `drive-dispatch`'s job — call it. Re-implementing the dispatch mechanics inside the loop defeats the factoring and drifts the templates.

## References

- [`drive-dispatch/SKILL.md`](../drive-dispatch/SKILL.md) — the atomic skill this loop calls per dispatch.
- [`drive-dispatch/agents/implementer.md`](../drive-dispatch/agents/implementer.md), [`./agents/reviewer.md`](./agents/reviewer.md) — subagent personas.
- [`drive-dispatch/templates/dispatch-brief.template.md`](../drive-dispatch/templates/dispatch-brief.template.md), [`drive-dispatch/templates/delegate-implement.md`](../drive-dispatch/templates/delegate-implement.md) — dispatch brief skeleton and implementer delegation prompt.
- [`./templates/delegate-review.md`](./templates/delegate-review.md), [`./templates/delegate-specialist.md`](./templates/delegate-specialist.md) — reviewer / specialist delegation prompts (loop-internal).
- [`./templates/code-review.template.md`](./templates/code-review.template.md) — `code-review.md` scaffold.
- [`./templates/unattended-decisions.template.md`](./templates/unattended-decisions.template.md) — decisions-log scaffold + entry format.
- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md), [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — dispatch-INVEST.
- [`docs/drive/principles/brief-discipline.md`](../../docs/drive/principles/brief-discipline.md) — why briefs thin across resumed dispatches.
- [`drive/roles/README.md`](../../drive/roles/README.md) — the canonical Orchestrator role definition.
- [`docs/drive/model.md`](../../docs/drive/model.md) § Layer 5 — invariant I12 (no silent agent-side amendments).

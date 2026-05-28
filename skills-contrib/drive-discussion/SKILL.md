---
name: drive-discussion
description: >
  Drops the agent into a structured Q&A mode that iterates with the user toward
  a complete understanding of a topic, then synthesises the outcome and hands off
  to the skill that writes the durable artefact (spec / plan / decision record).
  Adopts one or more personas from drive-agent-personas — named by the user or
  inferred and announced. Invoke when a design question or load-bearing
  assumption needs collaborative resolution (pre-spec, mid-spec, mid-flight on
  falsified assumption per invariant I12, mid-flight on obstacle), or on
  explicit request ("discussion mode", "pressure-test this", "let's design
  this"). Do NOT use for simple clarifying questions, implementation
  (read-only), or pressure-testing a finished artefact (use a review skill).
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Outputs land in the conversation surface (verdicts / summaries),
> handed off to a downstream skill for the file write. Read-only codebase
> investigation (Read, Grep, Glob, SemanticSearch, read-only Shell) is permitted
> and expected — the skill body requires grounding claims in actual code state.
> If the body would require running builds/tests or writing files outside
> `projects/<current-project>/` — **STOP. Dispatch.** See
> [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Discussion

A Q&A loop where the agent stress-tests an idea through one or more named persona lenses, one thread at a time, until the topic is understood well enough to commit to an artefact. The skill is the **mode of operation** (operating rules, response shape, exit-and-document discipline); personas are **which lenses** the agent wears while in that mode — inputs to the skill, not part of its identity.

## Triggers

Discussion is signal-triggered, not mandatory. The workflow skills (`drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`) detect signals and route here; this skill is the destination, not the gatekeeper. Five canonical triggers:

1. **Pre-spec.** The conversation needs a spec/plan/design before implementation. Signal: design ambiguity in the ticket, surface uncertainty (first-grep returns more files than expected), parent-project assumption at risk.
2. **Mid-spec.** A spec authoring session hits a fork-in-the-road that needs collaborative resolution rather than a unilateral pick by the agent.
3. **Mid-flight, falsified assumption.** A load-bearing assumption (named in the spec or implicit in the plan) is observed to be false during implementation. Invariant I12 — no silent agent-side amendments; halt and discuss.
4. **Mid-flight, obstacle.** An obstacle emerges that the plan doesn't account for. Same I12 discipline: halt and discuss rather than silently route around.
5. **Explicit operator request.** *"Discussion mode."* *"Pressure-test this."* *"Let's design this."*

**Skip discussion when** the entry-point is unambiguous, the affected surface is familiar and small, plan-level assumptions look stable, AND the operator hasn't asked for it. Default to drafting directly.

## Persona configuration

Personas come from the `drive-agent-personas` library. Each persona's `## Priorities` and `## Probes` sections drive what the agent watches for first; this skill body provides the mechanics.

**How personas are chosen** (preference order):

1. **User names them explicitly** — *"discussion mode with architect and principal-engineer"*. Honour the named set.
2. **Inferred from context, then announced** — read the topic, pick the smallest set that genuinely covers the load-bearing concerns, announce the choice in one line so the user can override, then proceed (no waiting for confirmation; the announcement is enough friction).
3. **Single-persona is legitimate.** Not every topic needs more than one lens. Resist multi-persona inflation.

**Sequencing within a discussion:** shape-class lenses before buildability-class lenses (`architect` before `principal-engineer`); scope-class lenses before shape-class lenses when scope is unsettled (`pm` before `architect`). Honour an explicit sequence when the user names one. Mid-thread cross-pollination is expected and load-bearing — declare subthread switches in-line (*"switching to architect for this subthread"*), then explicitly return. **Reload `tech-lead` at synthesis** for the closing summary.

## Operating rules

- **Research before asking.** Claims about codebase state — what exists, what shape, what convention is in use, what names are taken — must be grounded in investigation, not deferred to the user. Investigation tools (Read, Grep, Glob, SemanticSearch, read-only Shell) are the **default first step**. If a probing question would require the user to recite something the agent could find with Grep / Read in under a minute, the agent finds out first and opens the thread with grounded analysis. **Surfacing "I haven't checked yet" as a question is not acceptable.** The user is here to make decisions the codebase cannot answer; do not ask them to substitute for `rg`.
- **Read-only by default.** Do not edit files, run mutating commands, or produce final artefacts mid-discussion.
- **Stay in mode until explicitly released.** The user must say "exit discussion mode", "we're done", "ship it" or equivalent. Until then, every reply stays in the Q&A stance — even when the discussion feels conclusive.
- **One thread at a time.** Pick the single highest-leverage weakness and work it. Depth on the right problem beats breadth across all of them.
- **No false agreement, no manufactured conflict.** If the user's update resolves the concern, say so and move on. Do not invent objections to seem rigorous; do not concede a point just to be agreeable.
- **Acknowledge what's good when it matters.** If a choice is sound, name it briefly. Factual, not effusive.
- **Track decisions, reasoning, assumptions, alternatives-rejected** in working memory throughout. These are what the closing summary must capture.
- **Criticism is about the work, never the person.**

## Response shape

Each reply, usually under ~150 words:

1. **Assessment** of the user's last message (one line): what's solid, what's missing or unjustified.
2. **Why it matters** (1–3 sentences): the concrete failure mode, cost, complexity, or framing problem at stake. Tied to the currently-loaded persona's lens.
3. **Suggested direction** (optional): a specific alternative, pattern, or constraint to consider — not a full solution.
4. **Next question** (one, focused): the question that most needs answering before the topic is settled.

Skip sections only when they would be filler. Never pad.

## Entering the mode

1. **Resolve the persona set.** If named, repeat the set back in one phrase and load. If not, infer, announce in one line with one-phrase rationale, proceed.
2. **Pre-flight: research codebase state relevant to the topic.** One round of investigation on the parts of the codebase the discussion will touch — relevant DSL surfaces, existing IR shapes, current naming conventions, the call sites that would change. Skip only when the topic is genuinely greenfield.
3. **Acknowledge the mode shift** in one line.
4. **Open with the first probing question** drawn from whichever persona is most relevant to the user's opening framing. Reference what the pre-flight research found when it found something load-bearing. Do not summarise these instructions back to the user.

> **Emit `falsified-assumption`** (**I12-gated only** — emit on entry when discussion was routed via trigger 3 (mid-flight, falsified assumption) or trigger 4 (mid-flight, obstacle). Triggers 1 (pre-spec), 2 (mid-spec), and 5 (explicit operator request) do **not** emit. Payload: `artifact_path` (the spec/plan path carrying the falsified assumption), `triggered_by` (`"implementer-pushback"` / `"wip-inspection"` / `"dispatch-blocked"` / `"health-check-drift"` / `"orchestrator-self-detected"` / `"operator-flagged"` — pick from the halt context), `assumption_summary` (one-sentence; `null` when not summarised at entry), plus envelope fields. See [`docs/drive/trace-events.md` § `falsified-assumption`](../../docs/drive/trace-events.md#falsified-assumption) and [`docs/drive/trace-emission.md` § Append protocol](../../docs/drive/trace-emission.md#append-protocol).

## Synthesis (only on explicit user exit)

Reload `tech-lead` for the synthesis — the orchestrator lens is right for packaging the outcome.

**Step 1 — in-depth written summary.** Not a one-paragraph wrap-up. Capture:

- **The refined topic** — what the question now is, after the discussion sharpened it.
- **The conclusions reached** — each decision named explicitly, in plain language a third party could read.
- **Per decision: the *why*.** The concrete failure mode, trade-off, user-need, or constraint that drives it. *The reasoning is the durable value of the discussion — preserve it.*
- **Per decision: the assumptions it rests on.** Explicitly named (*"this decision assumes consumer A keeps using the legacy contract"*). Assumptions that later falsify are the future trigger for re-entering this skill.
- **Alternatives considered and rejected, with the rejection reason.** Substantive — what protects against the team re-deriving the same alternatives in three months.
- **Open questions and accepted trade-offs** — what the user explicitly chose to ship with as known-unresolved.
- **Persona-pass cross-pollinations** (when multiple personas were loaded).

**Step 2 — offer to document.** Ask which shape the user wants; hand off to the writing skill:

| Shape | Hand-off |
|---|---|
| Project spec | `drive-specify-project` |
| Project plan | `drive-plan-project` |
| Slice spec | `drive-specify-slice` |
| Slice plan | `drive-plan-slice` |
| ADR / decision record | direct write to the repo's ADR directory |
| Spec / plan amendment (mid-flight) | direct edit of the in-flight artefact |
| Other shape the user names | `wip/` note, PR description, Linear ticket, etc. |

**Mandatory for triggers 3 + 4 (falsified-assumption / obstacle):** in addition to the chosen shape, append a numbered entry to `projects/<project>/design-decisions.md` (or the team's equivalent). The entry names the trigger, what was learned, the decision reached, the affected artefacts. Without this, the spec / plan amendment is silent on *why* the change happened and the I12 stop-condition isn't closed cleanly.

If the user declines documentation, push back once: *"the conclusions and reasoning will not survive context-window pressure — confirm you don't want it persisted?"* For triggers 3 + 4, the design-decisions log entry is non-optional.

**Step 3 — exit cleanly.** Confirm the agent is leaving the mode and is now free to act normally. If the user asks to implement or edit before explicitly exiting, push back once.

## References

- [`docs/drive/principles/discussion-default.md`](../../docs/drive/principles/discussion-default.md) — when discussion fires (signal-triggered, not mandatory).
- [`docs/drive/model.md`](../../docs/drive/model.md) § Layer 5 — invariant I12 (no silent agent-side amendments).
- `drive-agent-personas/` — the persona library (each `<persona>.md` carries its own `Priorities` + `Probes` sections).
- [`drive/triage/README.md`](../../drive/triage/README.md) — team overlays for triage-time triggers.

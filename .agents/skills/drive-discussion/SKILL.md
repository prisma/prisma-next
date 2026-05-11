---
name: drive-discussion
description: Drops the agent into a structured Q&A mode that iterates with the user toward a complete understanding of a topic, then documents the outcome (project spec, plan, decision record, or whatever shape fits). The agent adopts one or more personas from the `drive-agent-personas` library — named explicitly by the user, or inferred from conversation context and announced. Typical use is design work at the start of a task, or mid-implementation when a load-bearing assumption has been falsified. Use ONLY when the user explicitly invokes this skill (e.g. "discussion mode", "pressure-test this", "let's design this"). Never auto-invoke.
disable-model-invocation: true
---

# Discussion mode

A Q&A loop where the agent stress-tests an idea, framing, or decision with the user — one thread at a time, through one or more named persona lenses — until the topic is understood well enough to commit to an artefact (a project spec, a project plan, a decision record, or whatever shape the user wants).

The skill is the *mode of operation*: the operating rules, the response shape, the one-thread-at-a-time discipline, the read-only stance, the explicit exit-and-document step. The personas are *which lenses* the agent wears while operating in that mode — inputs to the skill, not part of its identity.

## When to use

- **At the start of a task**, where the conversation needs to produce a spec, plan, or design before implementation begins.
- **Mid-implementation, when a load-bearing assumption has been falsified** and the team needs to decide what to do instead. Surfacing the falsification as a discussion topic is itself one of the skill's uses — *"the contract-versioning assumption from spec § 3.2 is wrong; entering discussion mode to decide what changes."*
- **Any time a substantive understanding needs to be built collaboratively** rather than asserted by the agent — when the agent's default tendency to converge on an answer would lose information the user has and the agent does not.

Do **not** use this skill for:

- Quick clarifying questions (a single `AskUserQuestion` is enough).
- Implementation work (this skill is read-only by design).
- Pressure-testing a *finished* artefact (use a review skill instead).

## Persona configuration

This skill adopts one or more personas from the `drive-agent-personas` library for the duration of the discussion. The personas drive *what the agent watches for first* during the Q&A; this skill body provides the *mechanics of the discussion*.

### How personas are chosen

In order of preference:

1. **User specifies them explicitly** — *"discussion mode with architect and principal-engineer"*, *"pm lens"*, *"discussion mode with devrel and oss-specialist"*. Honour the named set exactly.
2. **Inferred from context, then announced** — when the user invokes this skill without naming personas, read the recent conversation and the topic at hand, pick the smallest set of personas that genuinely covers the topic's load-bearing concerns, and **announce the choice on entry** so the user can override before the discussion starts (*"loading architect + principal-engineer based on the framing — say so if you want a different lens"*). Then proceed without waiting for confirmation; the announcement is enough friction.
3. **Single-persona discussions are a legitimate shape.** Not every topic needs more than one lens. Resist multi-persona inflation when the topic is genuinely single-lens.

### Persona sequencing within a discussion

- **Single persona** — adopt it at entry; stay in it for the body; reload `tech-lead` at synthesis (see § Synthesis).
- **Multiple personas** — sequence per the personas' own dependency relationships. Typical defaults: shape-class lenses before buildability-class lenses (e.g. `architect` before `principal-engineer`); scope-class lenses before shape-class lenses when scope is unsettled (e.g. `pm` before `architect`). When the user names a sequence explicitly, honour it. The default sequence is a heuristic, not a contract.
- **Cross-pollination is expected** and load-bearing. Mid-thread, the conversation can pull a concern back across a persona boundary (*"the user is proposing a new naming scheme; switch to architect for this subthread"*). Switch silently for the subthread, then return to the lens that was driving.
- **Reload `tech-lead` at synthesis** for the closing summary and the documentation offer. The orchestrator lens is the right one for packaging the outcome.

Persona is *the lens, not a phase the conversation is locked into.* Per the agent-personas library, each persona load is visible in the workflow body and persona is not propagated — the agent re-loads at every boundary rather than carrying the prior persona through.

## Operating rules (apply across all personas)

- **Read-only by default.** Do not edit files, run mutating commands, or produce final artefacts mid-discussion. Investigation tools (Read, Grep, Glob, SemanticSearch, read-only Shell) are fair game when needed to ground a critique in real code or docs.
- **Stay in mode until explicitly released.** The user must say something like "exit discussion mode", "we're done", "ship it", or equivalent. Until then, every reply stays in the Q&A stance, even if the user seems satisfied.
- **One thread at a time.** Pick the single highest-leverage weakness and work it. Do not dump a flat list of every concern in one reply; depth on the right problem beats breadth on all of them.
- **No false agreement, no manufactured conflict.** If the user's update genuinely resolves the concern, say so plainly and move on. Do not invent objections to seem rigorous, and do not concede a point just to be agreeable.
- **Acknowledge what's good when it matters.** If a choice is sound or a trade-off is well-reasoned, name it briefly so the user knows where the foundation is solid. Keep it factual, not effusive.
- **Track context as you go.** Decisions, the *reasoning* behind each decision, the *assumptions* each rests on, the alternatives considered and dismissed (with the rejection reason) — these are the substantive value of the conversation. Hold them in working memory throughout; they are what the closing summary must capture (see § Synthesis).
- **Criticism is about the work, never the person.** Personas are direct and specific by design; that is not licence to be hostile, sarcastic, or dismissive.

## Response shape

Each reply follows this structure. Keep it tight: usually under ~150 words unless detail is genuinely required.

1. **Assessment** of the user's last message (one line): what's solid, what's missing, weak, or unjustified.
2. **Why it matters** (1–3 sentences): the concrete failure mode, cost, complexity, defect, or framing problem at stake. Tie it to the currently-loaded persona's lens.
3. **Suggested direction** (optional, when you have one): a specific alternative, pattern, or constraint to consider, not a full solution.
4. **Next question** (one, focused): the question that most needs answering before the topic is settled.

Skip sections only when they would be filler. Never pad.

## What to probe for

The currently-loaded persona doc is the source of truth — its `## Priorities` and `## Probes` sections drive what the agent watches for first. Read the relevant persona docs before entering the discussion if they have not already been loaded in this session.

The choice of which persona is currently driving the Q&A depends on:

- The current substantive concern (typology / naming → architect; failure modes / blast radius → principal-engineer; user / scope / evidence → pm; learnability → devrel; contributor experience → oss-specialist).
- The sequence agreed at entry (when the user named one).
- Cross-pollination triggers (e.g. a typology concern raised mid-PE pass switches to architect for the subthread).

## Entering the mode

When invoked:

1. **Resolve the persona set.** If the user named personas, repeat the set back in one phrase and load them. If not, infer from context, announce the choice in one line with a one-phrase rationale, and proceed.
2. **Acknowledge the mode shift** in one line.
3. **Open with the first probing question** drawn from whichever persona is most relevant to the user's opening framing. Do not summarise these instructions back to the user.

Example openings:

> In discussion mode with architect + principal-engineer. Starting with the architect lens — what concept is this proposing to introduce, and what does it distinguish itself from?

> In discussion mode with pm. What user, with what job-to-be-done, in what context — and what evidence says it's worth doing now?

> An assumption seems to have been falsified mid-implementation. Entering discussion mode with principal-engineer. What's the falsified assumption, and what observation falsified it?

## Synthesis

**Only on explicit user exit instruction.** The user must release the mode; do not exit on their own initiative even when the discussion feels conclusive.

On exit, **reload the `tech-lead` persona** for the synthesis — the orchestrator lens is the right one for packaging the outcome.

### Step 1 — in-depth written summary

A quick summary in chat loses context fast. Produce an **in-depth** summary (not a one-paragraph wrap-up) that captures:

- **The refined topic** — what the question now is, after the discussion sharpened it.
- **The conclusions reached** — the decisions the user committed to during the discussion. Each decision named explicitly, in plain language a third party could read.
- **Per decision: the *why*.** What concrete failure mode, trade-off, user-need, or constraint drives the decision. *The reasoning is the durable value of the discussion — preserve it.* A summary that captures only the verdicts loses what made the discussion worth having.
- **Per decision: the assumptions it rests on.** Explicitly named. *"This decision assumes the system will see ≤10 RPS"*; *"This decision assumes consumer A keeps using the legacy contract."* Assumptions that later falsify are the future trigger for re-entering this skill.
- **Alternatives considered and rejected, with the rejection reason.** Not just *"we considered X but didn't pick it"* — the substantive reason. This is what protects against the team re-deriving the same alternatives in three months and forgetting why they were rejected.
- **Open questions and accepted trade-offs** — what the user explicitly chose to ship with as known-unresolved.
- **Persona-pass cross-pollinations** (when multiple personas were loaded) — *"the architect raised X; that changed how the principal-engineer framed Y."* The cross-pollination is load-bearing context the summary should preserve.

The summary is the artefact the rest of the team (and future-you) reads when the question comes up again.

### Step 2 — offer to document

Offer to write the summary to a durable artefact, and ask the user which shape they want. Typical shapes (suggest the one that matches the user's framing; offer others as alternatives):

- **Project spec** (`projects/<project>/spec.md`) — when the discussion produced the *what and why* of a new project, before implementation begins. Hand off to `drive-create-spec` for the actual file write.
- **Project plan** (`projects/<project>/plan.md`) — when the discussion produced the *how and in what order* for an already-shaped project. Hand off to `drive-create-plan`.
- **Decision record / ADR** — when the discussion produced a single architectural decision deserving a durable record under the repo's ADR directory.
- **Plan / spec amendment** — when the discussion happened mid-implementation and the outcome is an update to an existing in-flight artefact (a `plan.md` task amendment, a `spec.md § Assumptions` update marking a prior assumption as falsified).
- **Other shape the user names** — a markdown note under `wip/`, a PR description, a Linear ticket, etc.

If the user declines documentation, push back once explicitly: *"the conclusions and reasoning will not survive context-window pressure — confirm you don't want it persisted?"* Discussions that produce real understanding deserve real artefacts; opt-out is the user's choice, not the default.

### Step 3 — exit cleanly

Confirm the agent is leaving the mode and is now free to act normally (edit files, implement, hand off to the next skill).

If the user asks to implement or edit before explicitly exiting, push back once: confirm they want to leave discussion mode, then proceed.

## Worked examples

### A. Engineering design at the start of a project

**Trigger:** *"Discussion mode — I want to design this new subsystem before we start implementing."*

**Personas:** `architect` (system shape, naming, bounded contexts) → `principal-engineer` (failure modes, blast radius, operability, cost). Sequenced because the lenses cross-pollinate.

**Outcome:** typically a project spec (`projects/<project>/spec.md`), handed off to `drive-create-spec` for the file write.

### B. Product framing for a new feature

**Trigger:** *"Discussion mode, pm lens — let's pressure-test whether we should build this."*

**Personas:** `pm` (named user, evidence, outcome over output, scope, riskiest assumption, non-goals). Single-persona invocation.

**Outcome:** typically a spec amendment to an existing project, or a decision record naming the chosen scope and the riskiest assumption to test first.

### C. Mid-implementation falsified assumption

**Trigger:** *"We've hit a wall — the assumption that consumer A would adopt the new contract turns out to be wrong. Discussion mode."*

**Personas:** inferred from the falsified assumption's domain. Architectural (typology / boundary) → `architect`. Buildability / blast-radius → `principal-engineer`. User / scope → `pm`. Often multiple, picked from context.

**Outcome:** typically a `plan.md` task amendment plus a `spec.md § Assumptions` update marking the prior assumption as falsified, with a note on what replaced it. Often produces a follow-up implementation thread.

## Future extensibility

As v2+ personas are admitted (security, QA, etc.), they slot into this skill as additional valid lenses for the agent to load. No restructure of the skill body is needed — the persona library is the source of truth for *what each persona is*, and this skill body is the source of truth for *how the discussion mechanics work*. New personas extend the configurable space; they don't change the operating rules.

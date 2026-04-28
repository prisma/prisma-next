# Orchestrator unattended decisions — `<project name>`

This file records decisions the orchestrator made on the user's behalf while the user was unavailable for comment, during unattended execution of `<project>`. Each entry is a discrete decision that would normally have been surfaced as an `Escalation` per `drive-orchestrate-plan/SKILL.md § Escalation surface`.

The file lives under `wip/` so it is never committed (per the user's WIP-directory-workflow rule). It persists locally for the user's review after the run concludes.

## How to read this log

Each entry is **self-contained**. You should not need to consult any other document — including the project's review artifacts, finding logs, or PR comment threads — to understand the decision, evaluate whether it was correct, and verify it on disk.

If an entry leaves you needing to look something up to make sense of it, that's a bug in the entry; tell the orchestrator so the format can be tightened.

## Operating rules I am applying for unattended mode

These mirror `SKILL.md § Unattended mode → Operating rules`. Restated here for your audit convenience:

- **Conservative scope.** No work outside the scope already approved in `spec.md` / `plan.md`. New scope = stop, file as out-of-scope, recommend follow-up ticket.
- **Defensible choices over novel architecture.** When two equally valid options exist, pick the one closer to existing repo conventions and record the choice here.
- **Pre-existing flakes / unrelated failures.** If a non-phase failure surfaces, log it. Fix only if it blocks a validation gate; otherwise leave for the user.
- **Reviewer drift.** If intent-validation overrides the reviewer's verdict, the override is recorded both in `code-review.md § Orchestrator notes` and here.
- **No `--no-verify`.** No skipping of pre-commit hooks under any circumstance, including amends.
- **No remote push beyond what the loop normally does.** Branch stays local; PR opening is a separate skill (`create-pr`) and is invoked only if the user explicitly named it as part of the unattended scope.
- **No third-party automation expansions.** Don't authorize automated agents (e.g. CodeRabbit's "shall I open a tracking issue?") to create artifacts in the team's trackers without human approval. Decline politely; log the decline.

## Stop conditions

I will halt and leave the branch in a recoverable state if:

- A validation gate cannot be made green within the in-scope work.
- The implementer surfaces a blocker that cannot be defensibly resolved without an architectural decision.
- The spec/plan turn out to be wrong in a way I cannot correct from intent alone.
- The user's prior decisions are mutually inconsistent in a way that requires their input to resolve.
- Completing the work as specified would require a scope expansion (rather than a separable concern).

## Entry format

```
### N. <Decision title — what was decided, in plain language>

**Context.** One paragraph. What was happening in the project when this decision came up. Reference files, symbols, behaviors — never finding IDs (`F17`), action IDs (`A02a`), round labels as the trigger (`Phase 5 R2 triage`), or pointers into review artifacts that may not survive close-out. The reader should understand the situation without consulting any other document.

**The concern.** One paragraph. Why this needed a decision. What's the actual risk if the wrong choice is made? Be concrete and substantive — name the failure mode, the user impact, or the architectural property at stake.

**Options I considered.**
- (a) <plain-language option> — <consequence>.
- (b) <plain-language option> — <consequence>.
- (c) <plain-language option> — <consequence>.

**My choice.** (X) <plain-language description of what I did or did not do>.

**Why.** Rationale, framed in terms of project intent and stated user preferences, not skill rules or finding IDs. If this contradicts a literal reading of the spec/AC, say so explicitly and explain the intent reasoning.

**How to verify.** Concrete check the user can run without further context: a file/path to open, a symbol to grep, a commit SHA to inspect, a behavior to observe. Should be self-sufficient.

**How to undo if wrong.** Reversibility cost in plain language: "Trivial — one-line edit in <file>", or "Moderate — touches three call sites; one revert commit". Include the path back if it isn't obvious.

**Affected.** Files / commits / "none".
```

## Decisions

<!-- Append entries below in chronological order. Do not reorder or backfill. -->

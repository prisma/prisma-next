# Code review — `<project-name>`

> Initial scaffold. The reviewer maintains this document across rounds. The orchestrator and implementer read it but do not edit it.

## Summary

- **Current verdict:** _(pending first round)_
- **Phases SATISFIED:** _(none yet)_
- **AC scoreboard totals:** 0 PASS / 0 FAIL / N NOT VERIFIED — _(fill from spec)_
- **Open findings:** 0
- **Open escalations:** 0

## Acceptance criteria scoreboard

> Populate from `spec.md § Acceptance criteria`. Update on every round.

| AC ID  | Description (short) | Milestone | Status                          | Evidence |
|--------|---------------------|-----------|---------------------------------|----------|
| AC-1   | <fill from spec>    | <m-id>    | NOT VERIFIED — round 1 pending  | —        |
| AC-2   | <fill from spec>    | <m-id>    | NOT VERIFIED — round 1 pending  | —        |

Status values: `PASS` / `FAIL` / `NOT VERIFIED — <reason>` / `ACCEPTED DEFERRAL — <link>` / `OUT OF SCOPE`.

## Subagent IDs

> See `<skill-dir>/SKILL.md § Subagent continuity`. The orchestrator records the persistent implementer + reviewer IDs here on round 1 and resumes the same IDs across every subsequent round. If a subagent is replaced (e.g. resume failed), append a swap note recording when and why.

- **Implementer:** `<id>` — first spawned in `<milestone-id>` R1.
- **Reviewer:** `<id>` — first spawned in `<milestone-id>` R1.

## Findings log

> Each finding gets a stable F-number. Findings are not renumbered when resolved; they are marked resolved with a brief closure note.
>
> **Bar for filing** (see `<skill-dir>/agents/reviewer.md § Findings discipline`): every finding must have a concrete recommended action that the implementer can take in this PR. "Consider for the future," "out of scope," and "no action" are not findings — they are noise. Surface plan-amendment candidates to the orchestrator instead. Severity is one of `must-fix` / `should-fix` / `low / process` — there is no `informational` tier.

_(no findings yet)_

## Round notes

> One subsection per round per milestone. The reviewer's narrative explanation of what changed, what they evaluated, and why the verdict landed where it did.

_(round 1 will land here)_

---

## Finding template

When filing a new finding, copy this block under § Findings log:

```markdown
### F<N> — <short title>

**Severity:** must-fix | should-fix | low / process

**Where:** <file>:<line> or commit SHA + brief description

**What:** One-paragraph problem statement.

**Why it matters:** Impact analysis. Why this is worth surfacing rather than ignoring.

**Recommended next action:** Concrete, in-PR action the implementer takes. Must clear the § Findings discipline bar in `agents/reviewer.md`.

**Status:** open | resolved (commit SHA)
```

## Round-notes template

```markdown
### <Milestone ID> — Round <N> — <verdict-summary>

**Verdict:** SATISFIED | ANOTHER ROUND NEEDED | ESCALATING TO USER

**What was reviewed:** Commits <SHA>..<SHA>; <implementer report timestamp>.

**Task verification:**

- T<X.Y>: clean / partial / regressed — <one-line>
- T<X.Z>: ...

**AC scoreboard delta:** <what got promoted/demoted>.

**Triage of implementer flags:** <one-line per flag>.

**New findings filed:** F<N>, F<N+1>, ...

**Refresh summary:** SDR — <one-line delta>; walkthrough — <one-line delta>. (Both must be touched every round.)
```

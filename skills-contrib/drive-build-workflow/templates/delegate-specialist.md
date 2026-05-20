# Specialist delegation prompt template

> Skeleton for the orchestrator's prompt to a Specialist sub-agent. A Specialist wraps a single Drive atomic skill (or other named skill) and executes it end-to-end within a focused dispatch. The brief is shaped around the skill's inputs and outputs, not around code changes.
>
> Two modes — **fresh** (no prior transcript) and **resume** (specialist retains its prior transcript via your harness's resume mechanism; trim accordingly). Below: full template for fresh mode. The trimmed resume shape sits at the end.
>
> When to use this template vs `delegate-implement.md`:
> - **delegate-specialist.md** — the dispatch is "run skill X with these inputs and return its output." Examples: `drive-pr-walkthrough`, `drive-qa-plan`, `drive-code-review`, `drive-reconcile-skills`.
> - **delegate-implement.md** — the dispatch is "make code/file changes to satisfy this brief." Examples: TDD work, refactors, doc amendments.

---

## You are a Specialist for `<project-name>`

You are operating under the `<workflow-skill>` skill (e.g. `drive-build-workflow`, `drive-deliver-workflow`). Your role and constraints are documented at [`drive/roles/README.md`](../../../drive/roles/README.md) — re-read the Executor section if it's not already in your transcript.

## Skill invocation

- **Model:** `<explicit model identifier>` — **always specify explicitly**. If you omit the `model` parameter in your dispatch call, the sub-agent silently inherits the parent's model (typically thorough-tier — expensive). Pick per the dispatch's tier from [`drive/roles/README.md § Role-variant table`](../../../drive/roles/README.md).
- **Atomic skill:** `<skill-name>` (e.g. `drive-pr-walkthrough`)
- **Skill location:** `skills-contrib/<skill-name>/SKILL.md` — re-read its body before executing.
- **Execution mode:** the skill's preamble declares `delegated`. Your job is to execute the skill end-to-end within this dispatch's scope.

## Skill inputs

<List every input the skill requires, with concrete values. Pull from the skill's `## Inputs` section if it has one.>

- **<Input 1>:** `<concrete value>` (e.g. PR URL, spec path, target branch).
- **<Input 2>:** `<concrete value>`.

## Expected outputs

<List every output the skill is expected to produce, with destination paths or return shapes.>

- **<Output 1>:** `<destination>` (e.g. `wip/manual-qa-report.md`, conversation message).
- **<Output 2>:** `<destination>`.

## Dispatch scope

<State the precise scope of this dispatch. If the skill has variants or modes, state which one. If side-quests are NOT authorized, say so explicitly.>

- **In scope:** <what the dispatch covers>.
- **Out of scope:** <what the dispatch explicitly excludes>.
- **Side-quests:** <none authorized | "fix X if you encounter it; surface in the report">.

## "Done when" (binary, verifiable)

<Copy from the skill's "Done when" section if it has one, or derive from the dispatch's purpose. Each gate must be verifiable without orchestrator judgment.>

- [ ] `<gate 1>` (e.g. `wip/manual-qa-report.md` exists; section count matches the skill's spec).
- [ ] `<gate 2>`.

## Constraints

- **No code changes** unless the skill explicitly produces them and the dispatch scope authorizes them.
- **Explicit-staging commits only**; no `git add -A` / `git add .`.
- **No push** without explicit authorization.
- **Read-only constraints:** do not edit `projects/<x>/spec.md`, `projects/<x>/plan.md`, or any file outside the skill's documented output paths.

## Heartbeats

Write to `wip/heartbeats/specialist.txt` at: dispatch start, before/after long-running shell calls (>~1 min), at each skill milestone (e.g. "input X loaded", "section Y drafted"), and at least every ~5 minutes otherwise. The orchestrator reads this between turns to detect stalls. `mkdir -p wip/heartbeats` once at start; overwrite the file each ping.

## Deferral protocol

You may not unilaterally defer or descope the skill's required outputs. If you hit a blocker:

- Concretely identify the blocker (input missing, contradictory requirement, skill body asks for something outside dispatch scope).
- Surface to the orchestrator: "Skill execution blocked by <blocker>. Options: <a>, <b>, <c>. I recommend <choice> because <rationale>. Awaiting decision."
- Pause work on the blocked output; continue on independent outputs if any.

The single exception is input-format ambiguity: pick the interpretation most consistent with the skill's documented contract, document the choice in your report, continue.

## Pushback protocol

If the dispatch scope conflicts with the skill's own documented protocol:

- Don't silently comply. Surface to the orchestrator with concrete evidence (skill body line numbers, conflicting passages).
- The orchestrator will route the disagreement.

## Return shape

Your final message should include:

1. **Skill version / commit** — which version of the skill body you executed.
2. **Inputs received** — restate the inputs you used (catches input mismatches early).
3. **Outputs produced** — every output, with path or return shape.
4. **Done-when gate results** — every gate, pass/fail.
5. **Decisions made** — any judgment calls within the skill's grey areas.
6. **Anything surprising** — skill body contradictions, missing inputs, unclear scope.
7. **Deferral requests** — if any.
8. **Pushback** — if any.

Begin.

---

## Resume-mode prompt shape

> Use this trimmed shape on dispatches where the specialist sub-agent is being resumed via your harness's resume mechanism. The sub-agent retains its prior transcript; skip the role pointer and skill location unless they have changed.

```markdown
## Resume — `<project-name>`, `<skill-name>` dispatch `<dispatch-id>`

> You are being resumed. You retain your full prior transcript including every input you processed and every output you produced. Trust your prior transcript; reconcile only where the orchestrator's restated context below diverges from your memory (orchestrator wins).

## Skill inputs (this dispatch)

- **<Input 1>:** `<concrete value>`.

## Expected outputs (this dispatch)

- **<Output 1>:** `<destination>`.

## Dispatch scope changes from prior dispatches

- <e.g. "scope tightened: only the first section of the manual-QA report"; "input X has been corrected per orchestrator's last message"; or "Nothing has changed.">

## "Done when"

- [ ] `<gate 1>`.

## Constraints (reminder, terse)

- Explicit-staging commits, no push without authorization.
- No code changes outside the skill's documented output paths.
- Heartbeats to `wip/heartbeats/specialist.txt`.

Begin.
```

Drop any of the resume-mode sections that don't apply this dispatch.

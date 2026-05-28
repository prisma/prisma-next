---
name: drive-dispatch
description: >
  Atomic skill. Executes one dispatch — assembles the brief, delegates the work
  to an implementer subagent, owns the heartbeat contract for the duration of
  the call, and returns the implementer's structured report. Called by
  drive-build-workflow (in the slice loop, dispatch after dispatch) and by
  drive-start-workflow (one shot, for direct-change verdicts). Owns the
  dispatch-brief template, the implementer delegation prompt, and the
  implementer persona.
metadata:
  version: "2026.5.28"
---

> **Execution mode: caller is the orchestrator; this skill packages the
> act of dispatching.** The orchestrator's file-write and stop-and-delegate
> boundaries still apply — execution happens through the implementer subagent,
> not directly.

# Drive: Dispatch

Run one dispatch. Returns when the implementer reports done, surfaces a halt
condition, or its heartbeat goes stale.

## Inputs the caller provides

- **Brief** — filled-in [`./templates/dispatch-brief.template.md`](./templates/dispatch-brief.template.md).
  Mandatory: task, scope (in/out), completed-when, references, operational
  metadata (model tier, time-box, halt conditions).
- **Implementer subagent ID** — `null` to spawn fresh, or an existing ID to
  resume.
- **Context paths** — where the implementer should look for the wider surface
  this dispatch lives in. Slice loop: spec / plan / code-review under
  `projects/<project>/`. Direct change: the PR description draft.
- **Carry-over from prior dispatches** — findings, decisions standing, items
  triaged out of scope. Empty on fresh dispatches and on direct changes.
- **Multitasking policy** — `background` (default; caller multitasks during
  the wait) or `foreground` (caller blocks; used when there's no prep work,
  e.g. a one-off direct change).

## Outputs the caller receives

- **Updated implementer subagent ID** — equals input on resume; new ID on
  fresh.
- **Implementer report** — structured per the template's `Return shape`
  section.
- **Heartbeat tail** — last entries of `wip/heartbeats/implementer.txt`, for
  the caller's WIP / DoD discipline.
- **Halt signal** — `done` (implementer success), `blocked` (deferral or
  pushback needing caller routing), or `stale` (heartbeat unchanged; caller
  investigates).

## Workflow

### 1. Validate the brief

`Task`, `Scope`, and `Completed when` are mandatory and must be concrete enough
that the implementer doesn't have to guess intent. Vague brief → refuse the
dispatch and route back to the caller for repair. (Briefs are also the bar
that dispatch-INVEST checks against — see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md).)

### 2. Assemble the delegation prompt

Fill [`./templates/delegate-implement.md`](./templates/delegate-implement.md)
with the brief inlined. **Fresh mode** when there's no implementer ID:
self-contained prompt with persona pointer + context paths + full brief.
**Resume mode** when the caller passes an existing ID: drop the persona /
context-path block (the subagent already has them); restate only the brief +
carry-over + any updated operational metadata.

### 3. Dispatch the implementer

Invoke the subagent with the assembled prompt. **Always specify `model`
explicitly** — omitting it silently inherits the caller's tier (typically
expensive). Pick per the brief's `Model tier` resolved via
[`drive/roles/README.md § Role-variant table`](../../drive/roles/README.md).

Background by default; foreground when the caller has nothing to prep.

### 4. Monitor heartbeats; return when the subagent reports back

While the subagent runs, the caller reads `wip/heartbeats/implementer.txt`
between turns (this skill owns the contract; the file-write discipline is in
[`./agents/implementer.md § Heartbeats`](./agents/implementer.md)). Two
stale-signal patterns:

- **`ts` older than ~10 min** → likely hung. Return `stale` with the snapshot.
- **Fresh ping but `phase` unchanged across multiple reads** → stuck loop.
  Same `stale` return.

When the subagent finishes, return its structured report + heartbeat tail +
`done` (or `blocked` if it surfaced a deferral / pushback). DoD validation,
reviewer dispatch, and scope-shift routing belong to the caller.

## Subagent continuity (caller-owned)

The caller decides fresh-vs-resume per dispatch:

- **Slice loop** (`drive-build-workflow`): resume the persistent implementer
  across every dispatch and every round. Continuity carries cross-dispatch
  context that fresh prompts can't reconstruct.
- **Direct change** (`drive-start-workflow`): spawn fresh. One-off, no prior
  transcript.
- **Other callers**: fresh = self-contained one-shot; resume = continuity
  across calls.

Swaps from resume to fresh mid-loop must be recorded by the caller (silent
swaps break debuggability).

## Multitasking the dispatch (caller-side)

When backgrounding, useful wait-window work: pre-stage the next prompt,
pre-read the next dispatch's plan entry, run on-disk checks the orchestrator
owns (heartbeat staleness, deferral consistency), drain unrelated operator
threads. **Do not** poll the subagent, write code or run validation in
parallel, or delegate a parallel subagent that touches the same surface.

## Pitfalls

1. **Dispatching with a vague brief.** Implementers converge on wrong
   solutions fast when intent is ambiguous. Refuse and route back.
2. **Spawning fresh in the slice loop "because this is a new dispatch."**
   Persistent continuity is the point — see the loop's continuity rule.
3. **Backgrounding then polling.** Defeats multitasking. Trust the
   harness's completion notification.
4. **Silent kill on stale heartbeat.** Surface the snapshot; do not
   unilaterally terminate.
5. **Omitting `model` on dispatch.** Most expensive default. Always specify.

## References

- [`./templates/dispatch-brief.template.md`](./templates/dispatch-brief.template.md) — brief skeleton.
- [`./templates/delegate-implement.md`](./templates/delegate-implement.md) — delegation prompt skeleton (fresh + resume modes).
- [`./agents/implementer.md`](./agents/implementer.md) — implementer persona, heartbeats, deferral / pushback / commit hygiene.
- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md), [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — dispatch-INVEST.
- [`docs/drive/principles/brief-discipline.md`](../../docs/drive/principles/brief-discipline.md) — why briefs thin across resumed dispatches.
- [`drive/roles/README.md`](../../drive/roles/README.md) — Executor role + Role-variant table for model tier.

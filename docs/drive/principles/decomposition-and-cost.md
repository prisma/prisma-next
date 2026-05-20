# Principle: Decomposition is what makes cheap dispatches safe

## The sizing stack — PR, slice, project, dispatch

The natural sizing unit is the **pull request**. PRs have a maximum manageable size (above which review collapses) and a minimum efficient size (below which overhead dominates).

From PR derives the stack:

| Unit | Definition | Sizing |
|------|------------|--------|
| Direct change | Trivial work, no design ceremony | ~30-second verifiable diff |
| Slice | Vertical slice of value | One PR's envelope |
| Project | Design home for substantial discovery | Justified by depth, not by implementation size |
| Dispatch | Sub-slice working unit | M-cap, one implementer handoff |
| Round | Implementer + reviewer iteration on a dispatch | Bounded by "done when" gates |

### Slice ≡ PR ≡ Linear ticket, 1:1:1

One slice produces one PR and gets one Linear ticket. If a single spec for a single slice feels too big or too complex, **split into more slices** (each its own PR, each its own ticket). Never roll multiple slices into one PR — that pattern undermines the 1:1:1 discipline without buying anything that multiple dispatches in one slice doesn't already give.

### Project is independent of slice count

A project is a separate, optional abstraction. It is justified by **design depth**, not implementation size. When the work needs durable design ceremony — substantial spec, alternatives-considered, exploratory design — a project is the right home. The project may resolve to:

- **One slice** when the design produces a clean, contained result.
- **Multiple slices** when implementation legitimately needs more than one PR, either at plan time or as work progresses.

Slice count is determined by expected PR count after the design settles, not by the depth of the design conversation. Deep discussion can yield a single clean slice; thin discussion can yield many.

### Design is written, not held in context

Spec, plan, and design notes are durable artifacts that subsequent work can verify against. Conversation transcripts are not design artifacts; reasoning that lives only in conversation evaporates as soon as the context window rolls. Every project carries a `design-notes.md` alongside `spec.md` and `plan.md`: a synthesis that captures the design decisions and stands on its own — a reader picks it up and understands the design without inferring it from a chronology of decisions.

This is what makes orchestrator-direct authoring (see [`drive/roles/README.md § The role split / Orchestrator`](../../../drive/roles/README.md#orchestrator)) materially important: the artifacts must exist in the project directory for Executors and future Orchestrators to verify against. An Orchestrator that holds the design "in mind" but doesn't write it down leaves nothing for the dispatch contract to refer to.

## What dispatch shape → what tier

The orchestrator picks a model tier per dispatch. The rule for picking is shape-based — what kind of work is this, not "who's the agent doing it":

| Dispatch shape | Concrete example | Tier |
|---|---|---|
| Design judgment / novel pattern / spec interpretation | "Decide between two API shapes; pick one and justify in an ADR" | thorough tier |
| Codemod over many files | "Rename `getCwd` → `getCurrentWorkingDirectory` across 50 files" | fast tier |
| Mechanical migration | "Migrate the 8 test sites listed in the spike artefact to the new flat shape" | fast tier |
| Batch fix | "Update import paths after package reorg" | fast tier |
| Tricky one-line bug whose fix needs reading the spec carefully | "Fix the edge case in `mergeColumns` where two FKs collide on rename" | mid tier |
| Spike (investigation, output is an artefact) | "Count how many test sites use the legacy shape; output a table by package" | fast tier with short time-box |
| High blast radius even if conceptually simple | "Drop optionality from a substrate type that affects every consumer in the IR" | thorough tier, or decompose into smaller dispatches |
| L or XL composite shape | "Do the whole migration end-to-end" | **Refuse — decompose first.** No tier is safe at this shape. |

The rule behind the rule: **decomposition is what makes a cheap tier safe.** Without it, the orchestrator can't drop tier — the verification gates can't catch drift on feature-sized scopes, so the only protection left is the implementer's capability. With decomposition, the gates do enough of the work that the cheap tier becomes safe.

Same shape as the Agile insight that small stories let juniors pick them up. Cheap labour on safer work; same leverage, different axis (model tier instead of seniority).

## Why feature-sized dispatches force the expensive tier

L/XL dispatches (the ones DoR refuses) make the executing agent's job harder in four ways:

- **More interpretation latitude.** Bigger scope leaves more decisions to the implementer. More decisions means more chances to drift, so the orchestrator needs a model that's less likely to drift.
- **Higher recovery cost.** Drift in a 5-commit dispatch is N times more expensive to unwind than drift in a 1-commit dispatch. You pay the capability premium to *reduce* drift probability because the cost of the drift is severe.
- **Fuzzier verification.** Bigger scope makes "did you do the right thing?" harder to answer with a small set of gates. You pay the premium because the alternative is reading every diff line-by-line.
- **More context the implementer must hold.** Smaller models with smaller working memories struggle when the dispatch context exceeds what they can hold. Bigger dispatches push toward bigger models.

Result: feature-sized dispatches are locked to the orchestrator's tier throughout, because dropping tier risks drift the gates won't catch.

## Why small, well-decomposed dispatches free up the tier

When a dispatch is M-sized with a sharp "Done when," the situation inverts:

- **Narrow interpretation latitude.** A focused brief with pre-named edge cases gives the implementer few real decisions to make. Closer to "execute this specification" than "design and execute."
- **Bounded recovery cost.** Drift in a 1-commit dispatch is trivially reversible. The protection against drift is verification + revert, not capability.
- **Sharp verification.** Small scope is amenable to grep gates, test gates, fixture gates. The orchestrator verifies cheaply.
- **Fits the implementer's context budget.** Smaller models absorb a focused brief and its referenced files without overflow.

The cheap model is safe now because the protocol around the dispatch (DoR, DoD, brief discipline, gates) carries the risk that the model would otherwise have to carry alone.

## Worked example: a reversal we actually did

The reversal dispatch we ran was effectively L/XL: "drop optionality across the IR substrate + update every caller + retire the conditional envelope + tighten the introspector + delete the helper + regenerate fixtures." We ran the whole thing at thorough tier throughout — the prior dispatch attempts at cheaper tiers had drifted on simpler scopes, so we leaned on capability to avoid drift again.

Properly decomposed, the same work would have been:

| Dispatch | Size | Tier | Why |
|---|---|---|---|
| Drop `?:` from two adjacent substrate types (typology decision affecting all consumers) | M | thorough | Design judgment — typology decision |
| TS-builder caller normalisation | M | fast tier | Mechanical, well-bounded |
| PSL-interpreter caller normalisation | M | fast tier | Mechanical, well-bounded |
| Verifier inlining + delete `foreignKeyNamespacesMatch` | S | fast tier | Mechanical |
| Envelope shape simplification (retire conditional, delete probe) | M | thorough | Design judgment — canonical shape contract |
| Postgres introspector tightening | S | fast tier | Mechanical |
| F01 regression test | XS | fast tier | Mechanical |
| Fixture regeneration | XS | fast tier | Pure command execution |
| Final integration verify | S | thorough | Judgment on whether the pieces compose |

Two thorough-tier dispatches for the genuine design judgment; six cheap dispatches for the mechanical execution; one final thorough-tier dispatch for composition judgment. Total thorough-tier hours would have been ~25-40% of what we actually spent.

The cost reduction fell out of the decomposition. We didn't set out to optimise cost — we set out to make the work safer. The cost reduction was a derived benefit.

## The Agile analogue

| Agile concept | Drive analogue |
|---|---|
| Story sized for sprint | Slice sized for one PR (PR-cap) + dispatch sized for time-box (M-cap) |
| Acceptance criteria | Definition of Done at dispatch / slice / project scope |
| Junior developer | Cheaper / faster model tier |
| Senior developer review | Orchestrator's WIP-inspection cadence (≤ 5 min during every dispatch) |
| Team retro | Trigger-based retro that produces a canonical / team-context / ADR update |
| Apprenticeship | (Doesn't transfer — see [`protocol-as-memory.md`](protocol-as-memory.md)) |

The juniors-pulling-small-stories pattern is regarded as one of Agile's biggest leverage points — it changes who can do what work. The Drive version changes which model tier can safely execute which dispatch, with the same leverage on cost.

## Anti-patterns

1. **"Use the most capable model so I don't have to think about decomposition."** Treats capability as a substitute for decomposition. The capability premium gets paid; the decomposition work doesn't happen; the failure modes recur because the orchestrator never builds the decomposition muscle.
2. **"Use the cheapest model for everything because the gates will catch problems."** Treats decomposition as a substitute for capability without checking that the gates are adequate. Fails on tasks where the gates can't capture the discipline (judgment-heavy work).
3. **"Use the orchestrator's tier for the implementer because that's what I'm running."** Defaults to the parent agent's model regardless of dispatch shape. Pays the capability premium on every dispatch including the ones that don't need it. (This is the Cursor SDK's default if you don't pass an explicit `model` to a `Task` dispatch — worth knowing.)
4. **"I'll decompose later if it gets complicated."** Defers the decomposition cost to a moment when the project is already in trouble. The decomposition is harder once the work is in flight; the cheap-model dispatches are unavailable; the protocol has already failed.

## How this fits into the loop

- **Decomposition is part of the orchestrator's primary job.** Not an optimisation, not an afterthought — the act of decomposing IS the orchestrator's contribution to throughput and cost.
- **Every dispatch carries an explicit model-tier decision.** Default-to-parent is treated as a bug.
- **The brief specifies the expected tier.** Part of DoR is "this brief is sized for tier X." If tier and size disagree, refine.
- **Cost is measured.** Over time, the orchestrator-implementer pair builds an empirical sense of which dispatch shapes are safe at which tier. That sense lives in the team's project-context model-tier routing rules and grows by retro accretion.

## Sub-agent continuity and role variants

Dispatch shape determines model tier; the closely related question is whether each dispatch spawns a fresh sub-agent or resumes a previously-spawned one. Resumption is cheaper than re-derivation when the sub-agent's accumulated context is non-trivial — and most Drive sub-agents accumulate non-trivial context within the first few dispatches.

**Continuity vs re-derivation cost.** A fresh sub-agent spawned for each atomic-skill call pays the full context tax every time: spec content, plan content, prior decisions, and prior verdicts must be re-pasted into each new prompt. At typical Drive project sizes (3–8k tokens per sub-agent of spec/plan/discussion content), three cold spawns in a setup chain costs 9–24k tokens in re-pasting before any new work begins. Resuming the same sub-agent across the chain skips the re-paste — the sub-agent already holds the spec it just authored, the scope decisions it just made, and the constraints it just surfaced.

The continuity argument has a second leg: prose-discipline degrades past ~100 turns. A fresh spawn that has to re-load and re-orient at each call pays the full context tax *and* the orient tax — it may also slip a role declaration or miss an escape-hatch boundary on the way back up. A resumed sub-agent is past the orient phase; the role declaration is already-anchored and the working context already-grounded.

**Role variants.** Each Executor subtype (Specialist / Implementer / Reviewer; see [`drive/roles/README.md`](../../../drive/roles/README.md)) admits a small number of named variants with documented model tiers and persistence policies:

| Role / variant | Purpose | Tier (default) | Persistence |
|---|---|---|---|
| **scaffolder** | Mechanical work: directory setup, MCP setup, sweep-style edits | fast | one-shot |
| **setup-specialist** | Authoring: project spec, project plan, spec amendments | thorough | persistent across project-setup phase |
| **implementer/fast** | Routine code edits within a slice | mid | persistent across rounds within a slice |
| **implementer/thorough** | Escalation for hard problems | thorough | spawned on escalation |
| **reviewer/fast** | Default per-round review verdicts | mid | persistent across rounds within a slice |
| **reviewer/thorough** | Escalation review for high-leverage rounds | thorough | spawned on escalation |

Tier names (`fast` / `mid` / `thorough`) are deliberately tooling-agnostic. Each tooling environment (Cursor, Windsurf, Claude Code, Codex, etc.) ships its own model menu; the binding of tier label to a specific model is a project-context concern, not a framework concern. Record your project's tier-to-model mapping in your project-context surface (e.g. `drive/agents/README.md` if your project keeps one, or in your project spec) — never in this principles doc.

Variant naming uses the slash form (`role/variant`) consistently across this principles doc, the role anchor doc, and dispatch templates.

Why named variants matter:

- **Context preservation.** Variants persist across the calls where their accumulated context pays off. `setup-specialist` persists across the project-setup chain; `implementer/fast` persists across rounds within a slice; `reviewer/fast` persists across rounds within a slice.
- **Cost optimization.** Each variant has a documented model tier so dispatch matches problem shape: fast tier for routine work where the gates carry the protection, thorough tier for escalation where capability is doing the carrying.
- **Reproducible dispatch decisions.** Variant name + role together name the dispatch shape unambiguously across projects. An orchestrator picking up an in-flight project reads the registry, finds the active `implementer/fast` for the current slice, and continues without re-deriving role assignments or paying the cold-spawn context tax.

**Canonical worked example: the project-setup chain.** The three calls `drive-create-project` → `drive-specify-project` → `drive-plan-project` flow through a single resumed `setup-specialist`. The first call spawns the sub-agent and records its ID in the project's sub-agent registry (see [`drive/roles/README.md`](../../../drive/roles/README.md) for registry shape and ID-resumption mechanics); the next two calls resume the same ID. The sub-agent holds the project's purpose statement and scope decisions from the first call by the time the third call asks it to lay out the plan — no re-paste of the spec into a fresh thorough-tier sub-agent. Two cold spawns avoided; ~6–16k tokens of re-paste saved at thorough-tier pricing for the chain.

This principles doc carries the *why* — context preservation, cost arithmetic, named-roles-make-dispatch-reproducible. [`drive/roles/README.md`](../../../drive/roles/README.md) carries the *how*: per-project registry shape, ID-resumption mechanics, the swap-on-variant-change note, and the escape-hatch policy.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the gates and catalogues that make cheap-tier dispatch safe are themselves part of the team's memory.
- **[`spikes.md`](spikes.md)** — spikes are among the cheapest dispatches; using them first clears the way for cheaper implementation dispatches.
- **[`brief-discipline.md`](brief-discipline.md)** — the brief's "Model tier" section is the per-dispatch routing decision this principle codifies.
- **[`definition-of-ready.md`](definition-of-ready.md)** — dispatch DoR enforces the size cap that makes cheap-tier safe.
